# N-gram 词频分析优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Stage 2 词频分析从单词升级为 1/2/3-gram，并将跨 ASIN 高质量词组自动推送到飞书「关键词管理」表（状态=停用，供人工审核后启用）。

**Architecture:** `_amazon-wordfreq.js` 新增 `tokenize`、`generateNgrams`、`isValidNgram`、`computeAllNgramRows`、`aggregateNgrams` 五个函数；`amazon-analyze-wordfreq.mjs` 改用新函数并在写完词频表后做关键词 upsert。测试用 Node 内置 `node:test`。

**Tech Stack:** Node.js 18+ ESM, node:test, lark-cli（通过 `_amazon-helpers.mjs` 的 `listRecords`/`createRecord`/`batchCreate`）

---

## 文件清单

| 操作 | 路径 | 职责 |
|------|------|------|
| 修改 | `scripts/_amazon-wordfreq.js` | 新增五个函数，保留旧函数（废弃注释） |
| 修改 | `scripts/amazon-analyze-wordfreq.mjs` | 改用新函数，增加关键词 upsert 流程 |
| 新建 | `scripts/tests/wordfreq.test.mjs` | 单元测试 tokenize/generateNgrams/isValidNgram/computeAllNgramRows/aggregateNgrams |

---

## Task 1: 新函数实现（`_amazon-wordfreq.js`）

**Files:**
- Modify: `scripts/_amazon-wordfreq.js`

- [ ] **Step 1: 写失败测试**

新建 `scripts/tests/wordfreq.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd D:/cursor_work/amazon-rufus-spy
node --test scripts/tests/wordfreq.test.mjs
```

期望：失败，报 `tokenize is not exported` 等。

- [ ] **Step 3: 实现新函数**

将 `scripts/_amazon-wordfreq.js` 替换为：

```js
/**
 * @deprecated Use computeAllNgramRows instead.
 */
export function computeWordFreqRows(asin, text, source, batch, stopwords) {
  return computeAllNgramRows(asin, text, source, batch, stopwords).filter(r => r["词语长度"] === 1);
}

export function tokenize(text, stopwords) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length >= 2 && !stopwords.has(w) && !/^\d+$/.test(w));
}

export function generateNgrams(words, n) {
  if (words.length < n) return [];
  const result = [];
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(" "));
  }
  return result;
}

export function isValidNgram(phraseWords, stopwords) {
  return !stopwords.has(phraseWords[0]) && !stopwords.has(phraseWords[phraseWords.length - 1]);
}

export function computeAllNgramRows(asin, text, source, batch, stopwords) {
  const words = tokenize(text, stopwords);
  const freq = {};

  for (const n of [1, 2, 3]) {
    const ngrams = generateNgrams(words, n);
    for (const phrase of ngrams) {
      const phraseWords = phrase.split(" ");
      if (n > 1 && !isValidNgram(phraseWords, stopwords)) continue;
      const key = `${n}:${phrase}`;
      if (!freq[key]) freq[key] = { phrase, n, count: 0 };
      freq[key].count++;
    }
  }

  return Object.values(freq).map(({ phrase, n, count }) => ({
    "ASIN": asin,
    "词语": phrase,
    "出现次数": count,
    "词语来源": source,
    "分析批次": batch,
    "词语长度": n,
  }));
}

export function aggregateNgrams(allRows) {
  const map = new Map();
  for (const row of allRows) {
    const phrase = row["词语"];
    if (!map.has(phrase)) map.set(phrase, new Set());
    map.get(phrase).add(row["ASIN"]);
  }
  return map;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test scripts/tests/wordfreq.test.mjs
```

期望：所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/_amazon-wordfreq.js scripts/tests/wordfreq.test.mjs
git commit -m "feat: add n-gram support to _amazon-wordfreq.js (tokenize/generateNgrams/aggregateNgrams)"
```

---

## Task 2: 更新 orchestrator（`amazon-analyze-wordfreq.mjs`）

**Files:**
- Modify: `scripts/amazon-analyze-wordfreq.mjs`

飞书「关键词管理」表信息（已确认）：
- base token: 读自 `cfg.baseId`
- table id: `cfg.tables.keywords`
- 字段：关键词（text）、状态（select: "启用"|"停用"）、站点（select: "US"）

- [ ] **Step 1: 替换 `amazon-analyze-wordfreq.mjs` 全文**

```js
#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, batchCreate, listRecords, createRecord, today } from "./_amazon-helpers.mjs";
import { computeAllNgramRows, aggregateNgrams } from "./_amazon-wordfreq.js";
import { STOPWORDS } from "./_amazon-stopwords.js";

async function main() {
  const listingsPath = path.join(ROOT, "raw", "listings.json");
  if (!existsSync(listingsPath)) {
    console.error("未找到 raw/listings.json，请先运行阶段1");
    process.exit(1);
  }

  const listings = JSON.parse(readFileSync(listingsPath, "utf8"));
  const cfg = loadConfig();
  if (!cfg.tables?.wordfreq) { console.error("config.json: tables.wordfreq 未填写"); process.exit(1); }
  if (!cfg.tables?.keywords) { console.error("config.json: tables.keywords 未填写"); process.exit(1); }

  const batch = today();
  const allRows = [];

  for (const { asin, title, bullets } of listings) {
    const titleRows = computeAllNgramRows(asin, title, "标题", batch, STOPWORDS);
    allRows.push(...titleRows);
    const bulletsText = [].concat(bullets ?? []).join(" ");
    const bulletRows = computeAllNgramRows(asin, bulletsText, "五点文案", batch, STOPWORDS);
    allRows.push(...bulletRows);
  }

  // ── 写词频表 ──────────────────────────────────────────────────────────
  console.log(`[wordfreq] 共 ${allRows.length} 行词频数据，开始写入飞书表2...`);
  const { success, failed } = batchCreate(cfg.baseId, cfg.tables.wordfreq, allRows);
  console.log(`[done] 写入完成：成功 ${success} 条，失败 ${failed} 条`);

  // ── 推送关键词管理表 ────────────────────────────────────────────────
  const asinMap = aggregateNgrams(allRows);

  // 候选：词语长度≥2（词组）且跨 ASIN 数≥2
  const candidates = [...asinMap.entries()]
    .filter(([phrase, asins]) => phrase.split(" ").length >= 2 && asins.size >= 2)
    .map(([phrase]) => phrase);

  if (candidates.length === 0) {
    console.log("[keywords] 无符合条件的候选词组，跳过关键词推送");
    return;
  }

  // 读取已有关键词，避免重复
  let existingKeywords = new Set();
  try {
    const existing = listRecords(cfg.baseId, cfg.tables.keywords);
    for (const rec of existing) {
      const kw = rec.fields?.["关键词"] || "";
      if (kw) existingKeywords.add(kw.trim().toLowerCase());
    }
  } catch (e) {
    console.warn("[keywords] 读取已有关键词失败，将全量写入:", e.message);
  }

  let newCount = 0;
  let skipCount = 0;
  for (const phrase of candidates) {
    if (existingKeywords.has(phrase.toLowerCase())) {
      skipCount++;
      continue;
    }
    try {
      createRecord(cfg.baseId, cfg.tables.keywords, {
        "关键词": phrase,
        "状态": "停用",
        "站点": "US",
      });
      newCount++;
    } catch (e) {
      console.warn(`[keywords] 写入失败 "${phrase}": ${e.message}`);
    }
  }

  console.log(`[keywords] 推荐关键词 ${candidates.length} 条：新增 ${newCount}，跳过已有 ${skipCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 本地试跑（不写飞书，验证逻辑）**

```bash
cd D:/cursor_work/amazon-rufus-spy
node -e "
import('./scripts/_amazon-wordfreq.js').then(m => {
  import('./scripts/_amazon-stopwords.js').then(s => {
    const rows = m.computeAllNgramRows('B001', 'AI powered 4K camera for live streaming', '标题', '2026-04-29', s.STOPWORDS);
    const byLen = {1:0,2:0,3:0};
    rows.forEach(r => byLen[r['词语长度']]++);
    console.log('1-gram:', byLen[1], '2-gram:', byLen[2], '3-gram:', byLen[3]);
    console.log('sample:', rows.slice(0,3));
  });
});
"
```

期望输出示例：
```
1-gram: 5  2-gram: 4  3-gram: 3
sample: [
  { ASIN: 'B001', 词语: 'ai', 出现次数: 1, 词语来源: '标题', 分析批次: '2026-04-29', 词语长度: 1 },
  ...
]
```

- [ ] **Step 3: 完整 Stage 2 试跑**

```bash
cd D:/cursor_work/amazon-rufus-spy
AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs --stage 2
```

期望日志结尾：
```
[done] 写入完成：成功 XXXX 条，失败 0 条
[keywords] 推荐关键词 XX 条：新增 XX，跳过已有 0
```

如有失败条目，查看具体错误排查字段名问题。

- [ ] **Step 4: Commit**

```bash
git add scripts/amazon-analyze-wordfreq.mjs
git commit -m "feat: upgrade Stage 2 to n-gram wordfreq and auto-push candidates to keywords table"
```

---

## Task 3: 推送并打版本包

- [ ] **Step 1: Push 到 GitHub**

```bash
git push origin master
```

- [ ] **Step 2: 打版本 zip**

```bash
cd D:/cursor_work/amazon-rufus-spy
git archive --format=zip --prefix=amazon-rufus-spy/ HEAD -o "../amazon-rufus-spy-V03-260429.zip"
ls -lh ../amazon-rufus-spy-V03-260429.zip
```
