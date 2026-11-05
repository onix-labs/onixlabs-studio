import { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow, ribbonButton } from './helpers';

/**
 * Describes how a recorded terminal ended.
 */
interface RecordedExit {
  /**
   * Gets the session that ended.
   */
  readonly id: string;

  /**
   * Gets the code it exited with.
   */
  readonly code: number;

  /**
   * Gets the signal that ended it, or null when it exited on its own.
   */
  readonly signal: number | null;
}

/**
 * Starts recording what the main process sends every terminal. xterm paints on a canvas, so nothing
 * of a terminal's screen can be read from the page; the bytes on their way to it are the next best
 * thing, and they are what proves a real shell ran.
 * @param page The main application window.
 */
async function recordTerminals(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const studio: {
      bridge: { on: (channel: string, listener: (...args: unknown[]) => void) => () => void };
      e2eTerminal?: { output: string[]; exits: RecordedExit[] };
    } = window as never;
    const recorded: { output: string[]; exits: RecordedExit[] } = { output: [], exits: [] };
    studio.e2eTerminal = recorded;
    studio.bridge.on('terminal:data', (_id: unknown, data: unknown): void => {
      recorded.output.push(data as string);
    });
    studio.bridge.on('terminal:exit', (id: unknown, code: unknown, signal: unknown): void => {
      recorded.exits.push({
        id: id as string,
        code: code as number,
        signal: signal as number | null,
      });
    });
  });
}

/**
 * Reads the output recorded so far.
 * @param page The main application window.
 * @returns Returns everything every terminal printed.
 */
function output(page: Page): Promise<string> {
  return page.evaluate((): string =>
    (window as never as { e2eTerminal: { output: string[] } }).e2eTerminal.output.join(''),
  );
}

/**
 * Reads the terminal exits recorded so far.
 * @param page The main application window.
 * @returns Returns each exit, in order.
 */
function exits(page: Page): Promise<readonly RecordedExit[]> {
  return page.evaluate((): readonly RecordedExit[] =>
    (window as never as { e2eTerminal: { exits: RecordedExit[] } }).e2eTerminal.exits.slice(),
  );
}

/**
 * Types a command into the focused terminal and runs it, once the shell has said something: a command
 * typed before the prompt is drawn can land in the shell's own start-up and be lost.
 * @param page The main application window.
 * @param command The command.
 */
async function run(page: Page, command: string): Promise<void> {
  await expect.poll((): Promise<string> => output(page)).not.toBe('');
  await page.locator('app-terminal .terminal.xterm').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

/**
 * Opens a terminal from the welcome screen, recording it from its first byte.
 * @param app The launched application.
 * @param page The main application window.
 */
async function openTerminal(app: ElectronApplication, page: Page): Promise<void> {
  await recordTerminals(page);
  const welcome: Page = await modalWindow(app);
  await welcome.getByText('New Terminal').click();
  await expect(page.locator('app-terminal .terminal.xterm')).toBeVisible();
}

test.describe('terminal', () => {
  test('aCommand_runsInARealShell_andItsOutputComesBack', async ({ app, page }) => {
    await openTerminal(app, page);

    // Arithmetic, so the answer cannot be the shell echoing back what was typed.
    await run(page, 'echo $((6 * 7))x');

    await expect.poll((): Promise<string> => output(page)).toContain('42x');
  });

  test('exit_withAFailure_keepsTheTabOpen_andReportsTheCode', async ({ app, page }) => {
    await openTerminal(app, page);

    await run(page, 'exit 3');

    await expect
      .poll(async (): Promise<readonly number[]> =>
        (await exits(page)).map((exit: RecordedExit): number => exit.code),
      )
      .toEqual([3]);
    await expect(page.locator('app-terminal .terminal.xterm')).toBeVisible();
  });

  test('aShellKilledOutright_isReportedBySignal_andNewStartsAFreshOne', async ({ app, page }) => {
    await openTerminal(app, page);

    await run(page, 'kill -9 $$');

    await expect
      .poll(async (): Promise<readonly (number | null)[]> =>
        (await exits(page)).map((exit: RecordedExit): number | null => exit.signal),
      )
      .toEqual([9]);
    await page.evaluate((): void => {
      (window as never as { e2eTerminal: { output: string[] } }).e2eTerminal.output.length = 0;
    });
    await (await ribbonButton(page, 'New')).click();
    await run(page, 'echo $((6 * 8))x');
    await expect.poll((): Promise<string> => output(page)).toContain('48x');
  });

  test('closingTheTab_ofAnExitedTerminal_returnsToWelcome_andATerminalOpensAgain', async ({
    app,
    page,
  }) => {
    await openTerminal(app, page);
    await run(page, 'exit 3');
    await expect.poll(async (): Promise<number> => (await exits(page)).length).toBe(1);

    await page.getByRole('button', { name: 'Close tab' }).click();

    const welcome: Page = await modalWindow(app);
    await welcome.getByText('New Terminal').click();
    await expect(page.locator('app-terminal .terminal.xterm')).toBeVisible();
    await page.evaluate((): void => {
      (window as never as { e2eTerminal: { output: string[] } }).e2eTerminal.output.length = 0;
    });
    await run(page, 'echo $((6 * 9))x');
    await expect.poll((): Promise<string> => output(page)).toContain('54x');
  });
});
