import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const modules = [
  { game: "dota2", directories: ["assets/heroes", "assets/renders", "assets/dota"], prefix: "dota" },
  { game: "lol", directories: ["assets/lol"], prefix: "lol" },
  { game: "cs2", directories: ["assets/cs"], prefix: "cs2" },
];
export function assetsForGame(game, files) {
  const definition = modules.find(m => m.game === game);
  if (!definition) throw new Error("Unknown game");
  return files.filter(f => definition.directories.some(d => f.path.startsWith(d + "/")) ||
    ["teams", "players"].some(d => f.path.startsWith(`assets/${d}/${definition.prefix}-`)));
}
export async function buildModulePacks(root, manifest) {
  const output = path.join(root, "dist");
  await mkdir(output, { recursive: true });
  const catalog = { schemaVersion: 1, version: manifest.version, modules: [] };
  for (const { game } of modules) {
    const files = assetsForGame(game, manifest.files);
    const filename = `matchcut-${game}-${manifest.version}.pack.gz`;
    async function* records() {
      yield JSON.stringify({ schemaVersion: 1, game, version: manifest.version }) + "\n";
      for (const entry of files) {
        const bytes = await readFile(path.join(root, entry.path));
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (sha256 !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Asset changed during build: ${entry.path}`);
        yield JSON.stringify({ path: "public/" + entry.path, bytes: bytes.length, sha256, data: bytes.toString("base64") }) + "\n";
      }
    }
    const destination = path.join(output, filename);
    await pipeline(Readable.from(records()), createGzip({ level: 6 }), createWriteStream(destination));
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(destination)) digest.update(chunk);
    catalog.modules.push({ game, version: manifest.version, file: filename, bytes: (await stat(destination)).size, sha256: digest.digest("hex"), files: files.length, installedBytes: files.reduce((sum, f) => sum + f.bytes, 0) });
  }
  await writeFile(path.join(output, "modules.json"), JSON.stringify(catalog, null, 2) + "\n");
  console.log("Built independent Dota 2, LoL and CS game packs.");
  return catalog;
}
