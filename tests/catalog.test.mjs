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
  for (const name of ["package.json", "manifest.json", "catalog", "assets", "scripts"])
    await cp(path.join(root, name), path.join(dir, name), { recursive: true });
  const run = (...args) => exec(process.execPath, [path.join(dir, "scripts/catalog.mjs"), ...args], { cwd: dir });
  return { dir, run };
}

test("rejects changed photos before exporting any defaults", async (t) => {
  const { dir, run } = await fixture(t);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json")));
  const photo = manifest.files.find((entry) => entry.path.endsWith(".png"));
  const file = path.join(dir, photo.path);
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from("changed")]));
  const app = path.join(dir, "app");
  await mkdir(app);
  await writeFile(path.join(app, "package.json"), '{"name":"matchcut"}');
  await assert.rejects(run("export", app), /manifest.json/);
  await assert.rejects(readFile(path.join(app, "data/fixtures/team-logos.json")), { code: "ENOENT" });
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
  const preserved = ["data/media-library.json", "data/preferences-lol.json", "data/cache/user.json", "public/assets/library/user.png"];
  for (const file of preserved) {
    await mkdir(path.dirname(path.join(app, file)), { recursive: true });
    await writeFile(path.join(app, file), "user-owned");
  }
  await run("export", app);
  for (const file of preserved) assert.equal(await readFile(path.join(app, file), "utf8"), "user-owned");
  const players = JSON.parse(await readFile(path.join(app, "data/fixtures/player-photos.json")));
  for (const player of players) assert.ok((await readFile(path.join(app, "public", player.artwork))).length > 0);
  const exported = JSON.parse(await readFile(path.join(app, "data/fixtures/media-catalog-version.json")));
  assert.deepEqual(exported, JSON.parse(await readFile(path.join(dir, "manifest.json"))));
});

test("release bundle includes usable app paths and matching SHA256", async (t) => {
  const { dir, run } = await fixture(t);
  await run("build");
  const { version } = JSON.parse(await readFile(path.join(dir, "package.json")));
  const file = path.join(dir, `dist/matchcut-data-${version}.tar.gz`);
  const sha = createHash("sha256").update(await readFile(file)).digest("hex");
  assert.equal(await readFile(file + ".sha256", "utf8"), `${sha}  ${path.basename(file)}\n`);
  const { stdout } = await exec("tar", ["-tzf", file]);
  assert.match(stdout, /data\/fixtures\/player-photos.json/);
  assert.match(stdout, /public\/assets\/players\/.+\.png/);
  assert.match(stdout, /catalog\/scope.json/);
  assert.doesNotMatch(stdout, /(?:media-library|preferences|node_modules|\.dem|\.mp4)/);
});
