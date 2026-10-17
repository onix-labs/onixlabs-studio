import { describe, expect, it } from 'vitest';

import { inRealm } from './monaco-realm';

/**
 * Opens an iframe, whose window has a `RegExp` constructor of its own, so a cross-realm check can be
 * made the way Monaco makes it.
 * @returns Returns the iframe's window.
 */
function otherRealm(): Window {
  const frame: HTMLIFrameElement = document.createElement('iframe');
  document.body.appendChild(frame);
  const realm: Window | null = frame.contentWindow;
  if (realm === null) {
    throw new Error('The iframe has no window.');
  }
  return realm;
}

describe('inRealm', () => {
  it('rebuildsEveryRegularExpressionInTheTargetWindowsRealm', () => {
    const realm: Window = otherRealm();
    const RealmRegExp: typeof RegExp = (realm as unknown as { RegExp: typeof RegExp }).RegExp;
    const grammar: { tokenizer: { root: (RegExp | [RegExp, string])[] }; keywords: string[] } = {
      tokenizer: { root: [/\bmov\b/i, [/[0-9]+/, 'number']] },
      keywords: ['mov', 'add'],
    };

    const rebuilt: typeof grammar = inRealm(grammar, realm);

    // The original is untouched, and still the main window's.
    expect(grammar.tokenizer.root[0]).toBeInstanceOf(RegExp);
    expect(rebuilt.tokenizer.root[0]).not.toBe(grammar.tokenizer.root[0]);
    expect(rebuilt.tokenizer.root[0]).toBeInstanceOf(RealmRegExp);
    expect((rebuilt.tokenizer.root[0] as RegExp).source).toBe('\\bmov\\b');
    expect((rebuilt.tokenizer.root[0] as RegExp).flags).toBe('i');
    expect((rebuilt.tokenizer.root[1] as [RegExp, string])[0]).toBeInstanceOf(RealmRegExp);
    expect((rebuilt.tokenizer.root[1] as [RegExp, string])[1]).toBe('number');
    expect(rebuilt.keywords).toEqual(['mov', 'add']);
  });
});
