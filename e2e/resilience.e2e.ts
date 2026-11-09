import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  answerOpenDialogWith,
  explorerRow,
  modalWindow,
  openFolderFromWelcome,
  ribbonButton,
} from './helpers';
import {
  adoptFakeHarnessConnection,
  FAKE_LANGUAGE_SERVER_ID,
  GIT,
  seedFakeHarness,
  seedFakeLanguageServer,
  seedInstall,
} from './seeded-installs';

/**
 * Lists the bytes a damaged file might hold: truncated JSON, the wrong shape, nothing, and not text.
 */
const DAMAGE: readonly (string | Buffer)[] = [
  '{"truncated": [1, 2',
  '"a string where an object belongs"',
  '',
  Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x00]),
];

/**
 * Lists every JSON file the main process reads from the profile as it starts.
 */
const PROFILE_FILES: readonly string[] = [
  'plugins.json',
  'trusted-paths.json',
  'repository-trust.json',
  'version-control.json',
  'hosting.json',
  'hosting-hosts.json',
  'clone.json',
  'new-project.json',
  'child-pids.json',
  'shell-environment.json',
  'security.json',
  'startup-preferences.json',
  'window-state.json',
  'lsp-settings.json',
  'agent-permission-rules.json',
  path.join('agent-conversations', 'index.json'),
];

/**
 * Reads the profile the application is running on, and fails the test unless it is a throwaway one.
 * A case that damages files has to prove where it is pointing before it does.
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

test.describe('a damaged profile', () => {
  for (const [index, damage] of DAMAGE.entries()) {
    test.describe(`damage ${index}`, () => {
      test.use({
        seedUserData: {
          write: (userDataDir: string): void => {
            for (const file of PROFILE_FILES) {
              const target: string = path.join(userDataDir, file);
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, damage);
            }
          },
        },
      });

      test('everyFileUnreadable_stillBootsToAUsableWelcome', async ({ app, page }) => {
        await throwawayProfile(app);

        const welcome: Page = await modalWindow(app);
        await welcome.getByText('New Code File').click();

        await expect(page.locator('app-code-view .monaco-editor')).toBeVisible();
      });
    });
  }

  test.describe('settings', () => {
    test('corruptSettings_stillBootToAUsableWelcome', async ({ app, page }) => {
      await throwawayProfile(app);
      // A document first: a reload that closed the welcome window would read as closing Studio.
      const first: Page = await modalWindow(app);
      await first.getByText('New Code File').click();
      await expect(page.locator('app-code-view .monaco-editor')).toBeVisible();

      await page.evaluate((): void => {
        localStorage.setItem('settings', '{"not json');
        localStorage.setItem('dock.layout', '{"not json');
      });
      await page.reload();

      const welcome: Page = await modalWindow(app, [first]);
      await welcome.getByText('New Markdown File').click();
      await expect(page.locator('app-markdown-view')).toBeVisible();
    });
  });

  test.describe('a conversation whose file is corrupt', () => {
    const contextId: string = 'global:new-agent';

    test.use({
      seedUserData: {
        write: (userDataDir: string): void => {
          seedFakeHarness(userDataDir);
          const store: string = path.join(userDataDir, 'agent-conversations');
          fs.mkdirSync(store, { recursive: true });
          fs.writeFileSync(
            path.join(store, 'index.json'),
            JSON.stringify([
              {
                id: 'damaged',
                contextId,
                title: 'A damaged conversation',
                messageCount: 3,
                createdAt: 1,
                updatedAt: 2,
              },
            ]),
          );
          fs.writeFileSync(path.join(store, 'damaged.json'), '{"truncated": ');
        },
      },
    });

    test('loadingIt_answersNothing_andTheAgentStillWorks', async ({ app, page }) => {
      await throwawayProfile(app);
      const welcome: Page = await modalWindow(app);
      await adoptFakeHarnessConnection(welcome);
      await welcome.getByText('New Agent').click();
      const chat: Locator = page.locator('app-agent-chat');

      await expect
        .poll((): Promise<unknown> =>
          page.evaluate((): Promise<unknown> =>
            (
              window as never as {
                bridge: { invoke: (channel: string, id: string) => Promise<unknown> };
              }
            ).bridge.invoke('agent-conversation:load', 'damaged'),
          ),
        )
        .toBeNull();
      await chat.getByRole('textbox', { name: 'Message the agent' }).fill('still answering');
      await chat.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(chat.locator('.agent__row app-markdown-renderer').last()).toContainText(
        'echo: still answering',
      );
    });
  });
});

test.describe('a plugin process killed under the application', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedInstall(dir, GIT) } });

  test('git_isStartedAgain_byTheNextThingThatNeedsIt', async ({ app, page, scratch }) => {
    const git: (...args: readonly string[]) => string = (...args: readonly string[]): string =>
      execFileSync('git', args, { cwd: scratch, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'E2E');
    git('config', 'user.email', 'e2e@example.invalid');
    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'original\n');
    git('add', '-A');
    git('commit', '-qm', 'first');
    const installs: string = path.join(await throwawayProfile(app), 'lsp-servers', GIT.id);
    await answerOpenDialogWith(app, scratch);
    const welcome: Page = await modalWindow(app);
    await welcome.getByText('Open Directory or File').click();
    const asked: Page = await modalWindow(app, [welcome]);
    await asked.getByRole('button', { name: 'Trust', exact: true }).click();
    await (await ribbonButton(page, 'Commit')).click();
    await page.getByRole('tab', { name: 'Commit' }).click();
    const panel: Locator = page.locator('app-commit-detail');
    await expect.poll((): number => processesUnder(installs).length).toBeGreaterThan(0);
    const killed: readonly number[] = processesUnder(installs);

    for (const pid of killed) {
      process.kill(pid, 'SIGKILL');
    }
    await expect
      .poll((): boolean => processesUnder(installs).every((pid: number) => !killed.includes(pid)))
      .toBe(true);
    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'changed\n');

    // The change only reaches the panel through a plugin that is running again.
    await expect(panel.locator('.detail__file-name', { hasText: 'tracked.txt' })).toBeVisible({
      timeout: 20_000,
    });
    expect(processesUnder(installs).length).toBeGreaterThan(0);
  });
});

test.describe('a language server killed under the editor', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedFakeLanguageServer(dir) } });

  test('saysItStopped_andRestartBringsItBack', async ({ app, page, scratch }) => {
    const file: string = path.join(scratch, 'main.py');
    fs.writeFileSync(file, 'print("hello")\n');
    const installs: string = path.join(
      await throwawayProfile(app),
      'lsp-servers',
      FAKE_LANGUAGE_SERVER_ID,
    );
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, file).dblclick();
    const menu: Locator = page.getByRole('button', { name: 'Language Servers' });
    const row: Locator = page.locator('.lsp-status-menu__item', {
      hasText: 'E2E Language Server',
    });
    // Killed while still answering `initialize`, the server's start fails instead ("Pending response
    // rejected since connection got disposed") and the row never says it stopped. This test is about a
    // running server, so it waits for one: the process existing is not enough on a slow runner. The
    // flyout stays open throughout, as it does for a user watching the row change.
    await menu.click();
    await expect(row).toHaveClass(/lsp-status-menu__item--ready/);
    const killed: readonly number[] = processesUnder(installs);
    expect(killed.length).toBeGreaterThan(0);

    for (const pid of killed) {
      process.kill(pid, 'SIGKILL');
    }

    await expect.poll((): number => processesUnder(installs).length).toBe(0);
    await expect(row).toContainText(/stopped|crashed|Restart/i);
    await row.getByRole('button', { name: 'Restart language server' }).click();

    await expect.poll((): number => processesUnder(installs).length).toBeGreaterThan(0);
    expect(processesUnder(installs).some((pid: number) => killed.includes(pid))).toBe(false);
  });
});
