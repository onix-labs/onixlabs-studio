// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IconTheme } from '@shared/api/icon-theme';
import { loadIconTheme } from './load-icon-theme';

const SVG: string = '<svg xmlns="http://www.w3.org/2000/svg"/>';

describe('loadIconTheme', () => {
  let sandbox: string;
  let extension: string;

  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'icon-theme-')));
    extension = path.join(sandbox, 'extension');
    fs.mkdirSync(path.join(extension, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'secret.svg'), SVG);
    fs.writeFileSync(path.join(extension, 'icons', 'ts.svg'), SVG);
    contribute('icons/theme.json');
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  /**
   * Writes the extension's manifest.
   * @param document The theme document's path.
   */
  function contribute(document: string): void {
    fs.writeFileSync(
      path.join(extension, 'package.json'),
      JSON.stringify({ contributes: { iconThemes: [{ id: 't', label: 'Test', path: document }] } }),
    );
  }

  /**
   * Writes the theme document and loads it.
   * @param document The document.
   * @returns Returns the theme.
   */
  function load(document: unknown): Promise<IconTheme | null> {
    fs.writeFileSync(path.join(extension, 'icons', 'theme.json'), JSON.stringify(document));
    return loadIconTheme(extension);
  }

  it('readsThePictures_andLaysTheLightSetOverTheDark', async () => {
    const theme: IconTheme | null = await load({
      iconDefinitions: { ts: { iconPath: './ts.svg' }, light: { iconPath: './ts.svg' } },
      file: 'ts',
      fileExtensions: { TS: 'ts', js: 'ts' },
      light: { fileExtensions: { ts: 'light' } },
    });

    expect(theme?.label).toBe('Test');
    expect(theme?.pictures['ts']).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(theme?.dark.fileExtensions).toEqual({ ts: 'ts', js: 'ts' });
    expect(theme?.light.fileExtensions).toEqual({ ts: 'light', js: 'ts' });
    expect(theme?.light.file).toBe('ts');
  });

  it('dropsAnAssociationWithAPictureThatIsNotDefined', async () => {
    const theme: IconTheme | null = await load({
      iconDefinitions: { ts: { iconPath: './ts.svg' }, glyph: { fontCharacter: 'x' } },
      fileExtensions: { a: 'FOR_TEST_ONLY', b: 'glyph', ts: 'ts' },
    });

    expect(theme?.dark.fileExtensions).toEqual({ ts: 'ts' });
  });

  it('leavesOutAPictureOutsideTheExtension_byPathOrByLink', async () => {
    fs.symlinkSync(path.join(sandbox, 'secret.svg'), path.join(extension, 'icons', 'link.svg'));

    const theme: IconTheme | null = await load({
      iconDefinitions: {
        up: { iconPath: '../../secret.svg' },
        absolute: { iconPath: path.join(sandbox, 'secret.svg') },
        link: { iconPath: './link.svg' },
        missing: { iconPath: './missing.svg' },
        script: { iconPath: './theme.json' },
        ts: { iconPath: './ts.svg' },
      },
    });

    expect(Object.keys(theme?.pictures ?? {})).toEqual(['ts']);
  });

  it('leavesOutAPictureThatIsTooLarge', async () => {
    fs.writeFileSync(path.join(extension, 'icons', 'big.svg'), 'x'.repeat(256 * 1024 + 1));

    const theme: IconTheme | null = await load({
      iconDefinitions: { big: { iconPath: './big.svg' } },
    });

    expect(theme?.pictures).toEqual({});
  });

  it('refusesADocumentOutsideTheExtension', async () => {
    fs.writeFileSync(path.join(sandbox, 'theme.json'), JSON.stringify({ iconDefinitions: {} }));
    contribute('../theme.json');

    expect(await loadIconTheme(extension)).toBeNull();
  });

  it.each([[null], [42], [[]], [{}], [{ iconDefinitions: [] }]])(
    'refusesADocumentThatIsNotATheme %#',
    async (document: unknown) => {
      expect(await load(document)).toBeNull();
    },
  );

  it('answersNull_whenTheExtensionIsMissing_orContributesNoTheme', async () => {
    expect(await loadIconTheme(path.join(sandbox, 'nowhere'))).toBeNull();
    fs.writeFileSync(path.join(extension, 'package.json'), '{}');
    expect(await loadIconTheme(extension)).toBeNull();
  });
});
