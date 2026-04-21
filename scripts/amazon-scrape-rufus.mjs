#!/usr/bin/env node
/**
 * 阶段3：用 Playwright 抓取每个 ASIN 的 RUFUS 问答和截图，写入飞书 Base 表3。
 *
 * 用法：
 *   node scripts/amazon-scrape-rufus.mjs
 *   node scripts/amazon-scrape-rufus.mjs --force
 *
 * 注意：RUFUS CSS 选择器需在实际 Amazon 页面验证后调整。
 * 调试：PWDEBUG=1 node scripts/amazon-scrape-rufus.mjs
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
chromium.use(StealthPlugin());
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ROOT, loadConfig, loadCreds,
  createRecord, uploadAttachment,
} from "./_amazon-helpers.mjs";

const force = process.argv.includes("--force");
const asinOverride = (() => {
  const idx = process.argv.indexOf("--asins");
  if (idx === -1) return null;
  return process.argv[idx + 1]?.split(",").map(s => s.trim()).filter(Boolean) || null;
})();

// ── Login helpers (same as Stage 1) ──────────────────────────────────

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

// ── RUFUS detection and scraping ──────────────────────────────────────

/**
 * Scrolls to trigger lazy-load, then checks for button.rufus-pill presence.
 * Returns the screenshot container selector, or null if RUFUS not found.
 */
async function waitForRufusMain(page) {
  await page.waitForTimeout(3000);
  for (let y = 0; y <= 5000; y += 400) {
    await page.evaluate(y => window.scrollTo(0, y), y);
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
  const pill = await page.$("button.rufus-pill").catch(() => null);
  if (pill) return "#dpx-rex-nice-widget-container";
  // Retry once with extra wait (slow-loading pages)
  await page.waitForTimeout(3000);
  const pill2 = await page.$("button.rufus-pill").catch(() => null);
  return pill2 ? "#dpx-rex-nice-widget-container" : null;
}

/**
 * Returns all button.rufus-pill texts from the inline widget (no element handle needed).
 */
async function getRufusQuestions(page) {
  const els = await page.$$("button.rufus-pill");
  const results = [];
  for (const el of els) {
    const text = await el.textContent().then(t => t.trim()).catch(() => "");
    if (text.length > 3 && text.length < 300) results.push(text);
  }
  return results;
}

/**
 * Opens the RUFUS sidebar by clicking the first inline pill with force.
 * Returns true if the panel appeared.
 */
async function openRufusSidebar(page) {
  const pill = await page.$("button.rufus-pill").catch(() => null);
  if (!pill) return false;
  await pill.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await pill.click({ force: true });
  const panel = await page.waitForSelector("#nav-flyout-rufus", { timeout: 15000 }).catch(() => null);
  if (!panel) return false;
  await page.waitForTimeout(1500);
  return true;
}

/**
 * Types questionText into the RUFUS text area, waits for the AI response,
 * captures a sidebar screenshot, and returns the answer text.
 * The answer is the second direct child of the last [id^='interaction'] div.
 */
async function askAndGetAnswer(page, questionText, sidebarShotPath) {
  const textArea = await page.waitForSelector("#rufus-text-area", { timeout: 10000 }).catch(() => null);
  if (!textArea) return "";

  // Clear announcer so we can detect when THIS response completes
  await page.evaluate(() => {
    const el = document.querySelector("#rufus-status-announcer");
    if (el) el.textContent = "";
  });

  await textArea.click({ force: true });
  await page.waitForTimeout(200);
  await textArea.fill(questionText);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");

  // Wait for completion signal (up to 30s), fall back to fixed wait
  await page.waitForFunction(
    () => (document.querySelector("#rufus-status-announcer")?.textContent || "").includes("Rufus has completed generating"),
    { timeout: 30000 }
  ).catch(() => page.waitForTimeout(20000));
  await page.waitForTimeout(500);

  const panelEl = await page.$("#nav-flyout-rufus");
  if (panelEl && sidebarShotPath) {
    await panelEl.screenshot({ path: sidebarShotPath }).catch(() => page.screenshot({ path: sidebarShotPath }));
  }

  // Answer is the 2nd direct child of the last interaction div (no id/class on it)
  const answer = await page.evaluate(() => {
    const interactions = [...document.querySelectorAll("[id^='interaction']")];
    const last = interactions[interactions.length - 1];
    if (!last) return "";
    const children = [...last.querySelectorAll(":scope > *")];
    return children[1]?.textContent.trim() || "";
  }).catch(() => "");

  return answer;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  if (!cfg.tables?.rufus) {
    console.error("config.json: tables.rufus 未填写");
    process.exit(1);
  }
  const creds = loadCreds();
  const screenshotDir = path.join(ROOT, "raw", "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 80,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);
    await setDeliveryZip(page, cfg.deliveryZip || "10010");

    for (const asin of (asinOverride || cfg.asins)) {
      console.log(`\n[rufus] 处理 ${asin}...`);
      try {
        await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        const title = await page.$eval("#productTitle", el => el.textContent.trim()).catch(() => "");
        const now = new Date().toISOString().replace("T", " ").slice(0, 16);

        const containerSel = await waitForRufusMain(page);
        if (!containerSel) {
          console.warn(`[skip] ${asin}: 未检测到 RUFUS 模块`);
          continue;
        }

        // Screenshot of the main image area RUFUS cards
        const mainShotPath = path.join(screenshotDir, `${asin}-rufus-main.png`);
        const rufusEl = await page.$(containerSel);
        if (rufusEl) {
          await rufusEl.screenshot({ path: mainShotPath }).catch(() =>
            page.screenshot({ path: mainShotPath, fullPage: false })
          );
        }

        const questions = await getRufusQuestions(page);
        if (questions.length === 0) {
          console.warn(`[skip] ${asin}: RUFUS 区域无可点击问题`);
          continue;
        }

        // Write main-image-area records (one per question card, first one gets screenshot)
        for (let i = 0; i < questions.length; i++) {
          const recId = createRecord(cfg.baseId, cfg.tables.rufus, {
            ASIN: asin,
            商品标题: title,
            "RUFUS位置": "主图区",
            问题: questions[i],
            回答: "",
            抓取时间: now,
          });
          if (i === 0 && recId) {
            if (existsSync(mainShotPath)) {
              try { uploadAttachment(cfg.baseId, cfg.tables.rufus, recId, mainShotPath); }
              catch (e) { console.warn(`[warn] 主图截图上传失败: ${e.message}`); }
            }
          }
        }

        // Open sidebar once, then ask each question via text input
        const sidebarOpen = await openRufusSidebar(page);
        if (!sidebarOpen) {
          console.warn(`[warn] ${asin}: 侧边栏打不开，跳过问答`);
          continue;
        }

        for (let i = 0; i < questions.length; i++) {
          const qText = questions[i];
          const sidebarShotPath = path.join(screenshotDir, `${asin}-rufus-sidebar-${i + 1}.png`);

          let answer = "";
          try {
            answer = await askAndGetAnswer(page, qText, sidebarShotPath);
            console.log(`  [q${i + 1}] "${qText.slice(0, 40)}" → ${answer.slice(0, 60)}...`);
          } catch (e) {
            console.warn(`  [warn] 问题 ${i + 1} 失败: ${e.message}`);
          }

          const sidebarRecId = createRecord(cfg.baseId, cfg.tables.rufus, {
            ASIN: asin,
            商品标题: title,
            "RUFUS位置": "侧边栏",
            问题: qText,
            回答: answer,
            抓取时间: now,
          });

          if (sidebarRecId && existsSync(sidebarShotPath)) {
            try { uploadAttachment(cfg.baseId, cfg.tables.rufus, sidebarRecId, sidebarShotPath); }
            catch (e) { console.warn(`  [warn] 侧边栏截图上传失败: ${e.message}`); }
          }
        }

        console.log(`[done] ${asin}: ${questions.length} 条 RUFUS 问答已写入`);
      } catch (e) {
        console.error(`[error] ${asin}: ${e.message}`);
      }
    }
  } finally {
    await context.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
