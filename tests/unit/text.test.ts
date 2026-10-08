import { describe, expect, it } from 'vitest';
import { initials } from '../../src/lib/avatar';
import { linkify } from '../../src/lib/links';
import { buildMemberList, cleanName, validateDisplayName, validateMessage } from '../../src/lib/validation';

describe('linkify', () => {
  it('links HTTPS URLs and leaves the rest as text', () => {
    expect(linkify('Join https://chat.whatsapp.com/AbC123xyz please')).toEqual([
      { type: 'text', text: 'Join ' },
      { type: 'link', text: 'https://chat.whatsapp.com/AbC123xyz', href: 'https://chat.whatsapp.com/AbC123xyz' },
      { type: 'text', text: ' please' },
    ]);
  });

  it('does not link http, javascript or other schemes', () => {
    for (const text of ['http://example.com', 'javascript:alert(1)', 'ftp://example.com/file', 'data:text/html,hi']) {
      expect(linkify(text)).toEqual([{ type: 'text', text }]);
    }
  });

  it('trims trailing punctuation and unbalanced brackets', () => {
    const segments = linkify('See (https://example.com/a_(b)). Done!');
    expect(segments.find((s) => s.type === 'link')).toMatchObject({ text: 'https://example.com/a_(b)' });
    expect(linkify('Go to https://example.com.')[1]).toMatchObject({ type: 'link', text: 'https://example.com' });
  });

  it('keeps markup as plain text', () => {
    expect(linkify('<img src=x onerror=alert(1)>')).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('validation', () => {
  it('cleans and validates display names', () => {
    expect(cleanName('  Ana   María  ')).toBe('Ana María');
    expect(validateDisplayName('')).not.toBeNull();
    expect(validateDisplayName('x'.repeat(41))).not.toBeNull();
    expect(validateDisplayName('Sam')).toBeNull();
  });

  it('validates message length', () => {
    expect(validateMessage('')).not.toBeNull();
    expect(validateMessage('x'.repeat(2001))).not.toBeNull();
    expect(validateMessage('hello')).toBeNull();
  });

  it('builds a unique member list that includes the creator', () => {
    expect(buildMemberList('me', ['a', 'b', 'a', 'me'])).toEqual(['me', 'a', 'b']);
    expect(() => buildMemberList('me', [])).toThrow();
    expect(() => buildMemberList('me', ['me'])).toThrow();
    expect(() => buildMemberList('me', Array.from({ length: 10 }, (_, i) => `u${i}`))).toThrow(/up to 10/);
    expect(buildMemberList('me', Array.from({ length: 9 }, (_, i) => `u${i}`))).toHaveLength(10);
  });
});

describe('initials', () => {
  it('uses first and last words', () => {
    expect(initials('ada lovelace')).toBe('AL');
    expect(initials('Cher')).toBe('C');
    expect(initials('Ana María de la Cruz')).toBe('AC');
    expect(initials('   ')).toBe('?');
  });
});
