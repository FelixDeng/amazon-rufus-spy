---
name: amazon-spy
description: Run Amazon competitive analysis (3-stage pipeline: product listings → word frequency → RUFUS Q&A) and write all results to Feishu Base. Trigger when user asks to analyze competitor ASINs, run competitive analysis, scrape RUFUS Q&A, or refresh Feishu competitor data.
---

# Amazon Competitive Analysis Skill

This skill runs a 3-stage Amazon competitor intelligence pipeline:
- **Stage 1** — Scrape product titles, brands, and 5-point bullet copy
- **Stage 2** — Word frequency analysis across all scraped products
- **Stage 3** — Capture RUFUS AI Q&A (Amazon's shopping assistant answers for each product)

Results are written to three tables in a Feishu Base (多维表格).

**Announce at start:** "I'm running the Amazon competitive analysis skill."

---

## Finding SKILL_DIR

SKILL_DIR is the root of the plugin — the directory containing `scripts/`, `skills/`, and `package.json`.

- **Claude Code**: The system provides "Base directory for this skill: /some/path/skills". SKILL_DIR = parent of that path (one level up).
- **Other platforms**: Find the directory containing `skills/amazon-spy.md`. SKILL_DIR = parent of the `skills/` folder.

USER_DATA_DIR is always `~/.amazon-rufus-spy` (the user's home directory, writable on all platforms).

---

## Phase 0: Environment Check (run every time)

Run these checks in order. Stop with a clear message if any check fails.

### 0.1 Check Node.js

```bash
node --version
```

If missing or version < 18:
> "请先安装 Node.js 18 或更高版本：https://nodejs.org/en/download — 安装完成后重新运行。"
Stop.

### 0.2 Check npm dependencies

```bash
test -d "$SKILL_DIR/node_modules/playwright-extra" && echo "OK" || echo "MISSING"
```

If MISSING, install:
```bash
cd "$SKILL_DIR" && npm install
```
Wait for completion. If it fails:
> "依赖安装失败，请检查网络连接后重试。"
Stop.

### 0.3 Check lark-cli

```bash
lark-cli --version 2>/dev/null && echo "OK" || echo "MISSING"
```

If MISSING:
```bash
npm install -g @larksuite/cli
```
Then guide user through authentication:
```bash
lark-cli auth login
```
Follow the prompts. When complete, re-run the version check to confirm.

### 0.4 Check user data directory

```bash
mkdir -p ~/.amazon-rufus-spy
```

### 0.5 Check config

```bash
test -f ~/.amazon-rufus-spy/config.json && echo "OK" || echo "MISSING"
```

If MISSING → proceed to **Phase 1** (Setup Wizard).
If OK → skip to **Phase 3** (Execute).

---

## Phase 1: First-Time Setup Wizard (only if config.json missing)

Tell the user:
> "这是首次运行，需要配置一些信息，只需填写一次，之后每次运行全自动。"

Ask the following questions **one at a time**, collect all answers, then write files at the end.

**Q1:** "请输入要分析的竞品 ASIN 列表（用英文逗号分隔，例如：B0BXGFFSL1,B085TFF7M1）"

**Q2:** "请输入飞书 Base token（在飞书多维表格 URL 中，形如 SJnBbwm1...）"

**Q3:** "你的飞书 Base 里是否已有三张分析表（商品列表、词频分析、RUFUS 问答）？  
A — 已有，我来输入表 ID  
B — 还没有，帮我自动创建"

If A: ask for the three table IDs one by one (asins table, wordfreq table, rufus table).

If B: run the init script to create them:
```bash
cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/amazon-init-tables.mjs
```
Parse the output for three table IDs (lines like `表 "商品ASIN列表" 创建成功: tblXXX`).

**Q4:** "配送地区邮编？（直接回车使用默认值 10010）"
Default: `10010`

**Q5:** "Amazon 账号（手机号或邮箱）？"

**Q6:** "Amazon 账号密码？"

Write config files:

`~/.amazon-rufus-spy/config.json`:
```json
{
  "site": "US",
  "deliveryZip": "<Q4_ANSWER>",
  "baseId": "<Q2_ANSWER>",
  "tables": {
    "asins": "<ASINS_TABLE_ID>",
    "wordfreq": "<WORDFREQ_TABLE_ID>",
    "rufus": "<RUFUS_TABLE_ID>"
  },
  "asins": ["<ASIN1>", "<ASIN2>"]
}
```

`~/.amazon-rufus-spy/amazon.config.local.json`:
```json
{
  "phone": "<Q5_ANSWER>",
  "password": "<Q6_ANSWER>"
}
```

Confirm: "配置已保存到 `~/.amazon-rufus-spy/`。"

---

## Phase 2: Amazon Login Check

```bash
test -f ~/.amazon-rufus-spy/chrome-profile/Default/Cookies && echo "HAS_SESSION" || echo "NO_SESSION"
```

If NO_SESSION, tell the user:
> "即将打开 Chrome 窗口，请在 5 分钟内完成 Amazon 账号登录。登录成功后窗口会自动继续，无需手动关闭。"

(The script detects login state automatically — just proceed to Phase 3.)

---

## Phase 3: Execute Analysis

Determine intent from the user's message and run the matching command.

Set environment before every run:
```bash
export AMAZON_SPY_DIR=~/.amazon-rufus-spy
```

| User intent | Command |
|-------------|---------|
| 全量分析 / run all / 跑一下 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs` |
| 只抓商品文案 / stage 1 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs --stage 1` |
| 只跑词频 / stage 2 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs --stage 2` |
| 只跑 RUFUS / stage 3 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs --stage 3` |
| 强制重跑 / force | append `--force` to the command above |
| 指定 ASIN，例如"只跑 B0XX 和 B0YY" | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/amazon-scrape-rufus.mjs --asins B0XX,B0YY` |

Stream all output to the user in real time.

---

## Phase 4: Report Results

After the command exits, summarize in natural language. Parse the output for these patterns:

- `[ok] <ASIN>:` → Stage 1 success
- `[done] <ASIN>: N 条 RUFUS 问答已写入` → Stage 3 success, extract N
- `[skip] <ASIN>: 未检测到 RUFUS 模块` → no RUFUS on that product page (normal)
- `[skip] <ASIN>: 状态已完成` → already done, skipped (normal)
- `[error] <ASIN>:` → failure, show the error message

Example report:
> "分析完成！共处理 10 个竞品，结果已写入飞书：
> - 商品文案（表1）：10 条
> - 词频分析（表2）：1480 条
> - RUFUS 问答（表3）：84 条
>
> 跳过 2 个商品（B088TSR6YJ、B0DDTH3HX8），原因：这两个商品页面暂无 RUFUS 问答模块，属正常情况，不影响其他数据。"

Include the Feishu Base URL if available:
`https://bytedance.feishu.cn/base/<baseId>`

---

## Error Handling

| Output pattern | User-facing message | Recovery step |
|----------------|---------------------|---------------|
| `Could not find Chrome` / `Chrome not found` | "未找到 Chrome 浏览器" | "请先安装 Google Chrome：https://www.google.com/chrome/" |
| `TimeoutError` on login page | "Amazon 登录超时（5 分钟内未完成）" | "请重新运行，在弹出的 Chrome 窗口中完成登录" |
| `lark-cli ... 失败` + `validation` | "飞书配置有误" | "请检查 `~/.amazon-rufus-spy/config.json` 中的 baseId 和 table ID" |
| `lark-cli ... 失败` + `auth` / `401` | "飞书认证已过期" | 运行 `lark-cli auth login` 重新登录 |
| `Missing config.json` | "配置文件丢失" | 删除 `~/.amazon-rufus-spy/config.json` 并重新运行（触发 Phase 1 向导） |
| `[skip] ... 未检测到 RUFUS 模块` | 正常情况 | 无需处理，在结果汇报中说明 |
| `node: command not found` | "未找到 Node.js" | 参考 Phase 0.1 的安装链接 |
