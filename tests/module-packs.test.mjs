import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { assetsForGame, buildModulePacks } from "../scripts/module-packs.mjs";

test("game packs partition media and publish verified independently installable streams", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matchcut-packs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = ["assets/heroes/1.png", "assets/renders/1.png", "assets/dota/items/1.png", "assets/lol/Ashe.png", "assets/players/lol-player-1.png", "assets/teams/lol-team.png", "assets/cs/maps/nuke.png", "assets/players/cs2-player-1.png", "assets/teams/cs2-team.png", "assets/placeholders/player.png", "catalog/lol-champions.json"];
  const files = [];
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  for (const file of paths) {
    const bytes = Buffer.from(file);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), bytes);
    files.push({ path: file, bytes: bytes.length, sha256: sha(bytes) });
  }
  const selected = ["dota2", "lol", "cs2"].flatMap(game => assetsForGame(game, files).map(f => f.path));
  assert.equal(new Set(selected).size, selected.length);
  assert.equal(selected.length, 9);
  const catalog = await buildModulePacks(root, { version: "0.6.0", files });
  for (const pack of catalog.modules) {
    const archive = await readFile(path.join(root, "dist", pack.file));
    assert.equal(sha(archive), pack.sha256);
    assert.equal(archive.length, pack.bytes);
    const [header, ...records] = gunzipSync(archive).toString().trim().split("\n").map(line => JSON.parse(line));
    assert.equal(header.game, pack.game);
    assert.equal(records.length, pack.files);
    assert.equal(records.reduce((sum, r) => sum + r.bytes, 0), pack.installedBytes);
    for (const record of records) {
      const bytes = Buffer.from(record.data, "base64");
      assert.equal(sha(bytes), record.sha256);
      assert.deepEqual(bytes, await readFile(path.join(root, record.path.replace(/^public\//, ""))));
    }
  }
});
