import * as fs from 'node:fs';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  documentTab,
  editorLines,
  explorerRow,
  isModalWindow,
  modalWindow,
  MOD,
  openFolderFromWelcome,
} from './helpers';
import { adoptFakeHarnessConnection, seedFakeHarness } from './seeded-installs';

/**
 * Turns on Open Tabs in New Windows (#1587) and reloads, so the welcome screen opens again under it.
 * @param app The launched application.
 * @param page The main application window.
 */
async function withTabWindows(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate((): void => {
    const stored: Record<string, unknown> = JSON.parse(
      localStorage.getItem('settings') ?? '{}',
    ) as Record<string, unknown>;
    localStorage.setItem('settings', JSON.stringify({ ...stored, 'application.tabWindows': true }));
  });
  const stale: readonly Page[] = app.windows().filter(isModalWindow);
  await page.reload();
  await modalWindow(app, stale);
}

/**
 * Opens a tab from the welcome screen.
 * @param app The launched application.
 * @param page The main application window.
 * @param action The welcome screen's action.
 * @param view The view the tab shows.
 */
async function openTab(
  app: ElectronApplication,
  page: Page,
  action: string,
  view: string,
): Promise<void> {
  if ((await page.locator('app-title-strip-tab').count()) > 0) {
    await page.getByRole('button', { name: 'Welcome' }).click();
  }
  const welcome: Page = await modalWindow(app);
  await welcome.getByText(action).click();
  await expect(page.locator(view)).toBeVisible();
}

/**
 * Moves a tab into a new Studio window from its menu.
 * @param app The launched application.
 * @param page The main application window.
 * @param type The tab's type.
 * @returns Returns the new window.
 */
async function moveToNewWindow(app: ElectronApplication, page: Page, type: string): Promise<Page> {
  const tab: Locator = page.locator('app-title-strip-tab', {
    has: page.locator(`[role="tab"][data-tab-type="${type}"]`),
  });
  const opened: Promise<Page> = app.waitForEvent('window', {
    predicate: (window: Page): boolean => window.url().includes('studio-panel'),
  });
  await tab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Tab in New Window' }).click();
  return opened;
}

test.describe('Studio windows (#1587)', () => {
  test('aTabsMenu_offersNoNewWindow_untilTheSettingIsOn', async ({ app, page }) => {
    await openTab(app, page, 'New Code File', 'app-code-view');

    await page.locator('app-title-strip-tab').first().click({ button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Close Tab' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open Tab in New Window' })).toHaveCount(0);
  });

  test('aMovedTab_getsAWholeStudioWindow_andComesBackWhenItCloses', async ({ app, page }) => {
    await withTabWindows(app, page);
    await openTab(app, page, 'New Code File', 'app-code-view');
    await page.locator('app-code-view .monaco-editor .view-lines').click();
    await page.keyboard.type('kept across windows');
    await openTab(app, page, 'New Terminal', 'app-terminal .terminal.xterm');

    const window: Page = await moveToNewWindow(app, page, 'code');

    // The new window is a whole Studio surface: its own title strip with its tab, the ribbon and
    // status strip of that tab, and the tab itself, with its unsaved text.
    await expect(window.locator('app-title-strip-container')).toBeVisible();
    await expect(
      window.locator('app-title-strip-tab [role="tab"][data-tab-type="code"]'),
    ).toBeVisible();
    await expect(window.locator('app-ribbon-strip-container')).toBeVisible();
    await expect(window.locator('app-status-strip-container')).toBeVisible();
    await expect(window.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows',
    );

    // The first window keeps its own tab, ribbon and status strip, and no longer shows the moved one.
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(1);
    await expect(
      page.locator('app-title-strip-tab [role="tab"][data-tab-type="terminal"]'),
    ).toBeVisible();
    await expect(page.locator('app-code-view')).toHaveCount(0);

    // Typing and the status strip work in the new window: the caret's column follows the typing.
    await window.locator('app-code-view .monaco-editor .view-lines').click();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type('!');
    await expect(window.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows!',
    );
    await expect(window.locator('app-status-strip-container')).toContainText('Col 21');

    await window.close();
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(2);
    await expect(page.locator('app-code-view .monaco-editor .view-lines')).toContainText(
      'kept across windows!',
    );
  });

  test('aWindowWhoseLastTabCloses_closesWithIt', async ({ app, page }) => {
    await withTabWindows(app, page);
    await openTab(app, page, 'New Code File', 'app-code-view');
    await openTab(app, page, 'New Terminal', 'app-terminal .terminal.xterm');
    const window: Page = await moveToNewWindow(app, page, 'terminal');
    await expect(window.locator('app-terminal .terminal.xterm')).toBeVisible();

    const closed: Promise<void> = window.waitForEvent('close');
    await window.locator('app-title-strip-tab').getByRole('button', { name: 'Close tab' }).click();
    // A terminal still running its shell asks first.
    const ask: Locator = page.locator('app-terminal-confirm-modal');
    if (await ask.isVisible().catch((): boolean => false)) {
      await ask.getByRole('button', { name: /Close/ }).click();
    }

    await closed;
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(1);
  });
});

/**
 * Records what every terminal prints, from now on. Terminals in every window print through the first
 * window's bridge, so this hears them all.
 * @param page The main application window.
 */
async function recordTerminals(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const studio: {
      bridge: { on: (channel: string, listener: (...args: unknown[]) => void) => () => void };
      e2eTerminal?: string[];
    } = window as never;
    const recorded: string[] = [];
    studio.e2eTerminal = recorded;
    studio.bridge.on('terminal:data', (_id: unknown, data: unknown): void => {
      recorded.push(data as string);
    });
  });
}

/**
 * Reads what the terminals have printed so far.
 * @param page The main application window.
 * @returns Returns the output.
 */
function terminalOutput(page: Page): Promise<string> {
  return page.evaluate((): string =>
    (window as never as { e2eTerminal: string[] }).e2eTerminal.join(''),
  );
}

/**
 * Types a command into a window's terminal and runs it.
 * @param window The window showing the terminal.
 * @param command The command.
 */
async function runIn(window: Page, command: string): Promise<void> {
  await window.locator('app-terminal .terminal.xterm:visible').click();
  await window.keyboard.type(command);
  await window.keyboard.press('Enter');
}

test.describe('a workspace moved to its own window (#1587)', () => {
  test('keepsItsFolder_itsUnsavedEdit_andItsShell', async ({ app, page, scratch }) => {
    const file: string = path.join(scratch, 'notes.txt');
    fs.writeFileSync(file, 'first line\n');
    await withTabWindows(app, page);
    await recordTerminals(page);
    await openFolderFromWelcome(app, page, scratch);
    await explorerRow(page, file).dblclick();
    await expect(editorLines(page)).toContainText('first line');
    await editorLines(page).click();
    await page.keyboard.press(`${MOD}+Home`);
    await page.keyboard.type('edited ');
    await documentTab(page, 'Terminal').click();
    await expect(page.locator('app-terminal .terminal.xterm:visible')).toBeVisible();
    await expect.poll((): Promise<string> => terminalOutput(page)).not.toBe('');
    await runIn(page, 'kept=41; echo started$((kept))');
    await expect.poll((): Promise<string> => terminalOutput(page)).toContain('started41');
    // A window's only tab cannot move, so the workspace needs company.
    await openTab(app, page, 'New Code File', 'app-code-view');

    const window: Page = await moveToNewWindow(app, page, 'directory');

    // The new window shows the same workspace: its folder, the edit not yet saved, and the shell
    // that is still running, which remembers what it was told before the move.
    await expect(window.locator('app-directory-view')).toBeVisible();
    await expect(explorerRow(window, file)).toBeVisible();
    await expect(editorLines(window)).toContainText('edited first line');
    await expect(window.locator('app-terminal .terminal.xterm:visible')).toBeVisible();
    await runIn(window, 'echo $((kept + 1))moved');
    await expect.poll((): Promise<string> => terminalOutput(page)).toContain('42moved');
    expect(fs.readFileSync(file, 'utf8')).toBe('first line\n');
    await expect(page.locator('app-directory-view')).toHaveCount(0);

    // Closing the window brings the workspace home, still the same.
    await window.close();
    await expect(page.locator('app-title-strip-tab [role="tab"]')).toHaveCount(2);
    await page.locator('app-title-strip-tab [role="tab"][data-tab-type="directory"]').click();
    await expect(editorLines(page)).toContainText('edited first line');
    await documentTab(page, 'Terminal').click();
    await runIn(page, 'echo $((kept + 2))home');
    await expect.poll((): Promise<string> => terminalOutput(page)).toContain('43home');
  });
});

test.describe('an agent moved to its own window (#1587)', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedFakeHarness(dir) } });

  test('keepsItsConversation_andAnswersInItsNewWindow', async ({ app, page }) => {
    // The connection first: adopting it saves the settings, which would put back the switch.
    await adoptFakeHarnessConnection(await modalWindow(app));
    await withTabWindows(app, page);
    await (await modalWindow(app)).getByText('New Agent').click();

    /**
     * Sends a prompt and waits for the fake agent's echo of it.
     * @param chat The conversation surface.
     * @param prompt The prompt.
     */
    async function ask(chat: Locator, prompt: string): Promise<void> {
      await chat.getByRole('textbox', { name: 'Message the agent' }).fill(prompt);
      await chat.getByRole('button', { name: 'Send', exact: true }).click();
      // The first turn waits for the agent to start.
      await expect(chat.getByRole('log', { name: 'Conversation' })).toContainText(
        `echo: ${prompt}`,
        { timeout: 30_000 },
      );
      await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden();
    }

    await ask(page.locator('app-agent-chat'), 'before the move');
    // A window keeps at least one tab, so the agent's has company.
    await openTab(app, page, 'New Code File', 'app-code-view');

    const window: Page = await moveToNewWindow(app, page, 'agent');

    // The conversation came with it, and its agent answers there: the chat in the new window shows
    // what streams in (#1587).
    const moved: Locator = window.locator('app-agent-chat');
    await expect(moved.getByRole('log', { name: 'Conversation' })).toContainText(
      'echo: before the move',
    );
    await ask(moved, 'after the move');
  });
});
