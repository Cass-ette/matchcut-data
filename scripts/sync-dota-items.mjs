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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogUrl = "https://api.opendota.com/api/constants/items";
const cdn = "https://cdn.cloudflare.steamstatic.com";
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(
    bytes.length > 0 && bytes.length <= 5 * 1024 * 1024,
    "文件大小无效",
  );
  return bytes;
}
const input = process.argv.includes("--catalog")
  ? await readFile(option("--catalog"))
  : await download(catalogUrl);
const raw = JSON.parse(input.toString());
const items = {};
for (const [key, item] of Object.entries(raw)) {
  assert.match(key, /^[a-z0-9_]+$/);
  assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
  assert.ok(!items[item.id], `重复装备 ID: ${item.id}`);
  assert.match(
    item.img,
    /^\/apps\/dota2\/images\/dota_react\/items\/[a-z0-9_]+\.png(?:\?.*)?$/,
  );
  const imageUrl = cdn + item.img.split("?")[0];
  items[item.id] = { key, name: item.dname?.trim() || key, imageUrl };
}
let bundledIds;
if (process.argv.includes("--snapshot")) {
  const snapshot = JSON.parse(await readFile(option("--snapshot"), "utf8"));
  const fields = [
    ...Array.from({ length: 6 }, (_, n) => `item_${n}`),
    "item_neutral",
    "item_neutral2",
  ];
  bundledIds = [
    ...new Set(
      snapshot.raw.players
        .flatMap((p) => fields.map((f) => p[f]))
        .filter((id) => id > 0),
    ),
  ].sort((a, b) => a - b);
} else {
  bundledIds = JSON.parse(
    await readFile(path.join(root, "catalog/dota-items.json"), "utf8"),
  ).bundledIds;
}
assert.ok(bundledIds.length > 0 && bundledIds.every((id) => items[id]));
const catalog = {
  schemaVersion: 1,
  source: {
    provider: "OpenDota dotaconstants / Valve Steam CDN",
    catalogUrl,
    fetchedAt: new Date().toISOString(),
  },
  items,
  bundledIds,
};
await mkdir(path.join(root, ".cache"), { recursive: true });
const staging = await mkdtemp(path.join(root, ".cache/dota-items-"));
try {
  let next = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < bundledIds.length) {
        const id = bundledIds[next++];
        try {
          const bytes = await download(items[id].imageUrl);
          assert.equal(
            bytes.subarray(0, 8).toString("hex"),
            "89504e470d0a1a0a",
            `无效 PNG: ${id}`,
          );
          await writeFile(path.join(staging, `${id}.png`), bytes);
          console.log(`Downloaded ${id}: ${items[id].name}`);
        } catch (error) {
          failures.push(`${id}: ${error.message}`);
        }
      }
    }),
  );
  assert.equal(
    failures.length,
    0,
    `装备图未完整下载，原目录保留：\n${failures.join("\n")}`,
  );
  const destination = path.join(root, "assets/dota/items");
  await mkdir(destination, { recursive: true });
  for (const id of bundledIds)
    await copyFile(
      path.join(staging, `${id}.png`),
      path.join(destination, `${id}.png`),
    );
  await writeFile(
    path.join(destination, "SOURCES.md"),
    `# Dota 2 装备图标\n\n装备 ID 与名称来自 [OpenDota dotaconstants](${catalogUrl})，图标来自 Valve Steam CDN。获取时间：${catalog.source.fetchedAt}。\n\n内置示例单局使用的 ${bundledIds.length} 张主装备、中立物品与附魔图标；全量 ${Object.keys(items).length} 项目录保存在 catalog/dota-items.json。逐项图标地址记录在 imageUrl，各文件 SHA256 在 manifest.json。装备美术属于 Valve。\n\n这些图片是获取时的美术，不代表历史比赛补丁当时的外观。\n`,
  );
  await writeFile(
    path.join(root, "catalog/dota-items.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  console.log(
    `Saved ${Object.keys(items).length} items and ${bundledIds.length} images. Run npm run manifest before export.`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
