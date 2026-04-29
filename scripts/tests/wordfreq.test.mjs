import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, generateNgrams, isValidNgram, computeAllNgramRows, aggregateNgrams } from "../_amazon-wordfreq.js";
import { STOPWORDS } from "../_amazon-stopwords.js";

test("tokenize: 转小写、去标点、过停用词", () => {
  const result = tokenize("4K AI-Powered Camera, the best!", STOPWORDS);
  assert.deepEqual(result, ["4k", "ai-powered", "camera", "best"]);
});

test("generateNgrams: bigram", () => {
  assert.deepEqual(generateNgrams(["ai", "powered", "camera"], 2), ["ai powered", "powered camera"]);
});

test("generateNgrams: trigram", () => {
  assert.deepEqual(generateNgrams(["ai", "powered", "camera"], 3), ["ai powered camera"]);
});

test("generateNgrams: 词数不足返回空", () => {
  assert.deepEqual(generateNgrams(["ai"], 2), []);
});

test("isValidNgram: 首尾都不是停用词 → true", () => {
  assert.equal(isValidNgram(["ai", "powered", "camera"], STOPWORDS), true);
});

test("isValidNgram: 首词是停用词 → false", () => {
  assert.equal(isValidNgram(["the", "camera"], STOPWORDS), false);
});

test("isValidNgram: 尾词是停用词 → false", () => {
  assert.equal(isValidNgram(["camera", "for"], STOPWORDS), false);
});

test("computeAllNgramRows: 返回1/2/3-gram行，含词语长度", () => {
  const rows = computeAllNgramRows("B001", "AI camera", "标题", "2026-04-29", STOPWORDS);
  const lengths = new Set(rows.map(r => r["词语长度"]));
  assert.ok(lengths.has(1));
  assert.ok(lengths.has(2));
  rows.forEach(r => {
    assert.ok(r["ASIN"] === "B001");
    assert.ok(r["词语来源"] === "标题");
    assert.ok(r["分析批次"] === "2026-04-29");
    assert.ok(typeof r["出现次数"] === "number");
  });
});

test("aggregateNgrams: 跨 ASIN 聚合", () => {
  const rows = [
    { "ASIN": "B001", "词语": "ai camera", "词语长度": 2, "出现次数": 1 },
    { "ASIN": "B002", "词语": "ai camera", "词语长度": 2, "出现次数": 2 },
    { "ASIN": "B001", "词语": "streaming", "词语长度": 1, "出现次数": 1 },
  ];
  const map = aggregateNgrams(rows);
  assert.equal(map.get("ai camera").size, 2);
  assert.equal(map.get("streaming").size, 1);
});
