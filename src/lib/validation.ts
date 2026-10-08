export const DISPLAY_NAME_MAX = 40;
export const GROUP_NAME_MAX = 60;
export const MESSAGE_MAX = 2000;
/** Including the creator. */
export const MAX_GROUP_SIZE = 10;

// Control characters are rejected by firestore.rules too.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Trims and collapses inner whitespace; names are single-line. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function validateDisplayName(name: string): string | null {
  if (!name) return 'Choose a display name.';
  if (name.length > DISPLAY_NAME_MAX) return `Keep it under ${DISPLAY_NAME_MAX} characters.`;
  if (CONTROL_CHARS.test(name)) return 'Use letters, numbers and normal punctuation.';
  return null;
}

export function validateGroupName(name: string): string | null {
  if (!name) return 'Give the chat a name.';
  if (name.length > GROUP_NAME_MAX) return `Keep it under ${GROUP_NAME_MAX} characters.`;
  if (CONTROL_CHARS.test(name)) return 'Use letters, numbers and normal punctuation.';
  return null;
}

/** Messages keep their line breaks; only leading/trailing whitespace goes. */
export function cleanMessage(raw: string): string {
  return raw.trim();
}

export function validateMessage(text: string): string | null {
  if (!text) return 'Write a message first.';
  if (text.length > MESSAGE_MAX) return `Messages can be up to ${MESSAGE_MAX} characters.`;
  return null;
}

/** Creator first, duplicates removed. Throws if the group would be invalid. */
export function buildMemberList(creatorUid: string, selected: readonly string[]): string[] {
  const members = [...new Set([creatorUid, ...selected])];
  if (members.length < 2) throw new Error('Pick at least one other person.');
  if (members.length > MAX_GROUP_SIZE) throw new Error(`Groups can have up to ${MAX_GROUP_SIZE} people, including you.`);
  return members;
}
