import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { answerTrustPrompt, explorerRow, openFolderFromWelcome, trustPrompt } from './helpers';
import type { CloneOutcome } from '../src/shared/api/clone-channels';
import {
  FAKE_LANGUAGE_SERVER_ID,
  GIT_ID,
  invoke,
  seedFakeLanguageServer,
  seedGitInstall,
} from './seeded-installs';

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

  test('asksAboutTheFolder_andOffersAScan', async ({ app, page, scratch }) => {
    const folder: string = path.join(scratch, 'plain');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'hello\n');

    await openFolderFromWelcome(app, page, folder, null);
    const prompt: Page = await trustPrompt(app);

    await expect(prompt.locator('.trust__path')).toContainText('plain');
    await expect(prompt.getByRole('button', { name: 'Scan with AI', exact: true })).toBeVisible();
    // Don't Trust is recorded, and the status strip says so.
    await prompt.getByRole('button', { name: "Don't Trust", exact: true }).click();
    await expect(page.locator('.status-strip-segment', { hasText: 'Not Trusted' })).toBeVisible();
  });
});

/**
 * Describes where the trust question sits against the window it belongs to.
 */
interface Placement {
  /**
   * Gets the question's bounds, to tell when it has stopped moving.
   */
  readonly bounds: string;

  /**
   * Gets whether the window it belongs to is on screen.
   */
  readonly parentVisible: boolean;

  /**
   * Gets how far its centre is from that window's, across.
   */
  readonly offsetX: number;

  /**
   * Gets how far its top is from where centring over that window puts it.
   */
  readonly offsetY: number;
}

test.describe('a clone through Studio (#1504)', () => {
  test.use({
    seedUserData: {
      write: (userDataDir: string): void => {
        seedGitInstall(userDataDir, [
          {
            slot: 'version-control',
            id: GIT_ID,
            displayName: 'Git',
            priority: 100,
            capabilities: ['clone'],
          },
        ]);
        const clones: string = path.join(userDataDir, 'clones');
        fs.mkdirSync(clones);
        fs.writeFileSync(path.join(userDataDir, 'clone.json'), JSON.stringify({ parent: clones }));
      },
    },
  });

  test('asksBeforeAnythingIsDownloaded_andClosingTheQuestionClonesNothing', async ({
    app,
    page,
  }) => {
    const destination: string = path.join(await throwawayProfile(app), 'clones', 'hostile');

    // The address is one nothing could ever be downloaded from: were the clone to start before the
    // question is answered, it would fail rather than reach anyone.
    const cloned: Promise<CloneOutcome> = invoke<CloneOutcome>(page, 'clone:clone', {
      url: 'https://someone:secret@example.invalid/a/hostile.git',
      name: 'hostile',
      layout: 'flat',
    });
    const prompt: Page = await trustPrompt(app);

    await expect(prompt.locator('.trust__title')).toHaveText('Do you trust this repository?');
    await expect(prompt.getByTestId('trust-source')).toHaveText(
      'https://example.invalid/a/hostile.git',
    );
    await expect(prompt.getByRole('button', { name: 'Decide Later', exact: true })).toBeVisible();
    expect(fs.existsSync(destination)).toBe(false);
    // Raised from the hidden main window while the welcome screen stands in for it, the question sits
    // centred over the welcome screen and moves with it.
    // Measured once it has stopped moving: the dialog fits itself to its content after it opens,
    // and that refit must not throw it back over the hidden window that raised it.
    const measure: () => Promise<Placement> = (): Promise<Placement> =>
      app.evaluate(({ BrowserWindow }, title: string): Placement => {
        const question: Electron.BrowserWindow | undefined = BrowserWindow.getAllWindows().find(
          (window: Electron.BrowserWindow): boolean => window.getTitle() === title,
        );
        const parent: Electron.BrowserWindow | null = question?.getParentWindow() ?? null;
        if (question === undefined || parent === null) {
          return { bounds: '', parentVisible: false, offsetX: Infinity, offsetY: Infinity };
        }
        const inner: Electron.Rectangle = question.getBounds();
        const outer: Electron.Rectangle = parent.getBounds();
        return {
          bounds: JSON.stringify(inner),
          parentVisible: parent.isVisible(),
          offsetX: Math.abs(inner.x + inner.width / 2 - (outer.x + outer.width / 2)),
          offsetY: Math.abs(inner.y - (outer.y + Math.max(0, (outer.height - inner.height) / 3))),
        };
      }, 'Do you trust this repository?');
    let previous: string = '';
    let placement: Placement = await measure();
    await expect
      .poll(async (): Promise<boolean> => {
        previous = placement.bounds;
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 300);
        });
        placement = await measure();
        return placement.bounds !== '' && placement.bounds === previous;
      })
      .toBe(true);
    expect(placement.parentVisible).toBe(true);
    expect(placement.offsetX).toBeLessThanOrEqual(2);
    expect(placement.offsetY).toBeLessThanOrEqual(2);

    await prompt.keyboard.press('Escape');

    expect(await cloned).toMatchObject({ ok: false, cancelled: true });
    expect(fs.existsSync(destination)).toBe(false);
  });
});
