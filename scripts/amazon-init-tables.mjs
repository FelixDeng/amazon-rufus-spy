#!/usr/bin/env node
/**
 * 一次性脚本：在指定飞书 Base 中创建竞品分析所需的三张表。
 *
 * 用法：
 *   node scripts/amazon-init-tables.mjs --base-token YOUR_BASE_TOKEN
 *
 * 成功后打印三张表的 tableId，填入 config.json 的 tables 字段。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { existsSync } from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function resolveLarkCli() {
  if (process.env.LARK_CLI) return process.env.LARK_CLI;
  if (process.platform === "win32") {
    const g = "D:\\nodejs\\node_global\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe";
    if (existsSync(g)) return g;
  }
  return "lark-cli";
}

function createTable(cli, baseToken, name, fields) {
  const ts = Date.now();
  const fieldsRel = `lark-fields-${ts}.json`;
  const viewRel = `lark-view-${ts}.json`;
  writeFileSync(fieldsRel, JSON.stringify(fields), "utf8");
  writeFileSync(viewRel, JSON.stringify([{ name: "默认表格", type: "grid" }]), "utf8");
  try {
    const r = spawnSync(
      cli,
      [
        "base", "+table-create",
        "--base-token", baseToken,
        "--name", name,
        "--fields", `@${fieldsRel}`,
        "--view", `@${viewRel}`,
      ],
      { encoding: "utf8", shell: false, windowsHide: true }
    );
    const raw = r.stdout.trim() || r.stderr.trim();
    let out;
    try {
      out = JSON.parse(raw);
    } catch {
      console.error(`创建表 "${name}" 返回非 JSON 输出:`, raw);
      process.exit(1);
    }
    if (r.status !== 0) {
      // 表已存在：从 hint 中提取 table_id
      const hint = out?.error?.hint || out?.error?.detail?.hint || "";
      const m = hint.match(/\(([a-zA-Z0-9]+)\)/);
      if (m) {
        console.log(`表 "${name}" 已存在，复用 ${m[1]}`);
        return m[1];
      }
      console.error(`创建表 "${name}" 失败:`, JSON.stringify(out, null, 2));
      process.exit(1);
    }
    return out.data?.table?.id || out.table?.table_id || out.table_id;
  } finally {
    try { unlinkSync(fieldsRel); } catch {}
    try { unlinkSync(viewRel); } catch {}
  }
}

const baseToken = arg("--base-token") || process.env.LARK_BASE_TOKEN;
if (!baseToken) {
  console.error("请传入 --base-token YOUR_BASE_TOKEN");
  process.exit(1);
}

const cli = resolveLarkCli();

// 表1：竞品 ASIN 列表
const t1 = createTable(cli, baseToken, "竞品ASIN列表", [
  { name: "ASIN", type: "text" },
  { name: "商品标题", type: "text" },
  { name: "品牌", type: "text" },
  { name: "五点文案", type: "text" },
  { name: "站点", type: "single_select", options: [{ name: "US" }, { name: "JP" }, { name: "UK" }, { name: "DE" }] },
  { name: "抓取状态", type: "single_select", options: [{ name: "待抓取" }, { name: "抓取中" }, { name: "已完成" }, { name: "失败" }] },
  { name: "最后抓取时间", type: "datetime", style: { format: "yyyy-MM-dd HH:mm" } },
  { name: "错误信息", type: "text" },
  { name: "备注", type: "text" },
]);

// 表2：词频分析
const t2 = createTable(cli, baseToken, "词频分析", [
  { name: "词语", type: "text" },
  { name: "ASIN", type: "text" },
  { name: "出现次数", type: "number" },
  { name: "词语来源", type: "single_select", options: [{ name: "标题" }, { name: "五点文案" }] },
  { name: "分析批次", type: "text" },
  { name: "分析时间", type: "datetime", style: { format: "yyyy-MM-dd HH:mm" } },
]);

// 表3：RUFUS 问答
const t3 = createTable(cli, baseToken, "RUFUS问答", [
  { name: "ASIN", type: "text" },
  { name: "商品标题", type: "text" },
  { name: "RUFUS位置", type: "single_select", options: [{ name: "主图区" }, { name: "侧边栏" }] },
  { name: "问题", type: "text" },
  { name: "回答", type: "text" },
  { name: "截图", type: "attachment" },
  { name: "抓取时间", type: "datetime", style: { format: "yyyy-MM-dd HH:mm" } },
]);

console.log("\n✅ 三张表创建成功，请将以下 ID 填入 config.json 的 tables 字段：\n");
console.log(JSON.stringify({ asins: t1, wordfreq: t2, rufus: t3 }, null, 2));
