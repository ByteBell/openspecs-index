// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause

export type Stability = "static" | "session" | "dynamic";
export interface Segment {
  text: string;
  stability: Stability;
  score: number;
  reason: string;
}
export interface AlignResult {
  prompt: string;
  stable: string;
  dynamic: string;
  segments: Segment[];
}
export interface AlignOptions {
  history?: string[];
  maxHistory?: number;
}

const PATTERNS: Array<{ name: string; pattern: RegExp; score: number }> = [
  {
    name: "iso-date",
    pattern: /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?\b/,
    score: 0.95,
  },
  { name: "unix-timestamp", pattern: /\b(unix|timestamp|ts|epoch)[_\s:=]+\d{10,13}\b/i, score: 1.0 },
  { name: "bare-timestamp", pattern: /\b\d{10,13}\b/, score: 0.7 },
  {
    name: "human-date",
    pattern:
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i,
    score: 0.95,
  },
  { name: "short-date", pattern: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, score: 0.9 },
  { name: "time", pattern: /\b\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?\b/i, score: 0.8 },
  { name: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, score: 1.0 },
  { name: "session-kv", pattern: /\b(session[_\s-]?id|sessionid|sess)[_\s:=]+\S+/i, score: 1.0 },
  {
    name: "request-kv",
    pattern: /\b(request[_\s-]?id|req[_\s-]?id|trace[_\s-]?id|correlation[_\s-]?id)[_\s:=]+\S+/i,
    score: 1.0,
  },
  { name: "job-kv", pattern: /\b(job[_\s-]?id|task[_\s-]?id|run[_\s-]?id|build[_\s-]?id)[_\s:=]+\S+/i, score: 1.0 },
  { name: "token-kv", pattern: /\b(token|api[_-]?key|auth)[_\s:=]+[A-Za-z0-9_\-.]{16,}/i, score: 1.0 },
  { name: "current-date", pattern: /\b(current|today.?s?|now.?s?)\s+(date|datetime|day)[_\s:=]+.+/i, score: 1.0 },
  { name: "current-time", pattern: /\b(current|local)\s+time[_\s:=]+.+/i, score: 1.0 },
  { name: "ip-address", pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/, score: 0.85 },
  { name: "random-id", pattern: /\b[A-Za-z0-9]{20,40}\b/, score: 0.6 },
];

export function patternScore(text: string): { score: number; reason: string } {
  let maxScore = 0,
    matchedName = "";
  for (const { name, pattern, score } of PATTERNS) {
    if (pattern.test(text) && score > maxScore) {
      maxScore = score;
      matchedName = name;
    }
  }
  return { score: maxScore, reason: maxScore > 0 ? `pattern:${matchedName}` : "pattern:none" };
}

function diceSim(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const m = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const cnt = m.get(b.slice(i, i + 2)) ?? 0;
    if (cnt > 0) {
      intersect++;
      m.set(b.slice(i, i + 2), cnt - 1);
    }
  }
  return (2 * intersect) / (a.length + b.length - 2);
}

function kvSim(a: string, b: string): number {
  const kv = /^([^:=]+)[:=]\s*(.+)$/;
  const am = a.trim().match(kv),
    bm = b.trim().match(kv);
  if (!am?.[1] || !am?.[2] || !bm?.[1] || !bm?.[2]) {
    return diceSim(a, b);
  }
  const aVal = am[2].trim(),
    bVal = bm[2].trim();
  if (!aVal || !bVal || (aVal.includes(" ") && aVal.length >= 40) || (bVal.includes(" ") && bVal.length >= 40)) {
    return diceSim(a, b);
  }
  const keySim = diceSim(am[1].toLowerCase(), bm[1].toLowerCase());
  if (keySim > 0.8) {
    return keySim * diceSim(aVal, bVal);
  }
  return diceSim(a, b);
}

export function varianceScore(segment: string, historySegmented: string[][]): { score: number; reason: string } {
  if (historySegmented.length === 0) {
    return { score: 0, reason: "variance:cold-start" };
  }
  let changeCount = 0;
  for (const past of historySegmented) {
    let best = 0;
    for (const s of past) {
      const sim = kvSim(s.trim(), segment.trim());
      if (sim > best) {
        best = sim;
      }
    }
    if (best < 0.5) {
      changeCount++;
    } else if (best < 0.98) {
      changeCount += 0.7;
    }
  }
  const score = Math.min(changeCount / historySegmented.length, 1);
  return { score, reason: score > 0.3 ? `variance:high(${Math.round(score * 100)}%)` : "variance:stable" };
}

export function shannonEntropy(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return Math.min(entropy / 6.57, 1);
}

export function compositeScore(
  segment: string,
  index: number,
  total: number,
  historySegmented: string[][],
): { score: number; stability: Stability; reason: string } {
  const pattern = patternScore(segment),
    variance = varianceScore(segment, historySegmented);
  const entropy = shannonEntropy(segment),
    position = total > 1 ? index / (total - 1) : 0;
  const coldStart = historySegmented.length === 0;
  const score = coldStart
    ? 0.65 * pattern.score + 0.15 * position + 0.2 * entropy
    : 0.4 * pattern.score + 0.3 * variance.score + 0.15 * position + 0.15 * entropy;
  let stability: Stability;
  if (pattern.score >= 0.95 || score >= 0.55) {
    stability = "dynamic";
  } else if (score >= 0.3) {
    stability = "session";
  } else {
    stability = "static";
  }
  const parts: string[] = [];
  if (pattern.score > 0) {
    parts.push(pattern.reason);
  }
  if (variance.score > 0.3) {
    parts.push(variance.reason);
  }
  parts.push(`entropy:${entropy.toFixed(2)}`);
  if (position > 0.7) {
    parts.push("position:late");
  }
  if (coldStart) {
    parts.push("cold-start");
  }
  return { score: Math.min(score, 1), stability, reason: parts.join(", ") || "static:default" };
}

export function splitIntoSegments(prompt: string): string[] {
  const segments: string[] = [];
  for (const line of prompt.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    if (line.length > 120) {
      segments.push(...line.split(/(?<=[.!?])\s+/).filter(Boolean));
    } else {
      segments.push(line);
    }
  }
  return segments;
}

export function align(prompt: string, options: AlignOptions = {}): AlignResult {
  const maxHistory = options.maxHistory ?? 10;
  const historySegmented = (options.history ?? []).slice(-maxHistory).map(splitIntoSegments);
  const segs = splitIntoSegments(prompt);
  const classified: Segment[] = segs.map((seg, i) => {
    const { score, stability, reason } = compositeScore(seg, i, segs.length, historySegmented);
    return { text: seg, stability, score, reason };
  });
  const byStability = (s: Stability) => classified.filter((x) => x.stability === s);
  const staticS = byStability("static"),
    sessionS = byStability("session"),
    dynamicS = byStability("dynamic");
  const txt = (arr: Segment[]) =>
    arr
      .map((s) => s.text)
      .join("\n")
      .trim();
  const stable = txt([...staticS, ...sessionS]),
    dynamic = txt(dynamicS);
  const parts: string[] = [];
  if (stable) {
    parts.push(stable);
  }
  if (dynamic) {
    parts.push(dynamic);
  }
  return { prompt: parts.join("\n\n"), stable, dynamic, segments: [...staticS, ...sessionS, ...dynamicS] };
}

interface BuilderEntry {
  text: string;
  stability: Stability;
}

export class PromptBuilder {
  private entries: BuilderEntry[] = [];
  add(text: string, stability: Stability = "static"): this {
    this.entries.push({ text: text.trim(), stability });
    return this;
  }
  static(text: string): this {
    return this.add(text, "static");
  }
  session(text: string): this {
    return this.add(text, "session");
  }
  dynamic(text: string): this {
    return this.add(text, "dynamic");
  }
  build(): AlignResult {
    const byStability = (s: Stability) => this.entries.filter((e) => e.stability === s);
    const staticS = byStability("static"),
      sessionS = byStability("session"),
      dynamicS = byStability("dynamic");
    const toSeg = (entries: BuilderEntry[], s: Stability): Segment[] =>
      entries.map((e) => ({
        text: e.text,
        stability: s,
        score: s === "static" ? 0 : s === "session" ? 0.4 : 0.9,
        reason: "builder:explicit",
      }));
    const segments = [...toSeg(staticS, "static"), ...toSeg(sessionS, "session"), ...toSeg(dynamicS, "dynamic")];
    const txt = (entries: BuilderEntry[]) =>
      entries
        .map((e) => e.text)
        .join("\n")
        .trim();
    const stable = txt([...staticS, ...sessionS]),
      dynamic = txt(dynamicS);
    const parts: string[] = [];
    if (stable) {
      parts.push(stable);
    }
    if (dynamic) {
      parts.push(dynamic);
    }
    return { prompt: parts.join("\n\n"), stable, dynamic, segments };
  }
  reset(): this {
    this.entries = [];
    return this;
  }
}
