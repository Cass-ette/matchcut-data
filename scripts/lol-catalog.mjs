import assert from "node:assert/strict";

export const dataDragon = "https://ddragon.leagueoflegends.com";

export function championEntries(catalog) {
  assert.match(catalog.version, /^\d+\.\d+\.\d+$/);
  const entries = Object.values(catalog.data);
  assert.ok(entries.length > 0, "英雄目录为空");
  const ids = new Set();
  const keys = new Set();
  for (const champion of entries) {
    assert.match(champion.id, /^[A-Za-z0-9]+$/);
    assert.match(champion.key, /^[1-9]\d*$/);
    assert.ok(typeof champion.name === "string" && champion.name.trim());
    assert.ok(!ids.has(champion.id) && !keys.has(champion.key), "重复英雄身份");
    ids.add(champion.id);
    keys.add(champion.key);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function championAssets(catalog) {
  return championEntries(catalog).flatMap(({ id }) => [
    {
      file: `${id}.png`,
      url: `${dataDragon}/cdn/${catalog.version}/img/champion/${id}.png`,
      format: "png",
    },
    // Riot's loading art URL is not patch-versioned; record its fetch date and hash.
    {
      file: `${id}.jpg`,
      url: `${dataDragon}/cdn/img/champion/loading/${id}_0.jpg`,
      format: "jpeg",
    },
  ]);
}

export function checkImage(bytes, format) {
  assert.ok(
    bytes.length > 100 && bytes.length <= 5 * 1024 * 1024,
    "英雄图片大小异常",
  );
  if (format === "png") {
    assert.equal(
      bytes.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "无效 PNG",
    );
    assert.equal(
      bytes.subarray(-8).toString("hex"),
      "49454e44ae426082",
      "PNG 文件不完整",
    );
  } else {
    assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8", "无效 JPEG");
    assert.equal(bytes.subarray(-2).toString("hex"), "ffd9", "JPEG 文件不完整");
  }
}
