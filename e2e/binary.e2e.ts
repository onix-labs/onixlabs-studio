import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { ribbonButton } from './helpers';

/**
 * Builds a minimal but well-formed x86-64 ELF executable: a 64-byte ELF header, one PT_LOAD program
 * header covering the whole file, and six bytes of code at offset 0x78 — `push rbp`, `mov rbp, rsp`,
 * `nop`, `ret`. The entry point targets the code, so the editor's open-at-code jump and the
 * disassembler have real instructions at a known offset.
 * @returns Returns the fixture's bytes.
 */
function buildElfFixture(): Buffer {
  const CODE: number[] = [0x55, 0x48, 0x89, 0xe5, 0x90, 0xc3];
  const CODE_OFFSET: number = 0x78;
  const VADDR_BASE: bigint = 0x400000n;
  const size: number = CODE_OFFSET + CODE.length;
  const file: Buffer = Buffer.alloc(size);

  // ELF header.
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0); // magic, 64-bit, little-endian, SysV.
  file.writeUInt16LE(2, 0x10); // e_type: EXEC.
  file.writeUInt16LE(0x3e, 0x12); // e_machine: x86-64.
  file.writeUInt32LE(1, 0x14); // e_version.
  file.writeBigUInt64LE(VADDR_BASE + BigInt(CODE_OFFSET), 0x18); // e_entry.
  file.writeBigUInt64LE(0x40n, 0x20); // e_phoff.
  file.writeUInt16LE(0x40, 0x34); // e_ehsize.
  file.writeUInt16LE(0x38, 0x36); // e_phentsize.
  file.writeUInt16LE(1, 0x38); // e_phnum.

  // PT_LOAD program header covering the whole file.
  file.writeUInt32LE(1, 0x40); // p_type: PT_LOAD.
  file.writeUInt32LE(5, 0x44); // p_flags: R+X.
  file.writeBigUInt64LE(0n, 0x48); // p_offset.
  file.writeBigUInt64LE(VADDR_BASE, 0x50); // p_vaddr.
  file.writeBigUInt64LE(VADDR_BASE, 0x58); // p_paddr.
  file.writeBigUInt64LE(BigInt(size), 0x60); // p_filesz.
  file.writeBigUInt64LE(BigInt(size), 0x68); // p_memsz.
  file.writeBigUInt64LE(0x1000n, 0x70); // p_align.

  file.set(CODE, CODE_OFFSET);
  return file;
}

/**
 * Holds the fixture's on-disk location, created once per worker; the app fixture seeds it as a
 * trusted path so the main process honours re-opening it.
 */
const FIXTURE_DIR: string = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-binary-fixture-'));

/**
 * Holds the absolute path of the ELF fixture.
 */
const FIXTURE_PATH: string = path.join(FIXTURE_DIR, 'sample-x64.elf');

fs.writeFileSync(FIXTURE_PATH, buildElfFixture());

// The main process only re-opens previously-trusted paths; seed the fixture as trusted before
// launch, exactly as a real prior "open" would have recorded it.
test.use({ trustedPaths: [FIXTURE_PATH] });

/**
 * The full binary pipeline: a recent binary file re-opens from the welcome screen into the binary
 * editor, the format is sniffed, and the disassembly column decodes real instructions at the
 * expected offset — exercising windowed IPC reads, Capstone in the main process, and the rendered
 * grid end to end.
 */
test.describe('binary editor', () => {
  test('recentElf_opensDisassembledInTheBinaryEditor', async ({ page }) => {
    // Seed the welcome screen's recent list, then reload so it is read at construction.
    await page.evaluate((fixturePath: string): void => {
      window.localStorage.setItem(
        'welcome.recentItems',
        JSON.stringify([
          { path: fixturePath, name: 'sample-x64.elf', kind: 'binary', openedAt: 1, pinned: false },
        ]),
      );
    }, FIXTURE_PATH);
    await page.reload();

    await page.locator('.welcome__recent-name', { hasText: 'sample-x64.elf' }).click();
    const view: Locator = page.locator('app-binary-view');
    await expect(view).toBeVisible();

    // The sniffer identified the container and architecture.
    await expect(page.locator('app-status-strip-container')).toContainText('ELF');

    // The hex grid shows the code bytes at the expected offset.
    await expect(view).toContainText('554889E590C3');

    // Toggling the Assembly panel decodes the entry code through the main-process disassembler:
    // push rbp; mov rbp, rsp; nop; ret.
    const toggle: Locator = await ribbonButton(page, 'Assembly');
    await toggle.click();
    await page.keyboard.press('Escape');
    const disasm: Locator = page.locator('app-binary-disasm-panel');
    await expect(disasm).toBeVisible();
    await expect(disasm).toContainText('push');
    await expect(disasm).toContainText('rbp');
    await expect(disasm).toContainText('ret');
  });
});
