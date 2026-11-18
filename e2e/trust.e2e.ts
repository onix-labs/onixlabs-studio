import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { answerTrustPrompt, explorerRow, openFolderFromWelcome, trustPrompt } from './helpers';
import { FAKE_LANGUAGE_SERVER_ID, seedFakeLanguageServer } from './seeded-installs';

/**
 * Reads the profile the application is running on, and fails the test unless it is a throwaway one.
 * @param app The launched application.
 * @returns Returns the userData directory.
 */
async function throwawayProfile(app: ElectronApplication): Promise<string> {
  const userData: string = await app.evaluate(({ app: electronApp }): string =>
    electronApp.getPath('userData'),
  );
  const temporary: string = fs.realpathSync(os.tmpdir());
  expect(fs.realpathSync(userData).startsWith(`${temporary}${path.sep}`)).toBe(true);
  return userData;
}

/**
 * Finds the processes running from a directory.
 * @param directory The directory, which only that plugin's process names on its command line.
 * @returns Returns their process ids.
 */
function processesUnder(directory: string): readonly number[] {
  return execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line: string): boolean => line.includes(directory))
    .map((line: string): number => Number.parseInt(line.trim(), 10));
}

/**
 * Writes a hostile folder (#1504): a project whose opening would run code it ships, were anything to
 * run before the user trusts it. Each trap leaves a file in the canary folder, outside the project, if
 * it ever runs.
 *
 * - A committed CMake build tree whose cache names a "CMake" that is the attacker's script: a C/C++
 *   project's reader used to configure the tree to read its targets.
 * - A Python file, which the seeded fake language server serves: a server reads the folder's
 *   configuration and, for many languages, runs its code.
 * @param folder The project folder.
 * @param canary The folder the traps write to.
 */
function writeHostileFolder(folder: string, canary: string): void {
  const trap: string = path.join(folder, 'tools', 'cmake');
  fs.mkdirSync(path.dirname(trap), { recursive: true });
  fs.writeFileSync(trap, `#!/bin/sh\ntouch "${path.join(canary, 'cmake-ran')}"\n`);
  fs.chmodSync(trap, 0o755);
  fs.writeFileSync(path.join(folder, 'CMakeLists.txt'), 'project(hostile)\n');
  fs.mkdirSync(path.join(folder, 'build'));
  fs.writeFileSync(
    path.join(folder, 'build', 'CMakeCache.txt'),
    `CMAKE_COMMAND:INTERNAL=${trap}\nCMAKE_EXPORT_COMPILE_COMMANDS:BOOL=\n`,
  );
  fs.writeFileSync(path.join(folder, 'main.py'), 'print("hello")\n');
}

test.describe('a hostile folder (#1504)', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedFakeLanguageServer(dir) } });

  test('runsNothing_untilTrusted_thenStartsItsServer', async ({ app, page, scratch }) => {
    const folder: string = path.join(scratch, 'hostile');
    const canary: string = path.join(scratch, 'canary');
    fs.mkdirSync(folder);
    fs.mkdirSync(canary);
    writeHostileFolder(folder, canary);
    const installs: string = path.join(
      await throwawayProfile(app),
      'lsp-servers',
      FAKE_LANGUAGE_SERVER_ID,
    );

    // Declined: browsable as files, and nothing runs.
    await openFolderFromWelcome(app, page, folder, "Don't Trust");
    const chip: Locator = page.locator('.status-strip-segment', { hasText: 'Not Trusted' });
    await expect(chip).toBeVisible();
    // A CMake project opens in the Solution Explorer, which lists its C/C++ sources only.
    await page.getByRole('tab', { name: 'File Explorer' }).click();
    await explorerRow(page, path.join(folder, 'main.py')).dblclick();
    // Long enough for anything that was going to start to have started.
    await page.waitForTimeout(3_000);
    expect(fs.readdirSync(canary)).toEqual([]);
    expect(processesUnder(installs)).toEqual([]);

    // Trusted from the status strip: the held server starts.
    await chip.click();
    await answerTrustPrompt(app, 'Trust');
    await expect(chip).toBeHidden();
    await expect.poll((): number => processesUnder(installs).length).toBeGreaterThan(0);
  });

  test('asksInAWindowOfItsOwn_withTheSafeChoiceFocused', async ({ app, page, scratch }) => {
    const folder: string = path.join(scratch, 'plain');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'hello\n');

    await openFolderFromWelcome(app, page, folder, null);
    const prompt: Page = await trustPrompt(app);

    await expect(prompt.locator('#folder')).toContainText('plain');
    await expect(prompt.getByRole('button', { name: "Don't Trust", exact: true })).toBeFocused();
    await expect(prompt.getByRole('button', { name: 'Scan with AI', exact: true })).toBeVisible();
    // Escape is Don't Trust: the folder is recorded as declined, and the status strip says so.
    // The prompt closes on the key itself, so the press may report its window gone.
    await prompt.keyboard.press('Escape').catch((): void => undefined);
    await expect(page.locator('.status-strip-segment', { hasText: 'Not Trusted' })).toBeVisible();
  });
});
