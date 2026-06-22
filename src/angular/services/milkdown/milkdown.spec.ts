import { TestBed } from '@angular/core/testing';

import { Settings } from '../settings/settings';
import { Milkdown } from './milkdown';

describe('Milkdown', () => {
  let milkdown: Milkdown;
  let settings: Settings;

  beforeEach(() => {
    settings = TestBed.inject(Settings);
    milkdown = TestBed.inject(Milkdown);
  });

  it('getCssCustomProperties_whenFontSizeSet_emitsPixelFontSize', () => {
    settings.updateMarkdownEditorSettings({ fontSize: 18 });
    expect(milkdown.getCssCustomProperties()['--markdown-font-size']).toBe('18px');
  });

  it('getCssCustomProperties_whenSystemDefaultFont_resolvesToSystemStack', () => {
    settings.updateMarkdownEditorSettings({ fontFamily: 'System Default' });
    expect(milkdown.getCssCustomProperties()['--markdown-font-family']).toContain('-apple-system');
  });

  it('getCssCustomProperties_whenNamedFont_quotesAndAppendsFallback', () => {
    settings.updateMarkdownEditorSettings({ fontFamily: 'Inter' });
    expect(milkdown.getCssCustomProperties()['--markdown-font-family']).toContain('"Inter"');
  });

  it('getCssCustomProperties_whenMonospaceFontSet_appendsMonospaceFallback', () => {
    settings.updateMarkdownEditorSettings({ monospaceFontFamily: 'Fira Code' });
    const stack: string = milkdown.getCssCustomProperties()['--markdown-monospace-font'];
    expect(stack).toContain('"Fira Code"');
    expect(stack).toContain('monospace');
  });

  it('marginSize_whenSettingChanges_reflectsSetting', () => {
    settings.updateMarkdownEditorSettings({ marginSize: 'wide' });
    expect(milkdown.marginSize()).toBe('wide');
  });

  it('imageSizing_whenSettingChanges_reflectsSetting', () => {
    settings.updateMarkdownEditorSettings({ imageSizing: 'sizable' });
    expect(milkdown.imageSizing()).toBe('sizable');
  });

  it('imageAlignment_whenSettingChanges_reflectsSetting', () => {
    settings.updateMarkdownEditorSettings({ imageAlignment: 'center' });
    expect(milkdown.imageAlignment()).toBe('center');
  });

  it('imageAlignment_byDefault_isLeft', () => {
    expect(milkdown.imageAlignment()).toBe('left');
  });
});
