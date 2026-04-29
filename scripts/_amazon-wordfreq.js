/**
 * @deprecated Use computeAllNgramRows instead.
 */
export function computeWordFreqRows(asin, text, source, batch, stopwords) {
  return computeAllNgramRows(asin, text, source, batch, stopwords).filter(r => r["词语长度"] === 1);
}

export function tokenize(text, stopwords) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length >= 2 && !stopwords.has(w) && !/^\d+$/.test(w));
}

export function generateNgrams(words, n) {
  if (words.length < n) return [];
  const result = [];
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(" "));
  }
  return result;
}

export function isValidNgram(phraseWords, stopwords) {
  return !stopwords.has(phraseWords[0]) && !stopwords.has(phraseWords[phraseWords.length - 1]);
}

export function computeAllNgramRows(asin, text, source, batch, stopwords) {
  const words = tokenize(text, stopwords);
  const freq = {};

  for (const n of [1, 2, 3]) {
    const ngrams = generateNgrams(words, n);
    for (const phrase of ngrams) {
      const phraseWords = phrase.split(" ");
      if (n > 1 && !isValidNgram(phraseWords, stopwords)) continue;
      const key = `${n}:${phrase}`;
      if (!freq[key]) freq[key] = { phrase, n, count: 0 };
      freq[key].count++;
    }
  }

  return Object.values(freq).map(({ phrase, n, count }) => ({
    "ASIN": asin,
    "词语": phrase,
    "出现次数": count,
    "词语来源": source,
    "分析批次": batch,
    "词语长度": n,
  }));
}

export function aggregateNgrams(allRows) {
  const map = new Map();
  for (const row of allRows) {
    const phrase = row["词语"];
    if (!map.has(phrase)) map.set(phrase, new Set());
    map.get(phrase).add(row["ASIN"]);
  }
  return map;
}
