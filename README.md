# Amazon Rufus Spy

AI skill plugin: Amazon competitive analysis pipeline → Feishu Base.

Scrapes product listings, runs word frequency analysis, and captures RUFUS AI Q&A for a list of competitor ASINs. Results are written directly to Feishu Base (多维表格).

## Requirements

- Node.js ≥ 18
- Google Chrome (installed on the machine)
- [lark-cli](https://github.com/larksuite/lark-cli) (`npm install -g @larksuite/cli`)
- A Feishu Base with 3 tables (or let the skill create them)

## Installation

### Option A: Button import (GitHub URL)

In your AI platform's skill import UI, paste:
```
https://github.com/FelixDeng/amazon-rufus-spy
```

### Option B: Claude Code plugin

```bash
claude plugin install github:FelixDeng/amazon-rufus-spy
```

### Option C: Manual clone

```bash
git clone https://github.com/FelixDeng/amazon-rufus-spy
# Then tell your AI: "read AGENTS.md or CLAUDE.md in the cloned directory"
```

## Usage

Once installed, just tell the AI:

- "帮我分析这些竞品 ASIN：B0BXGFFSL1, B085TFF7M1, ..."
- "跑一下竞品分析"
- "只跑 RUFUS 阶段"
- "强制重跑 B0BXGFFSL1"

The AI handles everything: first-time setup, Amazon login, pipeline execution, and reporting results.

## What gets stored

User data is stored at `~/.amazon-rufus-spy/` (never inside the plugin):

```
~/.amazon-rufus-spy/
  config.json                  # Your ASINs, Feishu Base IDs
  amazon.config.local.json     # Amazon credentials (local only)
  chrome-profile/              # Persistent Amazon session (no re-login needed)
  raw/                         # Intermediate JSON files and screenshots
```

## Feishu Base tables

The pipeline writes to 3 tables:

| Table | Contents |
|-------|---------|
| 商品ASIN列表 | ASIN, title, brand, 5-bullet copy, scrape status |
| 词频分析 | Word, frequency count, ASIN source |
| RUFUS问答 | ASIN, question, AI answer, screenshot attachment |

## Skill file

The complete AI behavior specification is in [`skills/amazon-spy.md`](skills/amazon-spy.md).
