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
const version = process.argv[2];
const snapshotFile = process.argv[3];
assert.match(
  version || "",
  /^\d+\.\d+\.\d+$/,
  "请指定比赛对应的 Data Dragon 版本",
);
assert.ok(snapshotFile, "请指定已核实的 LoL 装备快照");
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
let participants, patchVersion;
if (snapshot.schemaVersion === 2) {
  assert.equal(snapshot.source, "games-of-legends");
  assert.match(
    snapshot.sourceUrl,
    /^https:\/\/gol\.gg\/game\/stats\/\d+\/page-game\/$/,
  );
  assert.equal(snapshot.quantityMode, "occupied-slots");
  participants = snapshot.players;
  patchVersion = snapshot.patchVersion;
} else {
  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(!snapshot.counterReset, "不能使用断档装备快照");
  assert.equal(snapshot.window.gameState, "finished");
  assert.equal(
    snapshot.window.rfc460Timestamp,
    snapshot.details.rfc460Timestamp,
  );
  participants = snapshot.details.participants;
  patchVersion = snapshot.metadata.patchVersion;
}
assert.equal(
  patchVersion.split(".").slice(0, 2).join("."),
  version.split(".").slice(0, 2).join("."),
);
assert.equal(participants.length, 10);
assert.ok(participants.every((p) => Array.isArray(p.items)));
const ids = participants.flatMap((p) => p.items);
assert.ok(ids.length && ids.every((id) => Number.isSafeInteger(id) && id > 0));
const base = "https://ddragon.leagueoflegends.com";
async function download(url) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length < 5 * 1024 * 1024);
  return bytes;
}
const catalogUrl = `${base}/cdn/${version}/data/zh_CN/item.json`;
const raw = JSON.parse((await download(catalogUrl)).toString());
assert.equal(raw.version, version);
const catalogFile = path.join(
  root,
  "catalog/lol-items",
  version.split(".").slice(0, 2).join(".") + ".json",
);
let existingIds = [];
try {
  const existing = JSON.parse(await readFile(catalogFile, "utf8"));
  assert.equal(existing.version, version);
  existingIds = existing.bundledIds;
  assert.ok(Array.isArray(existingIds));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// Quest markers have only the Lane tag. Actual support items/boots also use
// Lane alongside equipment tags, and must remain bundled.
const questMarker = (id) =>
  raw.data[id]?.tags?.length === 1 && raw.data[id].tags[0] === "Lane";
const bundledIds = [
  ...new Set([...existingIds, ...ids].filter((id) => !questMarker(id))),
].sort((a, b) => a - b);
const catalog = {
  schemaVersion: 1,
  version,
  source: { catalogUrl, fetchedAt: new Date().toISOString() },
  items: Object.fromEntries(
    Object.entries(raw.data).map(([id, item]) => {
      assert.match(id, /^\d+$/);
      assert.equal(typeof item.name, "string");
      return [id, { name: item.name.trim() || `未知装备 #${id}` }];
    }),
  ),
  bundledIds,
};
assert.ok(
  bundledIds.every((id) => catalog.items[id]),
  "目录缺少示例装备",
);
await mkdir(path.join(root, ".cache"), { recursive: true });
const staging = await mkdtemp(path.join(root, ".cache/lol-items-"));
try {
  let next = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < bundledIds.length) {
        const id = bundledIds[next++];
        try {
          const bytes = await download(
            `${base}/cdn/${version}/img/item/${id}.png`,
          );
          assert.equal(
            bytes.subarray(0, 8).toString("hex"),
            "89504e470d0a1a0a",
          );
          await writeFile(path.join(staging, `${id}.png`), bytes);
        } catch (error) {
          failures.push(`${id}: ${error.message}`);
        }
      }
    }),
  );
  assert.equal(
    failures.length,
    0,
    `图标未下载完整，原资料保留：${failures.join("; ")}`,
  );
  const dest = path.join(root, `assets/lol/items/${version}`);
  await mkdir(dest, { recursive: true });
  for (const id of bundledIds)
    await copyFile(
      path.join(staging, `${id}.png`),
      path.join(dest, `${id}.png`),
    );
  await writeFile(
    path.join(dest, "SOURCES.md"),
    `# LoL 装备图标\n\n来源：[Riot Data Dragon ${version}](${catalogUrl})。获取时间：${catalog.source.fetchedAt}。\n\n内置示例使用的 ${bundledIds.length} 张装备、饰品与消耗品图标；版本与比赛补丁对应。逐项图片地址为 ${base}/cdn/${version}/img/item/{id}.png，SHA256 见 manifest.json。美术与 League of Legends 商标属于 Riot Games。\n`,
  );
  const catalogs = path.join(root, "catalog/lol-items");
  await mkdir(catalogs, { recursive: true });
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
  console.log(
    `Saved LoL ${version}: ${Object.keys(catalog.items).length} items, ${bundledIds.length} images.`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
