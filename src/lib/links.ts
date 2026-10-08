export type Segment = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

const URL_RE = /https:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,!?;:'"]+$/;

function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING, '');
  // Drop unbalanced closing brackets, e.g. "(see https://x.com/a)".
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
      url = url.slice(0, -1).replace(TRAILING, '');
    }
  }
  return url;
}

/** Splits plain text into text and HTTPS-link segments. Rendered as React text, never HTML. */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    const candidate = trimUrl(match[0]);
    let href: string | null = null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' && parsed.hostname.includes('.')) href = parsed.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    if (index > cursor) out.push({ type: 'text', text: text.slice(cursor, index) });
    out.push({ type: 'link', text: candidate, href });
    cursor = index + candidate.length;
  }
  if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
  return out;
}
