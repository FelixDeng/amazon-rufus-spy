#!/usr/bin/env node
/**
 * 阶段2：读取 raw/listings.json，计算词频，写入飞书 Base 表2。
 * 每次运行追加新的分析批次，用"分析批次"字段区分不同时间的结果。
 *
 * 用法：
 *   node scripts/amazon-analyze-wordfreq.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, batchCreate, today } from "./_amazon-helpers.mjs";
import { computeWordFreqRows } from "./_amazon-wordfreq.js";
import { STOPWORDS } from "./_amazon-stopwords.js";

async function main() {
  const listingsPath = path.join(ROOT, "raw", "listings.json");
  if (!existsSync(listingsPath)) {
    console.error("未找到 raw/listings.json，请先运行阶段1");
    process.exit(1);
  }

  const listings = JSON.parse(readFileSync(listingsPath, "utf8"));
  const cfg = loadConfig();
  if (!cfg.tables?.wordfreq) {
    console.error("config.json: tables.wordfreq 未填写");
    process.exit(1);
  }
  const batch = today();
  const allRows = [];

  for (const item of listings) {
    const { asin, title, bullets } = item;

    // Title word frequency
    const titleRows = computeWordFreqRows(asin, title, "标题", batch, STOPWORDS);
    allRows.push(...titleRows);

    // Bullet points word frequency (all bullets joined as one text)
    const bulletsText = [].concat(bullets ?? []).join(" ");
    const bulletRows = computeWordFreqRows(asin, bulletsText, "五点文案", batch, STOPWORDS);
    allRows.push(...bulletRows);
  }

  console.log(`[wordfreq] 共 ${allRows.length} 行词频数据，开始写入飞书表2...`);
  const { success, failed } = batchCreate(cfg.baseId, cfg.tables.wordfreq, allRows);
  console.log(`[done] 写入完成：成功 ${success} 条，失败 ${failed} 条`);
}

main().catch(e => { console.error(e); process.exit(1); });
