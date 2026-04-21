#!/usr/bin/env node
/**
 * 入口：顺序执行三个阶段。
 *
 * 用法：
 *   node scripts/run-all.mjs           （跳过状态已完成的 ASIN）
 *   node scripts/run-all.mjs --force   （强制全量重跑）
 *   node scripts/run-all.mjs --stage 1 （只跑阶段1）
 *   node scripts/run-all.mjs --stage 2 （只跑阶段2）
 *   node scripts/run-all.mjs --stage 3 （只跑阶段3）
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes("--force") ? ["--force"] : [];
const stageArg = (() => {
  const i = process.argv.indexOf("--stage");
  return i >= 0 ? process.argv[i + 1] : null;
})();

function runStage(name, script, extraArgs = []) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`▶ ${name}`);
  console.log("=".repeat(50));
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, script), ...extraArgs],
    { stdio: "inherit", shell: false }
  );
  if (r.status !== 0) {
    console.error(`\n✗ ${name} 失败（退出码 ${r.status}）`);
    process.exit(r.status || 1);
  }
  console.log(`✓ ${name} 完成`);
}

const stages = {
  "1": () => runStage("阶段1：文案抓取", "amazon-scrape-listings.mjs", force),
  "2": () => runStage("阶段2：词频分析", "amazon-analyze-wordfreq.mjs"),
  "3": () => runStage("阶段3：RUFUS抓取", "amazon-scrape-rufus.mjs", force),
};

if (stageArg) {
  if (!stages[stageArg]) {
    console.error(`未知阶段: --stage ${stageArg}（可选: 1, 2, 3）`);
    process.exit(1);
  }
  stages[stageArg]();
} else {
  stages["1"]();
  stages["2"]();
  stages["3"]();
}
