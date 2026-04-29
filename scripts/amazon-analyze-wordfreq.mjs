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

  // 候选：词组（≥2词）且跨 ASIN 数≥2
  const candidates = [...asinMap.entries()]
    .filter(([phrase, asins]) => phrase.split(" ").length >= 2 && asins.size >= 2)
    .map(([phrase]) => phrase);

  if (candidates.length === 0) {
    console.log("[keywords] 无符合条件的候选词组，跳过关键词推送");
    return;
  }

  // 读取已有关键词，避免重复写入
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
