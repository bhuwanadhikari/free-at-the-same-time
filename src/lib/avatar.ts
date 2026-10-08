/** Up to two initials, from the first and last words. Works with non-Latin scripts. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

const COLORS = [
  '#5B2EFF',
  '#FF5C39',
  '#0EA5A4',
  '#E0328E',
  '#2563EB',
  '#F59E0B',
  '#059669',
  '#7C3AED',
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable solid color per user id, so avatars stay the same across renames. */
export function avatarColor(seed: string): string {
  return COLORS[hash(seed) % COLORS.length];
}
