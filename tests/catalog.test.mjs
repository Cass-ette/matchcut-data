import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "matchcut-data-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of [
    "package.json",
    "manifest.json",
    "catalog",
    "assets",
    "scripts",
  ])
    await cp(path.join(root, name), path.join(dir, name), { recursive: true });
  const run = (...args) =>
    exec(process.execPath, [path.join(dir, "scripts/catalog.mjs"), ...args], {
      cwd: dir,
    });
  return { dir, run };
}

test("rejects changed photos before exporting any defaults", async (t) => {
  const { dir, run } = await fixture(t);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json")));
  const photo = manifest.files.find((entry) => entry.path.endsWith(".png"));
  const file = path.join(dir, photo.path);
  await writeFile(
    file,
    Buffer.concat([await readFile(file), Buffer.from("changed")]),
  );
  const app = path.join(dir, "app");
  await mkdir(app);
  await writeFile(path.join(app, "package.json"), '{"name":"matchcut"}');
  await assert.rejects(run("export", app), /manifest.json/);
  await assert.rejects(
    readFile(path.join(app, "data/fixtures/team-logos.json")),
    { code: "ENOENT" },
  );
});

test("rejects path traversal and duplicate provider identities", async (t) => {
  const { dir, run } = await fixture(t);
  const file = path.join(dir, "catalog/player-photos.json");
  const players = JSON.parse(await readFile(file));
  const original = players[0].artwork;
  players[0].artwork = "/assets/players/../outside.png";
  await writeFile(file, JSON.stringify(players));
  await assert.rejects(run("manifest"));
  players[0].artwork = original;
  players.push(players[0]);
  await writeFile(file, JSON.stringify(players));
  await assert.rejects(run("manifest"), /重复身份/);
});

test("exports compatible defaults while preserving user media, preferences and cache", async (t) => {
  const { dir, run } = await fixture(t);
  const app = path.join(dir, "app");
  await mkdir(app);
  await writeFile(path.join(app, "package.json"), '{"name":"unrelated"}');
  await assert.rejects(run("export", app), /目标必须是/);
  await writeFile(path.join(app, "package.json"), '{"name":"matchcut"}');
  const preserved = [
    "data/media-library.json",
    "data/preferences-lol.json",
    "data/cache/user.json",
    "public/assets/library/user.png",
  ];
  for (const file of preserved) {
    await mkdir(path.dirname(path.join(app, file)), { recursive: true });
    await writeFile(path.join(app, file), "user-owned");
  }
  await run("export", app);
  for (const file of preserved)
    assert.equal(await readFile(path.join(app, file), "utf8"), "user-owned");
  const players = JSON.parse(
    await readFile(path.join(app, "data/fixtures/player-photos.json")),
  );
  for (const player of players)
    assert.ok(
      (await readFile(path.join(app, "public", player.artwork))).length > 0,
    );
  for (const version of ["14.6","16.18"]) {
    const loadout=JSON.parse(await readFile(path.join(app,`data/fixtures/lol/loadout-catalogs/${version}.json`)));
    assert.equal(loadout.spells.length,9);
    for (const icon of [...loadout.spells,...loadout.runes]) assert.ok((await readFile(path.join(app,"public",icon.image))).length>0);
  }
  const champions = JSON.parse(
    await readFile(path.join(app, "data/fixtures/lol/champions.json")),
  );
  for (const name of ["players", "events"]) {
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(app, `data/fixtures/lol/${name}.json`)),
      ),
      JSON.parse(await readFile(path.join(dir, `catalog/lol-${name}.json`))),
    );
  }
  assert.deepEqual(
    champions,
    JSON.parse(await readFile(path.join(dir, "catalog/lol-champions.json"))),
  );
  for (const champion of Object.values(champions.data)) {
    for (const extension of ["png", "jpg"])
      assert.ok(
        (
          await readFile(
            path.join(app, `public/assets/lol/${champion.id}.${extension}`),
          )
        ).length > 0,
      );
  }
  const items = JSON.parse(
    await readFile(path.join(app, "data/fixtures/dota-items.json")),
  );
  assert.equal(items.items[116].name, "Black King Bar");
  for (const id of items.bundledIds)
    assert.ok(
      (await readFile(path.join(app, `public/assets/dota/items/${id}.png`)))
        .length > 0,
    );
  const exported = JSON.parse(
    await readFile(path.join(app, "data/fixtures/media-catalog-version.json")),
  );
  const lolItems = JSON.parse(
    await readFile(path.join(app, "data/fixtures/lol/item-catalogs/14.6.json")),
  );
  assert.equal(lolItems.version, "14.6.1");
  for (const id of lolItems.bundledIds)
    assert.ok(
      (
        await readFile(
          path.join(app, `public/assets/lol/items/14.6.1/${id}.png`),
        )
      ).length > 0,
    );
  assert.deepEqual(
    exported,
    JSON.parse(await readFile(path.join(dir, "manifest.json"))),
  );
});

test("release bundle includes usable app paths and matching SHA256", async (t) => {
  const { dir, run } = await fixture(t);
  await run("build");
  const { version } = JSON.parse(
    await readFile(path.join(dir, "package.json")),
  );
  const file = path.join(dir, `dist/matchcut-data-${version}.tar.gz`);
  const sha = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  assert.equal(
    await readFile(file + ".sha256", "utf8"),
    `${sha}  ${path.basename(file)}\n`,
  );
  const { stdout } = await exec("tar", ["-tzf", file]);
  assert.match(stdout, /data\/fixtures\/player-photos.json/);
  assert.match(stdout, /public\/assets\/players\/.+\.png/);
  assert.match(stdout, /catalog\/scope.json/);
  assert.match(stdout, /data\/fixtures\/lol\/champions.json/);
  assert.match(stdout, /public\/assets\/lol\/Ambessa.jpg/);
  assert.match(stdout, /data\/fixtures\/dota-items.json/);
  assert.match(stdout, /public\/assets\/dota\/items\/116.png/);
  assert.match(stdout, /data\/fixtures\/lol\/item-catalogs\/14.6.json/);
  assert.match(stdout, /public\/assets\/lol\/items\/14.6.1\/3157.png/);
  assert.doesNotMatch(
    stdout,
    /(?:media-library|preferences|node_modules|\.dem|\.mp4)/,
  );
});

test("incomplete hero libraries cannot become valid manifests or exports", async (t) => {
  const { dir, run } = await fixture(t);
  const file = path.join(dir, "assets/lol/Ambessa.jpg");
  const original = await readFile(file);
  await writeFile(file, original.subarray(0, original.length - 10));
  await assert.rejects(run("manifest"), /JPEG 文件不完整/);
  await rm(file);
  await assert.rejects(run("manifest"), /英雄素材缺失/);
});

test("event rosters cannot reference unknown people or publish a missing photo as available", async (t) => {
  const { dir, run } = await fixture(t);
  const eventFile = path.join(dir, "catalog/lol-events.json");
  const events = JSON.parse(await readFile(eventFile));
  const member = events.events[0].teams[0].players[0];
  const saved = member.playerId;
  member.playerId = "oe:unknown";
  await writeFile(eventFile, JSON.stringify(events));
  await assert.rejects(run("manifest"), /赛事引用未知选手/);
  member.playerId = saved;
  await writeFile(eventFile, JSON.stringify(events));
  const file = path.join(dir, "catalog/player-photos.json");
  const photos = JSON.parse(await readFile(file));
  await writeFile(
    file,
    JSON.stringify(photos.filter((p) => p.playerId !== saved)),
  );
  await assert.rejects(run("manifest"), /选手照片缺失/);
});
