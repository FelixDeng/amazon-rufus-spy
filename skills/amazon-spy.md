---
name: amazon-spy
description: Run Amazon competitive analysis (4-stage pipeline: product listings → word frequency → RUFUS Q&A → search rank analysis) and write all results to Feishu Base. Trigger when user asks to analyze competitor ASINs, run competitive analysis, scrape RUFUS Q&A, check keyword search rank, or refresh Feishu competitor data.
---

# Amazon Competitive Analysis Skill

This skill runs a 4-stage Amazon competitor intelligence pipeline:
- **Stage 1** — Scrape product titles, brands, and 5-point bullet copy
- **Stage 2** — Word frequency analysis across all scraped products
- **Stage 3** — Capture RUFUS AI Q&A (Amazon's shopping assistant answers for each product)
- **Stage 4** — Keyword search rank analysis (check if target ASINs appear in Amazon search results)

Results are written to five tables in a Feishu Base (多维表格).

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

**Q3:** "你的飞书 Base 里是否已有五张分析表（商品列表、词频分析、RUFUS 问答、关键词管理、搜索排名）？  
A — 已有，我来输入表 ID  
B — 还没有，帮我自动创建"

If A: ask for the five table IDs one by one (asins table, wordfreq table, rufus table, keywords table, search_rank table).

If B: run the init script to create them:
```bash
cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/amazon-init-tables.mjs --base-token <Q2_ANSWER>
```
Parse the JSON output for five table IDs: `asins`, `wordfreq`, `rufus`, `keywords`, `search_rank`.
After creation, tell the user: "五张表已创建。请在飞书「关键词管理」表中添加关键词并将状态设为「启用」，然后可运行 Stage 4 搜索排名分析。"

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
    "rufus": "<RUFUS_TABLE_ID>",
    "keywords": "<KEYWORDS_TABLE_ID>",
    "search_rank": "<SEARCH_RANK_TABLE_ID>"
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
| 强制重跑 / force | append `--force` to the command above (also applies to `--stage 4` and direct `amazon-search-rank.mjs`) |
| 指定 ASIN，例如"只跑 B0XX 和 B0YY" | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/amazon-scrape-rufus.mjs --asins B0XX,B0YY` |
| 搜索排名分析 / stage 4 / 关键词排名 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/run-all.mjs --stage 4` |
| 指定关键词搜索排名 | `cd "$SKILL_DIR" && AMAZON_SPY_DIR=~/.amazon-rufus-spy node scripts/amazon-search-rank.mjs --keywords "webcam,4K webcam"` |

Stream all output to the user in real time.

---

## Phase 4: Report Results

After the command exits, summarize in natural language. Parse the output for these patterns:

- `[ok] <ASIN>:` → Stage 1 success
- `[done] <ASIN>: N 条 RUFUS 问答已写入` → Stage 3 success, extract N
- `[skip] <ASIN>: 未检测到 RUFUS 模块` → no RUFUS on that product page (normal)
- `[skip] <ASIN>: 状态已完成` → already done, skipped (normal)
- `[error] <ASIN>:` → failure, show the error message
- `[ok] <ASIN>: 出现 自然位#N` → Stage 4: target ASIN found at organic rank N
- `[ok] <ASIN>: 出现 自然位#—(广告位)` → Stage 4: target ASIN found in sponsored only
- `[ok] <ASIN>: 未出现` → Stage 4: scan completed — ASIN not found on page 1 (normal, not an error)

Example report:
> "分析完成！共处理 10 个竞品，结果已写入飞书：
> - 商品文案（表1）：10 条
> - 词频分析（表2）：1480 条
> - RUFUS 问答（表3）：84 条
>
> 跳过 2 个商品（B088TSR6YJ、B0DDTH3HX8），原因：这两个商品页面暂无 RUFUS 问答模块，属正常情况，不影响其他数据。"

For Stage 4, report like:
> "搜索排名分析完成！共检查 5 个关键词 × 10 个目标 ASIN：
> - 「wireless webcam」：B0BXGFFSL1 出现在自然位 #3
> - 「4K webcam」：B0BXGFFSL1 未出现，B085TFF7M1 出现在广告位
> 结果已写入飞书搜索排名表。"

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
| `[warn] 没有启用的关键词` | "关键词管理表为空" | "请在飞书「关键词管理」表中添加关键词并将状态设为「启用」，然后重新运行 Stage 4" |
| `node: command not found` | "未找到 Node.js" | 参考 Phase 0.1 的安装链接 |
