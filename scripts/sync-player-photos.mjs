import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { checkImage } from "./lol-catalog.mjs";

// Downloads only reviewed person-to-provider mappings. Team membership is not
// part of the photo key, so transfers never create another photo identity.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "catalog/lol-players.json");
const catalog = JSON.parse(await readFile(file, "utf8"));
const seedsFile = path.join(root, "catalog/player-photos.json");
const seeds = JSON.parse(await readFile(seedsFile, "utf8"));
const staged = await mkdtemp(path.join(os.tmpdir(), "matchcut-players-"));
const pending = catalog.players.filter((p) => p.photoStatus === "available");
const results = [];
async function download(player) {
  const url = new URL(player.photo.imageUrl);
  assert.equal(url.protocol, "https:");
  assert.ok(!url.username && !url.password);
  const previous = seeds.find(
    (s) => s.game === "lol" && s.playerId === player.playerId,
  );
  const reuse =
    process.argv.includes("--reuse") &&
    previous?.source.imageUrl === player.photo.imageUrl;
  let bytes = reuse
    ? await readFile(path.join(root, previous.artwork.slice(1)))
    : undefined;
  for (let attempt = 0; !bytes && attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
      const raw = Buffer.from(await response.arrayBuffer());
      assert.ok(raw.length < 12 * 1024 * 1024, "Photo exceeds 12 MB");
      checkImage(raw, "png");
      bytes = raw;
      break;
    } catch (error) {
      if (attempt === 2) throw new Error(`${player.name}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 750));
    }
  }
  bytes = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 900,
      height: 900,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 7 })
    .toBuffer();
  checkImage(bytes, "png");
  const hash = createHash("sha256")
    .update(player.playerId)
    .digest("hex")
    .slice(0, 24);
  const filename = `lol-player-${hash}.png`;
  await writeFile(path.join(staged, filename), bytes);
  const source = {
    ...player.photo,
    fetchedAt: reuse ? previous.source.fetchedAt : new Date().toISOString(),
  };
  results.push({
    game: "lol",
    playerId: player.playerId,
    name: player.name,
    artwork: `/assets/players/${filename}`,
    source,
  });
  console.log(`${reuse ? "Normalized" : "Downloaded"} ${player.name}`);
}
try {
  let cursor = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (cursor < pending.length) await download(pending[cursor++]);
    }),
  );
  const failures = workers.filter((r) => r.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      "No catalog changes: one or more photos failed",
    );
  await mkdir(path.join(root, "assets/players"), { recursive: true });
  for (const entry of results) {
    await rename(
      path.join(staged, path.basename(entry.artwork)),
      path.join(root, entry.artwork.slice(1)),
    );
    const index = seeds.findIndex(
      (s) => s.game === "lol" && s.playerId === entry.playerId,
    );
    if (index < 0) seeds.push(entry);
    else seeds[index] = entry;
    catalog.players.find((p) => p.playerId === entry.playerId).photo =
      entry.source;
  }
  seeds.sort((a, b) =>
    `${a.game}:${a.playerId}`.localeCompare(`${b.game}:${b.playerId}`),
  );
  await writeFile(seedsFile, JSON.stringify(seeds, null, 2) + "\n");
  await writeFile(file, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Saved ${results.length} independent LoL player photos.`);
} finally {
  await rm(staged, { recursive: true, force: true });
}
