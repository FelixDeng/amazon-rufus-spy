#!/usr/bin/env node
/**
 * 阶段1：用 Playwright 抓取每个 ASIN 的标题、品牌、五点文案。
 * 输出：raw/listings.json
 * 写入：飞书 Base 表1（竞品ASIN列表）
 *
 * 用法：
 *   node scripts/amazon-scrape-listings.mjs
 *   node scripts/amazon-scrape-listings.mjs --force
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
chromium.use(StealthPlugin());
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  ROOT, loadConfig, loadCreds,
  listRecords, createRecord, updateRecord, today,
} from "./_amazon-helpers.mjs";

const force = process.argv.includes("--force");

const PROFILE_DIR = path.join(ROOT, "chrome-profile");

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
  console.log(`[zip] 设置配送地区为 ${zip}...`);
  const locationBtn = await page.waitForSelector("#glow-ingress-line2, #nav-global-location-popover-link", { timeout: 10000 }).catch(() => null);
  if (!locationBtn) {
    console.warn("[zip] 未找到配送位置按钮，跳过");
    return;
  }
  await locationBtn.click();
  const zipInput = await page.waitForSelector("#GLUXZipUpdateInput", { timeout: 8000 }).catch(() => null);
  if (!zipInput) {
    console.warn("[zip] 未找到邮编输入框，跳过");
    await page.keyboard.press("Escape");
    return;
  }
  await zipInput.fill("");
  await zipInput.type(zip, { delay: 80 });
  await page.click("#GLUXZipUpdate, [data-action='GLUXPostalUpdateAction']");
  await page.waitForTimeout(2000);
  const doneBtn = await page.$(".a-popover-footer button, #GLUXConfirmClose").catch(() => null);
  if (doneBtn) await page.evaluate(el => el.click(), doneBtn);
  await page.waitForTimeout(1000);
  console.log("[zip] 配送地区设置完成");
}

async function scrapeListing(page, asin) {
  console.log(`[scrape] 抓取 ${asin}...`);
  await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  const title = await page.$eval("#productTitle", el => el.textContent.trim()).catch(() => "");

  const brand = await page.$eval(
    "#bylineInfo, .po-brand .po-break-word, #brand",
    el => el.textContent.replace(/^(Brand:|Visit the|Store)/, "").trim()
  ).catch(() => "");

  const bullets = await page.$$eval(
    "#feature-bullets ul li:not(.aok-hidden) span.a-list-item",
    els => els.map(el => el.textContent.trim()).filter(Boolean)
  ).catch(() => []);

  return { asin, title, brand, bullets };
}

async function main() {
  const cfg = loadConfig();
  const creds = loadCreds();

  // Build ASIN → {recordId, status} map from Table 1
  const existing = {};
  try {
    const records = listRecords(cfg.baseId, cfg.tables.asins);
    for (const rec of records) {
      const asin = rec.fields?.["ASIN"] || rec.fields?.ASIN;
      if (asin) existing[asin] = { recordId: rec.record_id, status: rec.fields?.["抓取状态"] };
    }
  } catch (e) {
    console.warn("[warn] 无法读取表1现有记录，将全量抓取:", e.message);
  }

  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 50,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const results = [];

  try {
    await ensureLoggedIn(page);
    await setDeliveryZip(page, cfg.deliveryZip || "10010");

    for (const asin of cfg.asins) {
      const ex = existing[asin];
      if (!force && ex?.status === "已完成") {
        console.log(`[skip] ${asin} 状态已完成，跳过（--force 强制重跑）`);
        continue;
      }

      // Mark as in-progress
      const statusFields = { "抓取状态": "抓取中", ASIN: asin, 站点: cfg.site || "US" };
      if (ex?.recordId) {
        updateRecord(cfg.baseId, cfg.tables.asins, ex.recordId, statusFields);
      } else {
        const newId = createRecord(cfg.baseId, cfg.tables.asins, statusFields);
        if (!newId) {
          console.error(`[error] ${asin}: 无法创建表1记录，跳过`);
          continue;
        }
        existing[asin] = { recordId: newId, status: "抓取中" };
      }

      try {
        const listing = await scrapeListing(page, asin);
        results.push(listing);

        updateRecord(cfg.baseId, cfg.tables.asins, existing[asin].recordId, {
          ASIN: asin,
          商品标题: listing.title,
          品牌: listing.brand,
          五点文案: listing.bullets.join("\n"),
          抓取状态: "已完成",
          最后抓取时间: new Date().toISOString().replace("T", " ").slice(0, 16),
          错误信息: "",
        });
        console.log(`[ok] ${asin}: "${listing.title.slice(0, 40)}"`);
      } catch (e) {
        console.error(`[error] ${asin}: ${e.message}`);
        updateRecord(cfg.baseId, cfg.tables.asins, existing[asin].recordId, {
          抓取状态: "失败",
          错误信息: e.message.slice(0, 200),
        });
      }
    }
    mkdirSync(path.join(ROOT, "raw"), { recursive: true });
    const outPath = path.join(ROOT, "raw", "listings.json");
    writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`\n[done] 已写入 ${results.length} 条到 ${outPath}`);
  } finally {
    await context.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
