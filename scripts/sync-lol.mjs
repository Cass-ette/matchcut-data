import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  championAssets,
  championEntries,
  checkImage,
  dataDragon,
} from "./lol-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function download(url, maximum) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
      assert.ok(
        Number(response.headers.get("content-length")) <= maximum,
        "文件过大",
      );
      assert.ok(response.body, "数据源返回空文件");
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          assert.ok(length <= maximum, "文件过大");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
}

const requested = process.argv[2];
const version =
  requested ||
  JSON.parse(
    (await download(`${dataDragon}/api/versions.json`, 1024 * 1024)).toString(),
  )[0];
assert.match(version, /^\d+\.\d+\.\d+$/);
const catalogUrl = `${dataDragon}/cdn/${version}/data/en_US/champion.json`;
const raw = JSON.parse(
  (await download(catalogUrl, 3 * 1024 * 1024)).toString(),
);
assert.equal(raw.version, version, "目录版本与请求版本不同");
const champions = championEntries(raw);
const catalog = {
  version,
  source: {
    provider: "Riot Data Dragon",
    catalogUrl,
    fetchedAt: new Date().toISOString(),
    iconUrlTemplate: `${dataDragon}/cdn/${version}/img/champion/{id}.png`,
    artworkUrlTemplate: `${dataDragon}/cdn/img/champion/loading/{id}_0.jpg`,
  },
  data: Object.fromEntries(
    champions.map(({ id, key, name }) => [id, { id, key, name }]),
  ),
};
try {
  const previous = JSON.parse(
    await readFile(path.join(root, "catalog/lol-champions.json"), "utf8"),
  );
  const ids = new Set(champions.map((champion) => champion.id));
  assert.ok(
    championEntries(previous).every((champion) => ids.has(champion.id)),
    "新目录缺失已收录英雄，请核实上游目录；原资料保留",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const assets = championAssets(catalog);
await mkdir(path.join(root, ".cache"), { recursive: true });
const staging = await mkdtemp(path.join(root, ".cache/lol-"));
console.log(
  `Riot Data Dragon ${version}: ${champions.length} champions, ${assets.length} images.`,
);
try {
  let next = 0;
  let completed = 0;
  const failures = [];
  const workers = Array.from({ length: 4 }, async () => {
    while (next < assets.length) {
      const item = assets[next++];
      try {
        const bytes = await download(item.url, 5 * 1024 * 1024);
        checkImage(bytes, item.format);
        await writeFile(path.join(staging, item.file), bytes);
        completed++;
        if (completed % 40 === 0 || completed === assets.length)
          console.log(`Downloaded ${completed}/${assets.length}`);
      } catch (error) {
        failures.push(`${item.file}: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);
  assert.equal(
    failures.length,
    0,
    `下载不完整，未更改原目录或素材：\n${failures.join("\n")}`,
  );
  // Only publish a catalog after every portrait and artwork has been validated.
  const destination = path.join(root, "assets/lol");
  await mkdir(destination, { recursive: true });
  for (const item of assets)
    await copyFile(
      path.join(staging, item.file),
      path.join(destination, item.file),
    );
  await writeFile(
    path.join(destination, "SOURCES.md"),
    `# LoL 英雄素材\n\n来源：[Riot Data Dragon](${catalogUrl})。英雄目录与头像版本：${version}；收录 ${champions.length} 个英雄，每个包含头像 PNG 与默认皮肤加载立绘 JPG。\n\n获取时间：${catalog.source.fetchedAt}。立绘地址没有版本号，表示获取时的默认美术，不能视为历史比赛补丁当时的美术。\n\n逐项地址可用目录中的 id 代入 catalog/lol-champions.json 的 source URL 模板，各文件 SHA256 保存在 manifest.json。\n\n英雄、美术与 League of Legends 商标属于 Riot Games。\n`,
  );
  await writeFile(
    path.join(root, "catalog/lol-champions.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  console.log(
    "Full champion catalog saved. Run npm run manifest, npm run validate, then npm run export -- ../matchcut.",
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
