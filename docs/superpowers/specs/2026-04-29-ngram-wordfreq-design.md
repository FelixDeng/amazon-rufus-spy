# N-gram 词频分析优化设计

**日期：** 2026-04-29  
**状态：** 已批准

---

## 背景

现有 Stage 2 词频分析只统计单个词的出现频次。本次优化改为同时统计 1/2/3-gram，并将高质量词组自动推送到关键词管理表供 Stage 4 搜索排名使用。

---

## 数据模型变更

### 词频分析表（新增字段）

| 字段 | 说明 |
|------|------|
| 词语 | 不变，现在可存词组，如 "AI powered"、"4K 60FPS" |
| 出现次数 | 不变，该 ASIN 内词组出现次数 |
| 词语来源 | 不变（标题 / 五点文案） |
| 分析批次 | 不变 |
| **词语长度** | **新增**，值为 `1`/`2`/`3`，方便飞书筛选 |

### 关键词管理表（写入逻辑新增）

词频分析后自动 upsert 候选词组，写入字段：
- 关键词（词组文本）
- 状态（固定值：待审核）

---

## 模块设计：`_amazon-wordfreq.js`

现有 `computeWordFreqRows` 保留但标记废弃，新增四个函数：

### `tokenize(text, stopwords)`
清洗文本，返回干净词数组。步骤：转小写 → 去标点 → split → 去首尾符号 → 过滤（长度≥2、非停用词、非纯数字）。

### `generateNgrams(words, n)`
从词数组生成所有 n-gram 字符串。  
例：`["AI", "powered", "camera"], 2` → `["AI powered", "powered camera"]`

### `isValidNgram(phraseWords, stopwords)`
边界过滤：首词和尾词均不在停用词表中才返回 `true`。

### `computeAllNgramRows(asin, text, source, batch, stopwords)`
对单个 ASIN 的一段文本，生成 1/2/3-gram 的所有行。  
返回：`[{ ASIN, 词语, 出现次数, 词语来源, 分析批次, 词语长度 }, ...]`

### `aggregateNgrams(allRows)`
输入所有 ASIN 的全部行，返回 `Map<词语, Set<ASIN>>`，用于跨 ASIN 出现次数统计。

---

## 流程设计：`amazon-analyze-wordfreq.mjs`

```
1. 读取 listings.json
2. 对每个 ASIN 的标题和五点文案调用 computeAllNgramRows → 收集 allRows[]
3. 调用 aggregateNgrams(allRows) → 得到 Map<词语, Set<ASIN>>
4. 全量写入词频表（含词语长度字段）
5. 过滤关键词候选：
   - 词语长度 >= 2（只推 bigram/trigram）
   - 出现 ASIN 数 >= 2
6. Upsert 写入关键词管理表：
   - 已存在 → 跳过
   - 新词条 → 写入，状态="待审核"
7. 输出汇总日志：词频 X 条，推荐关键词 Y 条（新增 Z，跳过 W）
```

---

## 过滤策略

| 过滤层 | 规则 | 目的 |
|--------|------|------|
| 边界过滤 | 首词或尾词是停用词 → 丢弃 | 去掉 "the camera"、"is very" 等噪音 |
| 跨 ASIN 门槛 | 出现 ASIN 数 < 2 → 不推关键词 | 只推有竞品共识的词组 |
| 长度过滤 | 词语长度 = 1 → 不推关键词（仍写词频表） | 单词噪音多，不自动进关键词管理 |

---

## 飞书字段说明

词语长度需在飞书「词频分析」表手动添加数字类型字段 `词语长度`，其余字段不变。  
关键词管理表只写「关键词」和「状态」两个字段（用户确认当前无其他字段）。
