import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const { version } = await readJson("package.json");
assert.match(version, /^\d+\.\d+\.\d+$/);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const games = ["dota2", "lol", "cs2"];
const text = (v) => typeof v === "string" && !!v.trim();
const httpsUrl = (v) => {
  const url = new URL(v);
  assert.ok(url.protocol === "https:" && !url.username && !url.password, "来源必须是无凭据的 HTTPS URL");
};
const assetPath = (value, prefix) => {
  assert.ok(typeof value === "string" && value.startsWith(`/assets/${prefix}/`), "素材路径错误");
  assert.match(value.slice(`/assets/${prefix}/`.length), /^[A-Za-z0-9_-]+\.png$/);
  return value.slice(1);
};

async function collect(relative) {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `目录不能包含符号链接: ${child}`);
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`不支持的文件类型: ${child}`);
  }
  return files.sort();
}

async function inspect() {
  const teams = await readJson("catalog/team-logos.json");
  const players = await readJson("catalog/player-photos.json");
  const logos = await readJson("catalog/logo-catalog.json");
  const maps = await readJson("catalog/maps.json");
  const scope = await readJson("catalog/scope.json");
  assert.equal(scope.schemaVersion, 1);
  assert.ok(text(scope.coverageStatus));
  const assets = await collect("assets");
  const expected = new Set();
  const png = async (file) => {
    assert.ok(assets.includes(file), `素材文件缺失: ${file}`);
    const bytes = await readFile(path.join(root, file));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `无效 PNG: ${file}`);
    expected.add(file);
  };
  const unique = (rows, key) => {
    assert.ok(Array.isArray(rows) && rows.length, "目录必须是非空数组");
    const keys = rows.map(key);
    assert.equal(new Set(keys).size, keys.length, "目录出现重复身份");
  };
  unique(teams, (t) => `${t.game}:${t.name?.toLowerCase()}`);
  for (const team of teams) {
    assert.ok(games.includes(team.game) && text(team.name) && text(team.source));
    assert.ok(Array.isArray(team.aliases) && team.aliases.every(text));
    if (team.source.startsWith("https://")) httpsUrl(team.source);
    else assert.ok(/^(?:cs|csgo|dota-2|league-of-legends)\//.test(team.source) && !team.source.includes(".."));
    await png(assetPath(team.logo, "teams"));
  }
  unique(players, (p) => `${p.game}:${p.playerId}`);
  for (const player of players) {
    assert.ok(games.includes(player.game) && text(player.playerId) && text(player.name));
    if (player.game === "cs2") assert.match(player.playerId, /^\d{17}$/);
    assert.ok(text(player.source?.provider) && text(player.source.name));
    httpsUrl(player.source.pageUrl);
    httpsUrl(player.source.imageUrl);
    await png(assetPath(player.artwork, "players"));
  }
  unique(maps, (m) => `${m.game}:${m.id}`);
  for (const map of maps) {
    assert.equal(map.game, "cs2");
    assert.match(map.id, /^[a-z0-9]+$/);
    assert.equal(map.image, `/assets/cs/maps/${map.id}.png`);
    httpsUrl(map.source);
    await png(assetPath(map.image, "cs/maps"));
  }
  assert.ok(!Number.isNaN(Date.parse(logos.fetchedAt)));
  unique(logos.logos, (l) => `${l.game}:${l.path}`);
  for (const logo of logos.logos) {
    assert.ok(games.includes(logo.game) && text(logo.name));
    assert.match(logo.sha, /^[a-f0-9]{40}$/);
    assert.ok(/^(?:cs|csgo|dota-2|league-of-legends)\//.test(logo.path));
    assert.ok(!logo.path.split("/").some((part) => !part || part === "." || part === ".." || /[\\\x00-\x1f]/.test(part)));
  }
  for (const file of assets) assert.ok(expected.has(file) || /\/SOURCES\.md$/.test(file), `未被目录引用的素材: ${file}`);
  const entries = [];
  for (const file of [...await collect("catalog"), ...assets].sort()) {
    const bytes = await readFile(path.join(root, file));
    entries.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
  }
  return {
    schemaVersion: 1, version, coverageStatus: scope.coverageStatus,
    counts: { teams: teams.length, players: players.length, maps: maps.length, logoCatalog: logos.logos.length },
    files: entries,
  };
}

async function validate() {
  const actual = await inspect();
  const saved = await readJson("manifest.json");
  assert.deepEqual(saved, actual, "manifest.json 与数据不一致；核实变更后运行 npm run manifest");
  console.log(`Verified v${version}: ${actual.counts.teams} teams, ${actual.counts.players} players, ${actual.counts.maps} maps, ${actual.counts.logoCatalog} logo candidates.`);
  return actual;
}

async function copyInto(destination, manifest) {
  const mappings = [
    ["catalog/team-logos.json", "data/fixtures/team-logos.json"],
    ["catalog/player-photos.json", "data/fixtures/player-photos.json"],
    ["catalog/logo-catalog.json", "data/fixtures/logo-catalog.json"],
    ["manifest.json", "data/fixtures/media-catalog-version.json"],
    ...manifest.files.filter((entry) => entry.path.startsWith("assets/")).map((entry) => [entry.path, "public/" + entry.path]),
  ];
  for (const [source, target] of mappings) {
    const file = path.join(destination, target);
    await mkdir(path.dirname(file), { recursive: true });
    await copyFile(path.join(root, source), file);
  }
}

async function build() {
  const manifest = await validate();
  const staging = await mkdtemp(path.join(os.tmpdir(), "matchcut-data-build-"));
  try {
    await copyInto(staging, manifest);
    await copyFile(path.join(root, "manifest.json"), path.join(staging, "manifest.json"));
    // Include source catalog so every manifest entry can be verified in the archive.
    for (const entry of manifest.files) {
      const file = path.join(staging, entry.path);
      await mkdir(path.dirname(file), { recursive: true });
      await copyFile(path.join(root, entry.path), file);
    }
    await mkdir(path.join(root, "dist"), { recursive: true });
    const archive = path.join(root, "dist", `matchcut-data-${version}.tar.gz`);
    await exec("tar", ["-czf", archive, "-C", staging, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    await writeFile(archive + ".sha256", `${digest(await readFile(archive))}  ${path.basename(archive)}\n`);
    console.log(`Built ${path.relative(root, archive)} and SHA256.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function exportTo(target) {
  assert.ok(target, "请指定 Matchcut 仓库路径：npm run export -- ../matchcut");
  const app = path.resolve(process.cwd(), target);
  const pkg = JSON.parse(await readFile(path.join(app, "package.json"), "utf8"));
  assert.equal(pkg.name, "matchcut", "目标必须是 Matchcut 应用仓库");
  const manifest = await validate();
  await copyInto(app, manifest);
  console.log(`Exported v${version} to ${app}; local overrides, preferences and cache preserved. Restart Matchcut to reload cached catalogs.`);
}

const command = process.argv[2] || "validate";
if (command === "validate") await validate();
else if (command === "manifest") {
  const manifest = await inspect();
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote manifest v${version} (${manifest.files.length} files).`);
} else if (command === "build") await build();
else if (command === "export") await exportTo(process.argv[3]);
else throw new Error(`Unknown command: ${command}`);
