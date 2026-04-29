/**
 * Compute word frequency rows from product text for Feishu table.
 * Returns array of {ASIN, 词语, 频次, 来源, 分析批次} objects.
 */
export function computeWordFreqRows(asin, text, source, batch, stopwords) {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length >= 2 && !stopwords.has(w) && !/^\d+$/.test(w));

  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq).map(([word, count]) => ({
    "ASIN": asin,
    "词语": word,
    "出现次数": count,
    "词语来源": source,
    "分析批次": batch,
  }));
}
