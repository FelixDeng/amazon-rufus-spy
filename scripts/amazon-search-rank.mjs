#!/usr/bin/env node
/**
 * 阶段4：搜索排名分析。
 * 对每个启用的关键词执行 Amazon 首页搜索，提取自然位和广告位 ASIN，
 * 检查目标 ASIN 是否出现及其排名，写入飞书 Base 搜索排名表。
 *
 * 用法：
 *   node scripts/amazon-search-rank.mjs
 *   node scripts/amazon-search-rank.mjs --force
 *   node scripts/amazon-search-rank.mjs --keywords "wireless webcam,4K webcam"
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
chromium.use(StealthPlugin());
import path from "node:path";
import {
  ROOT, loadConfig,
  listRecords, createRecord,
} from "./_amazon-helpers.mjs";

const force = process.argv.includes("--force");
const keywordsOverride = (() => {
  const idx = process.argv.indexOf("--keywords");
  if (idx === -1) return null;
  return process.argv[idx + 1]?.split(",").map(s => s.trim()).filter(Boolean) || null;
})();

const PROFILE_DIR = path.join(ROOT, "chrome-profile");

// ── Login helpers ──────────────────────────────────────────────────────

async function isLoggedIn(page) {
  const text = await page.$eval("#nav-link-accountList-nav-line-1", el => el.textContent.trim()).catch(() => null);
  if (text === null) return false;
  return !text.toLowerCase().includes("sign in") && !text.toLowerCase().includes("hello, sign in");
}

async function ensureLoggedIn(page) {
  await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await isLoggedIn(page)) {
    console.log("[login] 已登录");
    return;
  }
  console.log("[login] 未登录，正在打开登录页 — 请在弹出的浏览器窗口中完成登录（5分钟超时）...");
  await page.goto("https://www.amazon.com/gp/sign-in.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(
    url => { const s = String(url); return !s.includes("/ap/signin") && !s.includes("/gp/sign-in"); },
    { timeout: 300000 }
  );
  console.log("[login] 登录完成");
}

async function setDeliveryZip(page, zip) {
  try {
    const locationBtn = await page.waitForSelector("#glow-ingress-line2, #nav-global-location-popover-link", { timeout: 10000 }).catch(() => null);
    if (!locationBtn) return;
    await locationBtn.click();
    const zipInput = await page.waitForSelector("#GLUXZipUpdateInput", { timeout: 8000 }).catch(() => null);
    if (!zipInput) { await page.keyboard.press("Escape"); return; }
    await zipInput.fill("");
    await zipInput.type(zip, { delay: 80 });
    await page.click("#GLUXZipUpdate, [data-action='GLUXPostalUpdateAction']", { timeout: 8000 });
    await page.waitForTimeout(2000);
    const doneBtn = await page.$(".a-popover-footer button, #GLUXConfirmClose").catch(() => null);
    if (doneBtn) await doneBtn.click();
    await page.waitForTimeout(1000);
    console.log(`[zip] 配送地区已设为 ${zip}`);
  } catch (e) {
    console.warn(`[zip] 设置配送地区失败（跳过）: ${e.message.split("\n")[0]}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

// ── Search scraping ────────────────────────────────────────────────────

async function searchAndExtract(page, keyword) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const items = await page.$$eval(
    '[data-component-type="s-search-result"][data-asin]',
    els => els
      .filter(el => el.dataset.asin && el.dataset.asin.length >= 10)
      .map(el => ({
        asin: el.dataset.asin,
        sponsored: !!(
          el.querySelector('.puis-sponsored-label-text') ||
          el.querySelector('[aria-label="Sponsored"]') ||
          el.querySelector('[class*="AdHolder"]')
        ),
      }))
  );

  const sponsored = items.filter(i => i.sponsored);
  const organic = items.filter(i => !i.sponsored);
  return { sponsored, organic };
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  if (!cfg.tables?.keywords) {
    console.error("config.json: tables.keywords 未填写");
    process.exit(1);
  }
  if (!cfg.tables?.search_rank) {
    console.error("config.json: tables.search_rank 未填写");
    process.exit(1);
  }
  if (!cfg.tables?.asins) {
    console.error("config.json: tables.asins 未填写");
    process.exit(1);
  }

  // Load keywords
  let keywords;
  if (keywordsOverride) {
    keywords = keywordsOverride;
    console.log(`[keywords] 使用命令行覆盖: ${keywords.join(", ")}`);
  } else {
    const kwRecords = listRecords(cfg.baseId, cfg.tables.keywords);
    keywords = kwRecords
      .filter(r => r.fields["状态"] === "启用")
      .map(r => r.fields["关键词"])
      .filter(Boolean);
  }

  if (keywords.length === 0) {
    console.log("[warn] 没有启用的关键词，请在飞书「关键词管理」表中添加并设为「启用」");
    return;
  }
  console.log(`[keywords] 共 ${keywords.length} 个关键词`);

  // Load target ASINs
  const asinRecords = listRecords(cfg.baseId, cfg.tables.asins);
  const targetAsins = asinRecords
    .map(r => ({ asin: r.fields["ASIN"], title: r.fields["商品标题"] || "" }))
    .filter(r => r.asin);

  if (targetAsins.length === 0) {
    console.error("[error] asins 表为空，请先运行 Stage 1 抓取商品文案");
    process.exit(1);
  }
  console.log(`[asins] 共 ${targetAsins.length} 个目标 ASIN`);

  // Build skip set (keyword::asin pairs already done)
  const existingRecords = force ? [] : listRecords(cfg.baseId, cfg.tables.search_rank);
  const doneKeys = new Set(
    existingRecords
      .filter(r => r.fields["状态"] === "已完成")
      .map(r => `${r.fields["关键词"]}::${r.fields["目标ASIN"]}`)
  );

  // Browser
  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 60,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);
    await setDeliveryZip(page, cfg.deliveryZip || "10010");

    for (const keyword of keywords) {
      console.log(`\n[search] "${keyword}"`);
      try {
        const { sponsored, organic } = await searchAndExtract(page, keyword);

        const sponsoredStr = sponsored.map((item, i) => `#${i + 1}:${item.asin}`).join(", ");
        const organicStr = organic.map((item, i) => `#${i + 1}:${item.asin}`).join(", ");
        console.log(`  广告位: ${sponsored.length} 个  自然位: ${organic.length} 个`);

        for (const target of targetAsins) {
          const now = new Date().toISOString().replace("T", " ").slice(0, 16);
          const key = `${keyword}::${target.asin}`;
          if (!force && doneKeys.has(key)) {
            console.log(`  [skip] ${target.asin}: 状态已完成`);
            continue;
          }

          const organicIdx = organic.findIndex(i => i.asin === target.asin);
          const sponsoredIdx = sponsored.findIndex(i => i.asin === target.asin);
          const appeared = organicIdx >= 0 || sponsoredIdx >= 0;
          const organicRank = organicIdx >= 0 ? organicIdx + 1 : null;
          const sponsoredRank = sponsoredIdx >= 0 ? sponsoredIdx + 1 : null;

          const fields = {
            "关键词": keyword,
            "目标ASIN": target.asin,
            "商品标题": target.title,
            "是否出现": appeared ? "是" : "否",
            "广告位排序+ASIN": sponsoredStr || "",
            "自然位排序+ASIN": organicStr || "",
            "状态": "已完成",
            "抓取时间": now,
          };
          if (organicRank !== null) fields["自然位排名"] = organicRank;
          if (sponsoredRank !== null) fields["广告位排名"] = sponsoredRank;

          createRecord(cfg.baseId, cfg.tables.search_rank, fields);
          const pos = organicRank ? `自然位#${organicRank}` : sponsoredRank ? `广告位#${sponsoredRank}` : "—";
          console.log(`  [ok] ${target.asin}: ${appeared ? `出现 ${pos}` : "未出现"}`);
        }
      } catch (e) {
        console.error(`[error] "${keyword}": ${e.message}`);
      }

      // Random delay between keywords to avoid detection
      const delay = 2000 + Math.random() * 2000;
      await page.waitForTimeout(delay);
    }
  } finally {
    await context.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
