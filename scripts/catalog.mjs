import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  championAssets,
  championEntries,
  checkImage,
  dataDragon,
} from "./lol-catalog.mjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (file) =>
  JSON.parse(await readFile(path.join(root, file), "utf8"));
const { version } = await readJson("package.json");
assert.match(version, /^\d+\.\d+\.\d+$/);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const games = ["dota2", "lol", "cs2"];
const text = (v) => typeof v === "string" && !!v.trim();
const httpsUrl = (v) => {
  const url = new URL(v);
  assert.ok(
    url.protocol === "https:" && !url.username && !url.password,
    "来源必须是无凭据的 HTTPS URL",
  );
};
const assetPath = (value, prefix) => {
  assert.ok(
    typeof value === "string" && value.startsWith(`/assets/${prefix}/`),
    "素材路径错误",
  );
  assert.match(
    value.slice(`/assets/${prefix}/`.length),
    /^[A-Za-z0-9_-]+\.png$/,
  );
  return value.slice(1);
};

async function collect(relative) {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const child = path.posix.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `目录不能包含符号链接: ${child}`);
    if (entry.isDirectory()) files.push(...(await collect(child)));
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
  const champions = await readJson("catalog/lol-champions.json");
  const profiles = await readJson("catalog/lol-players.json");
  const events = await readJson("catalog/lol-events.json");
  const scope = await readJson("catalog/scope.json");
  const dotaItems = await readJson("catalog/dota-items.json");
  assert.equal(scope.schemaVersion, 1);
  assert.ok(text(scope.coverageStatus));
  const assets = await collect("assets");
  const expected = new Set();
  const png = async (file) => {
    assert.ok(assets.includes(file), `素材文件缺失: ${file}`);
    const bytes = await readFile(path.join(root, file));
    assert.equal(
      bytes.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      `无效 PNG: ${file}`,
    );
    expected.add(file);
  };
  const unique = (rows, key) => {
    assert.ok(Array.isArray(rows) && rows.length, "目录必须是非空数组");
    const keys = rows.map(key);
    assert.equal(new Set(keys).size, keys.length, "目录出现重复身份");
  };
  unique(teams, (t) => `${t.game}:${t.name?.toLowerCase()}`);
  for (const team of teams) {
    assert.ok(
      games.includes(team.game) && text(team.name) && text(team.source),
    );
    assert.ok(Array.isArray(team.aliases) && team.aliases.every(text));
    if (team.source.startsWith("https://")) httpsUrl(team.source);
    else
      assert.ok(
        /^(?:cs|csgo|dota-2|league-of-legends)\//.test(team.source) &&
          !team.source.includes(".."),
      );
    await png(assetPath(team.logo, "teams"));
  }
  unique(players, (p) => `${p.game}:${p.playerId}`);
  const photoHashes = new Map();
  for (const player of players) {
    assert.ok(
      games.includes(player.game) && text(player.playerId) && text(player.name),
    );
    if (player.game === "cs2") assert.match(player.playerId, /^\d{17}$/);
    assert.ok(text(player.source?.provider) && text(player.source.name));
    httpsUrl(player.source.pageUrl);
    httpsUrl(player.source.imageUrl);
    await png(assetPath(player.artwork, "players"));
    if (player.game === "lol") {
      const hash = digest(
        await readFile(path.join(root, player.artwork.slice(1))),
      );
      assert.ok(
        !photoHashes.has(hash),
        `不同选手共用同一照片，请排查占位图: ${photoHashes.get(hash)} / ${player.name}`,
      );
      photoHashes.set(hash, player.name);
    }
  }
  assert.equal(profiles.schemaVersion, 1);
  unique(profiles.players, (p) => p.playerId);
  for (const provider of ["lpl", "riot"]) {
    const linked = profiles.players.filter((p) => p.providerIds[provider]);
    if (linked.length) unique(linked, (p) => p.providerIds[provider]);
  }
  const people = new Map(profiles.players.map((p) => [p.playerId, p]));
  for (const person of profiles.players) {
    assert.ok(text(person.name) && text(person.playerId));
    assert.ok(
      !("teamId" in person) && !("team" in person),
      "选手档案不能绑定固定战队",
    );
    assert.equal(person.providerIds.oraclesElixir, person.playerId);
    assert.ok(Array.isArray(person.aliases) && person.aliases.every(text));
    assert.ok(
      ["available", "missing", "ambiguous"].includes(person.photoStatus),
    );
    const photo = players.find(
      (p) => p.game === "lol" && p.playerId === person.playerId,
    );
    if (person.photoStatus === "available") {
      assert.ok(photo, `选手照片缺失: ${person.name}`);
      assert.equal(photo.source.imageUrl, person.photo.imageUrl);
      assert.ok(
        person.identityEvidence.length >= 2,
        `选手身份缺少交叉来源: ${person.name}`,
      );
    } else assert.ok(!photo, `待核实选手不能自动绑定照片: ${person.name}`);
  }
  assert.equal(events.schemaVersion, 1);
  unique(events.events, (event) => event.id);
  for (const event of events.events) {
    httpsUrl(event.participantSource);
    assert.ok(text(event.rosterStatus));
    unique(event.teams, (team) => team.teamId);
    for (const team of event.teams) {
      unique(team.players, (p) => p.playerId);
      for (const player of team.players) {
        assert.ok(
          people.has(player.playerId),
          `赛事引用未知选手: ${player.playerId}`,
        );
        assert.ok(text(player.evidence.gameId) && text(player.evidence.date));
      }
    }
  }
  unique(maps, (m) => `${m.game}:${m.id}`);
  for (const map of maps) {
    assert.equal(map.game, "cs2");
    assert.match(map.id, /^[a-z0-9]+$/);
    assert.equal(map.image, `/assets/cs/maps/${map.id}.png`);
    httpsUrl(map.source);
    await png(assetPath(map.image, "cs/maps"));
  }
  const championCount = championEntries(champions).length;
  assert.equal(champions.source.provider, "Riot Data Dragon");
  assert.equal(
    champions.source.catalogUrl,
    `${dataDragon}/cdn/${champions.version}/data/en_US/champion.json`,
  );
  assert.equal(
    champions.source.iconUrlTemplate,
    `${dataDragon}/cdn/${champions.version}/img/champion/{id}.png`,
  );
  assert.equal(
    champions.source.artworkUrlTemplate,
    `${dataDragon}/cdn/img/champion/loading/{id}_0.jpg`,
  );
  assert.ok(!Number.isNaN(Date.parse(champions.source.fetchedAt)));
  for (const item of championAssets(champions)) {
    const file = `assets/lol/${item.file}`;
    assert.ok(assets.includes(file), `英雄素材缺失: ${file}`);
    checkImage(await readFile(path.join(root, file)), item.format);
    expected.add(file);
  }
  assert.ok(!Number.isNaN(Date.parse(logos.fetchedAt)));
  unique(logos.logos, (l) => `${l.game}:${l.path}`);
  for (const logo of logos.logos) {
    assert.ok(games.includes(logo.game) && text(logo.name));
    assert.match(logo.sha, /^[a-f0-9]{40}$/);
    assert.ok(/^(?:cs|csgo|dota-2|league-of-legends)\//.test(logo.path));
    assert.ok(
      !logo.path
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            /[\\\x00-\x1f]/.test(part),
        ),
    );
  }
  await png("assets/placeholders/player.png");
  assert.equal(dotaItems.schemaVersion, 1);
  assert.equal(
    dotaItems.source.catalogUrl,
    "https://api.opendota.com/api/constants/items",
  );
  assert.ok(!Number.isNaN(Date.parse(dotaItems.source.fetchedAt)));
  for (const [id, item] of Object.entries(dotaItems.items)) {
    assert.match(id, /^[1-9][0-9]*$/);
    assert.match(item.key, /^[a-z0-9_]+$/);
    assert.ok(text(item.name));
    assert.match(
      item.imageUrl,
      /^https:\/\/cdn\.cloudflare\.steamstatic\.com\/apps\/dota2\/images\/dota_react\/items\/[a-z0-9_]+\.png$/,
    );
  }
  assert.ok(dotaItems.bundledIds.length > 0);
  assert.equal(new Set(dotaItems.bundledIds).size, dotaItems.bundledIds.length);
  for (const id of dotaItems.bundledIds) {
    assert.ok(dotaItems.items[id], `未知装备: ${id}`);
    await png(`assets/dota/items/${id}.png`);
  }
  let lolItemImages = 0;
  const lolItemCatalogs = await collect("catalog/lol-items");
  for (const file of lolItemCatalogs) {
    assert.match(file, /^catalog\/lol-items\/\d+\.\d+\.json$/);
    const catalog = await readJson(file);
    assert.equal(catalog.schemaVersion, 1);
    assert.match(catalog.version, /^\d+\.\d+\.\d+$/);
    assert.equal(
      path.basename(file, ".json"),
      catalog.version.split(".").slice(0, 2).join("."),
    );
    assert.equal(
      catalog.source.catalogUrl,
      `https://ddragon.leagueoflegends.com/cdn/${catalog.version}/data/zh_CN/item.json`,
    );
    assert.ok(!Number.isNaN(Date.parse(catalog.source.fetchedAt)));
    for (const [id, item] of Object.entries(catalog.items)) {
      assert.match(id, /^[1-9][0-9]*$/);
      assert.ok(text(item.name));
    }
    assert.ok(catalog.bundledIds.length > 0);
    assert.equal(new Set(catalog.bundledIds).size, catalog.bundledIds.length);
    for (const id of catalog.bundledIds) {
      assert.ok(catalog.items[id]);
      await png(`assets/lol/items/${catalog.version}/${id}.png`);
      lolItemImages++;
    }
  }
  for (const file of assets)
    assert.ok(
      expected.has(file) || /\/SOURCES\.md$/.test(file),
      `未被目录引用的素材: ${file}`,
    );
  const entries = [];
  for (const file of [...(await collect("catalog")), ...assets].sort()) {
    const bytes = await readFile(path.join(root, file));
    entries.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
  }
  return {
    schemaVersion: 1,
    version,
    coverageStatus: scope.coverageStatus,
    counts: {
      teams: teams.length,
      players: players.length,
      maps: maps.length,
      logoCatalog: logos.logos.length,
      lolChampions: championCount,
      lolPlayers: profiles.players.length,
      lolEvents: events.events.length,
      dotaItems: Object.keys(dotaItems.items).length,
      dotaItemImages: dotaItems.bundledIds.length,
      lolItemCatalogs: lolItemCatalogs.length,
      lolItemImages,
    },
    files: entries,
  };
}

async function validate() {
  const actual = await inspect();
  const saved = await readJson("manifest.json");
  assert.deepEqual(
    saved,
    actual,
    "manifest.json 与数据不一致；核实变更后运行 npm run manifest",
  );
  console.log(
    `Verified v${version}: ${actual.counts.teams} teams, ${actual.counts.players} players, ${actual.counts.maps} maps, ${actual.counts.logoCatalog} logo candidates, ${actual.counts.lolChampions} LoL champions with portraits and artwork.`,
  );
  return actual;
}

async function copyInto(destination, manifest) {
  const mappings = [
    ["catalog/team-logos.json", "data/fixtures/team-logos.json"],
    ["catalog/player-photos.json", "data/fixtures/player-photos.json"],
    ["catalog/logo-catalog.json", "data/fixtures/logo-catalog.json"],
    ["catalog/lol-champions.json", "data/fixtures/lol/champions.json"],
    ["catalog/lol-players.json", "data/fixtures/lol/players.json"],
    ["catalog/lol-events.json", "data/fixtures/lol/events.json"],
    ["catalog/dota-items.json", "data/fixtures/dota-items.json"],
    ...manifest.files
      .filter((entry) => entry.path.startsWith("catalog/lol-items/"))
      .map((entry) => [
        entry.path,
        entry.path.replace(
          "catalog/lol-items/",
          "data/fixtures/lol/item-catalogs/",
        ),
      ]),
    ["manifest.json", "data/fixtures/media-catalog-version.json"],
    ...manifest.files
      .filter((entry) => entry.path.startsWith("assets/"))
      .map((entry) => [entry.path, "public/" + entry.path]),
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
    await copyFile(
      path.join(root, "manifest.json"),
      path.join(staging, "manifest.json"),
    );
    // Include source catalog so every manifest entry can be verified in the archive.
    for (const entry of manifest.files) {
      const file = path.join(staging, entry.path);
      await mkdir(path.dirname(file), { recursive: true });
      await copyFile(path.join(root, entry.path), file);
    }
    await mkdir(path.join(root, "dist"), { recursive: true });
    const archive = path.join(root, "dist", `matchcut-data-${version}.tar.gz`);
    await exec("tar", ["-czf", archive, "-C", staging, "."], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    await writeFile(
      archive + ".sha256",
      `${digest(await readFile(archive))}  ${path.basename(archive)}\n`,
    );
    console.log(`Built ${path.relative(root, archive)} and SHA256.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function exportTo(target) {
  assert.ok(target, "请指定 Matchcut 仓库路径：npm run export -- ../matchcut");
  const app = path.resolve(process.cwd(), target);
  const pkg = JSON.parse(
    await readFile(path.join(app, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "matchcut", "目标必须是 Matchcut 应用仓库");
  const manifest = await validate();
  await copyInto(app, manifest);
  console.log(
    `Exported v${version} to ${app}; local overrides, preferences and cache preserved. Restart Matchcut to reload cached catalogs.`,
  );
}

const command = process.argv[2] || "validate";
if (command === "validate") await validate();
else if (command === "manifest") {
  const manifest = await inspect();
  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Wrote manifest v${version} (${manifest.files.length} files).`);
} else if (command === "build") await build();
else if (command === "export") await exportTo(process.argv[3]);
else throw new Error(`Unknown command: ${command}`);
