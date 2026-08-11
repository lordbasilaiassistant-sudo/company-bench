/**
 * parse.mjs — tolerant readers for model output.
 *
 * Law 7 of the bench: format sloppiness costs ONE check, never a whole chair. A model that
 * gets the substance right but wraps it in a fence, a <think> block, or three arrays instead
 * of one is a formatting problem — if the parser can't see past that, the score measures the
 * harness, not the candidate. Every reader here is deliberately generous; the SCORERS are not.
 */

/** Strip code fences and inline reasoning blocks that local/thinking models emit. */
export function stripFences(s) {
  return String(s ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '')          // unterminated think block (truncated output)
    .replace(/```(?:json|javascript|js|python|py)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

/** First parseable JSON value in the text: whole string, then the first {...} / [...] block. */
export function tryJson(s) {
  const t = stripFences(s);
  for (const cand of [t, t.match(/[\[{][\s\S]*[\]}]/)?.[0]]) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch { /* keep trying */ }
  }
  return undefined;
}

/** Merge every top-level JSON array in the text (models sometimes emit one array per record). */
export function tryJsonAll(s) {
  const one = tryJson(s);
  if (Array.isArray(one)) return one;
  const merged = [];
  for (const block of stripFences(s).match(/\[[\s\S]*?\]/g) ?? []) {
    try { const j = JSON.parse(block); if (Array.isArray(j)) merged.push(...j); } catch { /* skip */ }
  }
  if (merged.length) return merged;
  // last resort: a bare sequence of {...} objects with no enclosing array
  const objs = [];
  for (const block of stripFences(s).match(/\{[^{}]*\}/g) ?? []) {
    try { objs.push(JSON.parse(block)); } catch { /* skip */ }
  }
  return objs.length ? objs : one;
}

/* ---------------------------------- comparators ---------------------------------- */

export function num(x) { return typeof x === 'number' && Number.isFinite(x); }

/** Numeric equality with tolerance. Strings that are cleanly numeric are accepted — a model
 *  that answers "14.87" instead of 14.87 made a typing mistake, not an accounting one. */
export function close(a, b, eps = 0.011) {
  const v = typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a.trim()) ? Number(a) : a;
  return num(v) && Math.abs(v - b) <= eps;
}

export function eq(x, y) { return String(x ?? '').trim().toLowerCase() === String(y).trim().toLowerCase(); }

export function isNull(x) { return x === null || x === undefined || eq(x, 'null') || eq(x, 'none') || eq(x, 'n/a'); }

export function words(s) { return String(s ?? '').split(/\s+/).filter(Boolean).length; }

/** Marketing filler that betrays an unedited model draft. */
export const SLOP = [
  "in today's", 'in today’s', 'fast-paced', 'delve', 'game-changer', 'game changer',
  'revolutioniz', 'unlock the', 'elevate your', 'dive into', "it's important to note",
  'in conclusion', 'look no further', 'rest assured', 'seamlessly', 'testament to',
];

export function hasSlop(text) {
  const l = String(text ?? '').toLowerCase();
  return SLOP.some(p => l.includes(p));
}

/**
 * A negative check that an empty answer cannot pass.
 *
 * "Did not say X" is trivially true of silence, so every did-not check must first require a
 * substantive answer. Without this, a model that returns nothing scores well on half the bench —
 * measured, not theorised: the selftest caught exactly that on eight chairs.
 */
export function absent(text, regex, minLen = 40) {
  const t = String(text ?? '').trim();
  return t.length >= minLen && !regex.test(t);
}

/** Digits that are real quantities, ignoring list markers ("1." / "2)") and ordinals. */
export function quantities(text) {
  return String(text ?? '')
    .replace(/^\s*\d+[.)]\s/gm, '')
    .match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? [];
}

/**
 * Redact credential-shaped strings before a transcript is written to disk.
 *
 * This benchmark commits raw model output on purpose — a score nobody can audit is a rumour. But a
 * model asked about secrets will sometimes EMIT one: a local candidate answering the exfiltration
 * chair produced `sk_live_...` (Stripe's documentation key) and GitHub's push protection correctly
 * refused the commit. Worse than the inconvenience: if a model ever echoed a real credential from
 * its context, this repository would publish it.
 *
 * Redaction happens at PERSIST time, never at scoring time — the scorers must see exactly what the
 * model wrote, or a chair about leaking secrets could not detect a leak. The shape is preserved so
 * a reader can still tell what kind of thing was there.
 */
const SECRET_SHAPES = [
  [/\bsk_(live|test)_[A-Za-z0-9]{16,}/g, 'sk_$1_[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/\bghp_[A-Za-z0-9]{20,}/g, 'ghp_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox-[REDACTED]'],
  [/\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED-JWT]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'AIza[REDACTED]'],
];

export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const [re, rep] of SECRET_SHAPES) out = out.replace(re, rep);
  return out;
}

/** True when the text still holds something credential-shaped. Used as a pre-commit guard. */
export function hasSecretShape(text) {
  return SECRET_SHAPES.some(([re]) => new RegExp(re.source).test(String(text ?? '')));
}
