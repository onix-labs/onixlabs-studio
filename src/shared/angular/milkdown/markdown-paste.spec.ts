import { describe, expect, it } from 'vitest';
import { keepBasicFormatting } from './markdown-paste';

describe('keepBasicFormatting', () => {
  it('keepBasicFormatting_keepsEmphasisAndLinksAndDropsTheRest', () => {
    const html: string =
      '<div style="color:red"><span class="x"><strong>Bold</strong></span> ' +
      '<a href="https://x.test" class="y">link</a></div>';

    expect(keepBasicFormatting(html)).toBe(
      '<strong>Bold</strong> <a href="https://x.test">link</a>',
    );
  });
});
