import { describe, expect, it } from 'vitest';
import { pastedImageFileName, pastedImagePath, styleImagePath } from './markdown-image-path';

describe('styleImagePath', () => {
  it('styleImagePath_whenRelative_writesThePathFromTheDocument', () => {
    expect(styleImagePath('/work/docs/assets/a.png', '/work/docs', 'relative')).toBe(
      'assets/a.png',
    );
    expect(styleImagePath('/work/images/a.png', '/work/docs', 'relative')).toBe('../images/a.png');
  });

  it('styleImagePath_whenAbsoluteOrNotLocal_leavesTheSourceAlone', () => {
    expect(styleImagePath('/work/a.png', '/work', 'absolute')).toBe('/work/a.png');
    expect(styleImagePath('https://x.test/a.png', '/work', 'relative')).toBe(
      'https://x.test/a.png',
    );
    expect(styleImagePath('/work/a.png', '', 'relative')).toBe('/work/a.png');
  });
});

describe('pastedImagePath', () => {
  it('pastedImagePath_whenSavedBeside_usesTheDocumentsFolder', () => {
    expect(pastedImagePath('/work', 'beside', 'assets', 'a.png')).toBe('/work/a.png');
  });

  it('pastedImagePath_whenSavedInAFolder_usesItsName', () => {
    expect(pastedImagePath('/work', 'folder', 'media', 'a.png')).toBe('/work/media/a.png');
  });

  it('pastedImagePath_whenTheFolderLeadsElsewhere_fallsBackToTheDefault', () => {
    expect(pastedImagePath('/work', 'folder', '../up', 'a.png')).toBe('/work/assets/a.png');
    expect(pastedImagePath('/work', 'folder', '  ', 'a.png')).toBe('/work/assets/a.png');
  });
});

describe('pastedImageFileName', () => {
  it('pastedImageFileName_followsTheImagesType', () => {
    const file: File = new File([], 'image', { type: 'image/jpeg' });

    expect(pastedImageFileName(file, 5)).toBe('pasted-image-5.jpg');
  });
});
