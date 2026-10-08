// Dependency-free: safe to use at CLI, log, evidence, and presentation boundaries.
const KEY = "(?:access[-_ ]?token|auth(?:entication)?[-_ ]?token|api[-_ ]?key|client[-_ ]?secret|credential(?:s)?|android[-_ ]?(?:keystore|keyalias)[-_ ]?(?:pass(?:word)?|pwd)|(?:keystore|key[-_ ]?alias)[-_ ]?(?:pass(?:word)?|pwd)|password|passwd|secret|token|bearer|authorization|private[-_ ]?key)";
const ASSIGNMENT = new RegExp(`(^|[^A-Za-z0-9_])((?:-{1,2})?${KEY})(["']?\\s*[:=]\\s*)`, "gi");
const ARGUMENT = new RegExp(`(^|[^A-Za-z0-9_])((?:-{1,2})${KEY})([ \\t]+)`, "gi");
const BEARER = /\b(Bearer)([ \t]+)/gi;

function valueEnd(text: string, start: number): number {
  const existing = text.slice(start).match(/^\[redacted\]/i);
  if (existing) return start + existing[0].length;
  const bearer = text.slice(start).match(/^Bearer[ \t]+/i);
  if (bearer) return valueEnd(text, start + bearer[0].length);
  // Include C# verbatim/interpolated prefixes used by eval diagnostics.
  const prefix = text.slice(start).match(/^(?:\$@?|@\$?)(?=["'])/);
  const quoteAt = start + (prefix?.[0].length ?? 0);
  const quote = text[quoteAt];
  if (quote === '"' || quote === "'") {
    for (let i = quoteAt + 1; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === quote) {
        if (text[i + 1] === quote) { i++; continue; }
        return i + 1;
      }
    }
    return text.length; // Fail closed for incomplete log/diagnostic quotes.
  }
  let end = start;
  while (end < text.length && !/[\s,;)}\]]/.test(text[end])) end++;
  return end;
}

/** Redact before slicing: truncating first can remove the key or expose a quoted tail. */
export function redactUnityCredentials(value: string, options: { marker?: string; assignmentSpace?: boolean } = {}): string {
  const marker = options.marker ?? "[redacted]";
  let text = value;
  for (const pattern of [ASSIGNMENT, ARGUMENT, BEARER]) {
    pattern.lastIndex = 0;
    let output = "", cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const start = pattern.lastIndex;
      const end = valueEnd(text, start);
      if (end === start) continue;
      const prefix = options.assignmentSpace && pattern === ASSIGNMENT ? match[0].replace(/\s*$/, " ") : match[0];
      // Keep JSON string fields syntactically valid for structured text consumers.
      const replacement = pattern === ASSIGNMENT && /["']\s*:/.test(match[3] ?? "") && text[start] === '"'
        ? JSON.stringify(marker) : marker;
      output += text.slice(cursor, match.index) + prefix + replacement;
      cursor = end;
      pattern.lastIndex = end;
    }
    text = output + text.slice(cursor);
  }
  return text.replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gi, marker);
}

/** Copy JSON-like tool/evidence data without changing numeric evidence or outcome enums. */
export function redactUnityCredentialData<T>(value: T): T {
  if (typeof value === "string") return redactUnityCredentials(value) as T;
  if (Array.isArray(value)) return value.map(item => redactUnityCredentialData(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactUnityCredentials(key),
      new RegExp(`^(?:${KEY})$`, "i").test(key) ? "[redacted]" : redactUnityCredentialData(item)])) as T;
  }
  return value;
}
