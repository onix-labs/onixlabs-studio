import { describe, expect, it } from 'vitest';
import { embedRightToLeft } from './embed-right-to-left';

/**
 * Holds the start of a right-to-left embedding and its right-to-left mark, written as code points so
 * the spec carries no invisible characters.
 */
const EMBED: string = String.fromCodePoint(0x202b, 0x200f);

/**
 * Holds the end of the embedding.
 */
const END: string = String.fromCodePoint(0x202c);

describe('embedRightToLeft', () => {
  it('embeds a message right to left, led by a right-to-left mark', () => {
    expect(embedRightToLeft({ a: 'ملف Markdown جديد' })).toEqual({
      a: `${EMBED}ملف Markdown جديد${END}`,
    });
  });

  it('keeps a message’s placeholders inside the embedding', () => {
    expect(embedRightToLeft({ a: 'بدأت في {$time}' })['a']).toBe(`${EMBED}بدأت في {$time}${END}`);
  });

  it('leaves a plural whole, as it has to be its whole message', () => {
    const plural: string = '{VAR_PLURAL, plural, one {تحديث واحد} other {{INTERPOLATION} تحديث}}';

    expect(embedRightToLeft({ a: plural })['a']).toBe(plural);
  });
});
