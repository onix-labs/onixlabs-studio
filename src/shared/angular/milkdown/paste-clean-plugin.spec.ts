import { describe, expect, it } from 'vitest';
import { stripMediumFontWeight } from './paste-clean-plugin';

describe('stripMediumFontWeight', () => {
  it('strips_aMediumWeight_soUiTextDoesNotPasteBold', () => {
    const html: string = '<span style="font-weight: 500;">plain ui text</span>';
    expect(stripMediumFontWeight(html)).toBe('<span style="">plain ui text</span>');
  });

  it('strips_everyWeightInTheMediumRange', () => {
    for (const weight of [500, 600, 699]) {
      const html: string = `<span style="font-weight: ${weight};">text</span>`;
      expect(stripMediumFontWeight(html)).not.toContain('font-weight');
    }
  });

  it('keeps_aGenuineBoldWeight', () => {
    const html: string = '<span style="font-weight: 700;">bold text</span>';
    expect(stripMediumFontWeight(html)).toContain('font-weight: 700');
  });

  it('keeps_theBoldKeyword', () => {
    const html: string = '<span style="font-weight: bold;">bold text</span>';
    expect(stripMediumFontWeight(html)).toContain('font-weight: bold');
  });

  it('keeps_strongAndBTags', () => {
    const html: string = '<strong>strong</strong> and <b>b</b>';
    expect(stripMediumFontWeight(html)).toBe('<strong>strong</strong> and <b>b</b>');
  });

  it('keeps_theElementsOtherInlineStyles', () => {
    const html: string = '<span style="color: red; font-weight: 600;">text</span>';
    const cleaned: string = stripMediumFontWeight(html);
    expect(cleaned).toContain('color: red');
    expect(cleaned).not.toContain('font-weight');
  });

  it('leaves_unstyledHtml_untouched', () => {
    const html: string = '<p>a <em>plain</em> paragraph</p>';
    expect(stripMediumFontWeight(html)).toBe(html);
  });
});
