import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { isModalWindow, modalWindow, ribbonButton } from './helpers';

/**
 * Holds the repository root, so a fixture can be taken from a built plugin's payload.
 */
const REPO_ROOT: string = path.resolve(__dirname, '..');

/**
 * Holds the .NET decoder's own apphost. Its presence is the test for whether the plugin has been built
 * for this platform: the payload is framework-dependent and per-RID, so a checkout that has not run
 * `node plugins/dotnet-decoder/build.mjs` (and a machine with no `dotnet`) has nothing to run.
 */
const DOTNET_DECODER: string = path.join(
  REPO_ROOT,
  'plugins/dotnet-decoder/dist/dotnet-decoder',
  process.platform === 'win32' ? 'dotnet-decoder.exe' : 'dotnet-decoder',
);

/**
 * Holds the directory the fixtures are written into, created once per worker.
 */
const FIXTURE_DIR: string = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-decoder-fixture-'));

/**
 * Builds a minimal but well-formed Java class file declaring two methods:
 * `public static int arithmetic(int, int)`, whose body is `a * b + 7` — the shape the #575 spike
 * validated against `javap` — and `public static int identity(int)`.
 *
 * Two rather than one deliberately: a listing of a single section renders no heading (that is what
 * native disassembly produces, and the panel header already names it), so one method would exercise
 * neither the sectioning the panel was reworked for nor the per-method notes.
 *
 * Synthesised rather than compiled, exactly as the ELF fixture is: it keeps the suite free of a JDK
 * (this machine has none, and a CI image's Java is not something to depend on), and the bytes are
 * fixed, so the expected mnemonics can be asserted literally.
 * @returns Returns the fixture's bytes.
 */
function buildClassFixture(): Buffer {
  const u2: (value: number) => number[] = (value: number): number[] => [
    (value >> 8) & 0xff,
    value & 0xff,
  ];
  const u4: (value: number) => number[] = (value: number): number[] => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  const utf8: (text: string) => number[] = (text: string): number[] => {
    const bytes: number[] = [...Buffer.from(text, 'utf8')];
    return [1, ...u2(bytes.length), ...bytes];
  };
  // Constant pool, one-based: the class and its superclass, the "Code" attribute name, then each
  // method's name and descriptor.
  const pool: number[][] = [
    utf8('Fixture'), // 1
    [7, ...u2(1)], // 2 — Class -> #1
    utf8('java/lang/Object'), // 3
    [7, ...u2(3)], // 4 — Class -> #3
    utf8('Code'), // 5
    utf8('arithmetic'), // 6
    utf8('(II)I'), // 7
    utf8('identity'), // 8
    utf8('(I)I'), // 9
  ];
  /**
   * Assembles one `public static` method with a Code attribute.
   * @param nameIndex The constant-pool index of the method's name.
   * @param descriptorIndex The constant-pool index of the method's descriptor.
   * @param locals How many local slots the body uses.
   * @param code The method's bytecode.
   * @returns Returns the method_info bytes.
   */
  const method: (
    nameIndex: number,
    descriptorIndex: number,
    locals: number,
    code: readonly number[],
  ) => number[] = (
    nameIndex: number,
    descriptorIndex: number,
    locals: number,
    code: readonly number[],
  ): number[] => [
    ...u2(0x0009), // ACC_PUBLIC | ACC_STATIC
    ...u2(nameIndex),
    ...u2(descriptorIndex),
    ...u2(1),
    ...u2(5), // attribute_name_index -> "Code"
    ...u4(2 + 2 + 4 + code.length + 2 + 2),
    ...u2(2), // max_stack
    ...u2(locals),
    ...u4(code.length),
    ...code,
    ...u2(0), // exception_table_length
    ...u2(0), // attributes_count
  ];
  const methods: number[][] = [
    // iload_0; iload_1; imul; bipush 7; iadd; ireturn
    method(6, 7, 2, [0x1a, 0x1b, 0x68, 0x10, 0x07, 0x60, 0xac]),
    // iload_0; ireturn
    method(8, 9, 1, [0x1a, 0xac]),
  ];
  return Buffer.from([
    0xca,
    0xfe,
    0xba,
    0xbe,
    ...u2(0), // minor version
    ...u2(52), // major version — Java 8
    ...u2(pool.length + 1),
    ...pool.flat(),
    ...u2(0x0021), // ACC_PUBLIC | ACC_SUPER
    ...u2(2), // this_class
    ...u2(4), // super_class
    ...u2(0), // interfaces
    ...u2(0), // fields
    ...u2(methods.length),
    ...methods.flat(),
    ...u2(0), // attributes
  ]);
}

/**
 * Reads a decoded listing from the disassembly panel's Monaco model — the whole listing, not just the
 * lines the virtualised viewport rendered into the DOM.
 *
 * The model is chosen by matching its text, because a listing carries no marker of which decoder
 * produced it and more than one model can be open. The address shape cannot serve as that match the
 * way it does for native code: a JVM listing renders decimal, method-relative addresses, so the
 * caller passes something specific to the format it expects.
 * @param page The page driving the app.
 * @param pattern A pattern only the expected listing's text matches.
 * @returns Returns the listing text, or an empty string before it has decoded.
 */
function readListing(page: Page, pattern: RegExp): Promise<string> {
  return page.evaluate((source: string): string => {
    const monaco: { editor: { getModels(): { getValue(): string }[] } } | undefined = (
      window as unknown as { monaco?: { editor: { getModels(): { getValue(): string }[] } } }
    ).monaco;
    if (monaco === undefined) {
      return '';
    }
    const expression: RegExp = new RegExp(source);
    for (const model of monaco.editor.getModels()) {
      const value: string = model.getValue();
      if (expression.test(value)) {
        return value;
      }
    }
    return '';
  }, pattern.source);
}

/**
 * Opens a binary fixture through the welcome screen's recent list and reveals the Assembly panel.
 * @param app The Electron application.
 * @param page The main window.
 * @param fixturePath The fixture to open.
 * @param name The fixture's file name, as the recent row shows it.
 */
async function openBinary(
  app: { windows(): readonly Page[] },
  page: Page,
  fixturePath: string,
  name: string,
): Promise<void> {
  await page.evaluate(
    ([target, label]: readonly string[]): void => {
      window.localStorage.setItem(
        'welcome.recentItems',
        JSON.stringify([{ path: target, name: label, kind: 'binary', openedAt: 1, pinned: false }]),
      );
    },
    [fixturePath, name],
  );
  // The reload closes the welcome window with the renderer that opened it; the fresh renderer opens a
  // new one, which is where the recent item is clicked.
  const stale: readonly Page[] = app.windows().filter(isModalWindow);
  await page.reload();
  const welcome: Page = await modalWindow(app as never, stale);
  await welcome.locator('.welcome__recent-name', { hasText: name }).click();
  await expect(page.locator('app-binary-view')).toBeVisible();

  const toggle: Locator = await ribbonButton(page, 'Assembly');
  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('app-binary-disasm-panel')).toBeVisible();
}

/**
 * JVM bytecode end to end: a class file opens in the binary editor, is sniffed as a JVM class, and the
 * pure-TypeScript decoder plugin decodes its one method into named instructions.
 */
test.describe('JVM bytecode decoding', () => {
  const fixture: string = path.join(FIXTURE_DIR, 'Fixture.class');
  fs.writeFileSync(fixture, buildClassFixture());
  test.use({ trustedPaths: [fixture], sideloadPlugins: ['jvm-decoder'] });

  test('classFile_decodesItsMethodBodyThroughTheJvmPlugin', async ({ app, page }) => {
    await openBinary(app, page, fixture, 'Fixture.class');

    await expect(page.locator('app-status-strip-container')).toContainText('JVM class');

    // The section heading names the method as `javap` would, and the rows are its bytecode. The
    // decoder reports method-relative decimal addresses, so this deliberately asserts mnemonics and
    // the heading rather than the address column's shape.
    // Generous, because the first decode of a session pays for the decoder process starting and
    // completing its handshake before it reads anything — this asserts the listing arrives, not how
    // fast (that is the perf probe's job, not a CI runner's).
    const listing: RegExp = /public static int arithmetic\(int, int\)/;
    await expect
      .poll((): Promise<string> => readListing(page, listing), { timeout: 20_000 })
      .toMatch(listing);
    const text: string = await readListing(page, listing);
    expect(text).toMatch(
      /iload_0[\s\S]*iload_1[\s\S]*imul[\s\S]*bipush\s+7[\s\S]*iadd[\s\S]*ireturn/,
    );
    expect(text).toContain('max_stack=2, max_locals=2, code_length=7');
    // The second method proves the listing is sectioned rather than one flat run of instructions.
    expect(text).toContain('public static int identity(int)');
  });
});

/**
 * Managed IL end to end: a .NET assembly opens in the binary editor, is sniffed as managed, and the
 * out-of-process ICSharpCode.Decompiler plugin decodes method bodies into IL.
 *
 * The fixture is the decoder plugin's own assembly — a real managed PE that is present exactly when
 * the plugin it exercises has been built, so the test needs no committed binary and no SDK of its own.
 */
test.describe('managed IL decoding', () => {
  // Unlike the pure-TypeScript decoders, this one is a per-RID framework-dependent executable: it must
  // have been built for this platform and needs a `dotnet` runtime to spawn. Where there is none the
  // test would be measuring the toolchain rather than Studio, so it declares itself skipped instead.
  test.skip(
    !fs.existsSync(DOTNET_DECODER),
    'The .NET decoder is not built for this platform; run node plugins/dotnet-decoder/build.mjs',
  );

  const fixture: string = path.join(FIXTURE_DIR, 'sample-managed.dll');
  test.use({ trustedPaths: [fixture], sideloadPlugins: ['dotnet-decoder'] });

  test('managedAssembly_decodesIlThroughTheDotnetPlugin', async ({ app, page }) => {
    fs.copyFileSync(
      path.join(REPO_ROOT, 'plugins/dotnet-decoder/dist/dotnet-decoder/dotnet-decoder.dll'),
      fixture,
    );
    await openBinary(app, page, fixture, 'sample-managed.dll');

    await expect(page.locator('app-status-strip-container')).toContainText('.NET');

    // Every method the decoder emits carries its metadata token in the section notes and returns; the
    // assembly's own contents are not the subject, so the assertion is on the shape of IL rather than
    // on any particular method surviving a rebuild of the plugin.
    const listing: RegExp = /token=0x06/;
    await expect.poll((): Promise<string> => readListing(page, listing)).toMatch(listing);
    const text: string = await readListing(page, listing);
    expect(text).toMatch(/\bret\b/);
  });
});
