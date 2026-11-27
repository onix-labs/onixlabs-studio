import * as fs from 'node:fs';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow } from './helpers';
import {
  adoptFakeHarnessConnection,
  fakeHarnessReadyGate,
  seedFakeHarness,
} from './seeded-installs';

/**
 * Opens an agent tab on the fake harness's connection, past the welcome screen.
 * @param app The launched application.
 * @param page The main window.
 * @returns Returns the agent's conversation surface.
 */
async function openAgent(app: ElectronApplication, page: Page): Promise<Locator> {
  const welcome: Page = await modalWindow(app);
  await adoptFakeHarnessConnection(welcome);
  await welcome.getByText('New Agent').click();
  const chat: Locator = page.locator('app-agent-chat');
  await expect(chat).toBeVisible();
  await expect(chat.getByRole('textbox', { name: 'Message the agent' })).toBeVisible();
  return chat;
}

/**
 * Sends a prompt the way a user does.
 * @param chat The conversation surface.
 * @param prompt The prompt.
 */
async function send(chat: Locator, prompt: string): Promise<void> {
  await chat.getByRole('textbox', { name: 'Message the agent' }).fill(prompt);
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
}

/**
 * Finds the transcript.
 * @param chat The conversation surface.
 * @returns Returns the log of the conversation.
 */
function transcript(chat: Locator): Locator {
  return chat.getByRole('log', { name: 'Conversation' });
}

/**
 * Finds what the agent last said, which the user's own message in the same log must not be mistaken for.
 * @param chat The conversation surface.
 * @returns Returns the agent's latest message.
 */
function agentText(chat: Locator): Locator {
  return chat.locator('.agent__row app-markdown-renderer').last();
}

/**
 * Reads the fake harness's process id out of the transcript, where it reports it.
 * @param chat The conversation surface.
 * @returns Returns the process id.
 */
async function harnessPid(chat: Locator): Promise<number> {
  await expect(transcript(chat)).toContainText(/pid:\d+:/);
  return Number(/pid:(\d+):/.exec((await transcript(chat).textContent()) ?? '')?.[1]);
}

test.describe('an agent conversation on a live harness', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedFakeHarness(dir) } });

  test('aPrompt_isAnsweredInTheTranscript_andTheComposerComesBack', async ({ app, page }) => {
    const chat: Locator = await openAgent(app, page);

    await send(chat, 'hello there');

    await expect(agentText(chat)).toContainText('echo: hello there');
    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden();
  });

  test('aRequestWithWideMarkdown_staysInsideItsBubble_andReadable (#1603)', async ({
    app,
    page,
  }) => {
    const chat: Locator = await openAgent(app, page);
    const wide: string = `const ${'veryLongIdentifier'.repeat(18)} = 1;`;

    await send(
      chat,
      [
        '> A quoted line the user wrote.',
        '',
        '> [!NOTE]',
        '> An alert the user wrote.',
        '',
        '| Column | Another column |',
        '| --- | --- |',
        '| one | two |',
        '',
        '```ts',
        wide,
        '```',
        '',
        `A long unbroken run: ${'x'.repeat(400)}`,
      ].join('\n'),
    );

    const bubble: Locator = chat.locator('.agent__message--user .agent__bubble').last();
    await expect(bubble.locator('.code-block__pre')).toBeVisible();
    const layout: {
      bubbleLeft: number;
      bubbleRight: number;
      bodyLeft: number;
      bodyRight: number;
      codeScrolls: boolean;
      quoteContrast: number;
      codeOpaque: boolean;
      tokenContrast: number;
      alertContrast: number;
    } = await bubble.evaluate((element: HTMLElement) => {
      // Composites a colour over an opaque one: the computed value of a translucent mix is
      // `color(srgb r g b / a)` or `rgba(...)`, in 0–1 or 0–255 channels.
      const parse: (value: string) => number[] = (value: string): number[] => {
        const srgb: RegExpExecArray | null =
          /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value);
        if (srgb !== null) {
          return [
            Number(srgb[1]) * 255,
            Number(srgb[2]) * 255,
            Number(srgb[3]) * 255,
            Number(srgb[4] ?? 1),
          ];
        }
        const rgb: number[] = (value.match(/[\d.]+/g) ?? []).map(Number);
        return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, rgb[3] ?? 1];
      };
      const over: (top: number[], under: number[]) => number[] = (
        top: number[],
        under: number[],
      ): number[] =>
        [0, 1, 2].map((i: number): number => top[i] * top[3] + under[i] * (1 - top[3]));
      const luminance: (rgb: number[]) => number = (rgb: number[]): number => {
        const linear: number[] = rgb.map((channel: number): number => {
          const c: number = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const contrast: (a: number[], b: number[]) => number = (a: number[], b: number[]): number => {
        const [high, low] = [luminance(a), luminance(b)].sort(
          (x: number, y: number): number => y - x,
        );
        return (high + 0.05) / (low + 0.05);
      };
      const bubbleBackground: number[] = parse(getComputedStyle(element).backgroundColor);
      const quote: HTMLElement = element.querySelector('blockquote')!;
      const quoteBackground: number[] = over(
        parse(getComputedStyle(quote).backgroundColor),
        bubbleBackground,
      );
      const pre: HTMLElement = element.querySelector('.code-block__pre')!;
      const preBackground: number[] = parse(getComputedStyle(pre).backgroundColor);
      const codeBackground: number[] = over(preBackground, bubbleBackground);
      // The colours the editor theme gives each token, which are what were unreadable on the accent.
      const tokens: readonly HTMLElement[] = Array.from(
        pre.querySelectorAll<HTMLElement>('span[class*="mtk"]'),
      ).filter((span: HTMLElement): boolean => span.textContent.trim() !== '');
      const alert: HTMLElement = element.querySelector('.github-alert')!;
      const alertBackground: number[] = over(
        parse(getComputedStyle(alert).backgroundColor),
        bubbleBackground,
      );
      const body: DOMRect = element.closest('.agent__message-body')!.getBoundingClientRect();
      const box: DOMRect = element.getBoundingClientRect();
      return {
        bubbleLeft: box.left,
        bubbleRight: box.right,
        bodyLeft: body.left,
        bodyRight: body.right,
        codeScrolls: pre.scrollWidth > pre.clientWidth,
        quoteContrast: contrast(parse(getComputedStyle(quote).color), quoteBackground),
        codeOpaque: preBackground[3] === 1,
        tokenContrast: Math.min(
          ...tokens.map((span: HTMLElement): number =>
            contrast(parse(getComputedStyle(span).color), codeBackground),
          ),
        ),
        alertContrast: contrast(parse(getComputedStyle(alert).color), alertBackground),
      };
    });

    // Wider content scrolls inside the bubble instead of pushing it past the column's edge.
    expect(layout.bubbleLeft).toBeGreaterThanOrEqual(layout.bodyLeft - 1);
    expect(layout.bubbleRight).toBeLessThanOrEqual(layout.bodyRight + 1);
    expect(layout.codeScrolls).toBe(true);
    // A quote, an alert and every token of code read clearly against what they sit on. Code sits on
    // the editor's own opaque panel, so its tokens keep the colours the editor theme chose for it.
    expect(layout.quoteContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.alertContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.codeOpaque).toBe(true);
    expect(layout.tokenContrast).toBeGreaterThanOrEqual(4.5);
  });

  test('output_appearsWhileTheTurnIsStillRunning', async ({ app, page }) => {
    const chat: Locator = await openAgent(app, page);

    await send(chat, 'partial streaming words arrive');

    await expect(agentText(chat)).toContainText('streaming words arrive');
    await expect(chat.getByRole('button', { name: 'Stop' })).toBeVisible();
    await chat.getByRole('button', { name: 'Stop' }).click();
    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden();
  });

  test('stop_endsAHeldTurn_andTheSameSessionTakesTheNextPrompt', async ({ app, page }) => {
    const chat: Locator = await openAgent(app, page);
    await send(chat, 'pid');
    const before: number = await harnessPid(chat);

    await chat.getByRole('button', { name: 'Stop' }).click();

    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden();
    await send(chat, 'after the stop');
    await expect(agentText(chat)).toContainText('echo: after the stop');
    // Stopping a turn is not ending the session: the process is the one that was running.
    expect(((): boolean => process.kill(before, 0))()).toBe(true);
  });

  test('stop_whileTheHarnessIsStarting_dropsTheTurnWithoutAnError', async ({ app, page }) => {
    const gate: string = fakeHarnessReadyGate(
      await app.evaluate(({ app: electronApp }): string => electronApp.getPath('userData')),
    );
    const chat: Locator = await openAgent(app, page);
    fs.writeFileSync(gate, '');
    await send(chat, 'pid');

    await chat.getByRole('button', { name: 'Stop' }).click();
    // Pressed with nothing yet in flight, so the harness finishes starting only after the stop.
    fs.rmSync(gate);

    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden({ timeout: 15_000 });
    await expect(chat.locator('app-agent-error-card')).toBeHidden();
    await expect(agentText(chat)).toHaveCount(0);
    await send(chat, 'after the stop');
    await expect(agentText(chat)).toContainText('echo: after the stop');
  });

  test('stop_ofAHarnessThatIgnoresIt_stillGivesTheComposerBack', async ({ app, page }) => {
    const chat: Locator = await openAgent(app, page);
    await send(chat, 'stubborn');
    await expect(transcript(chat)).toContainText('not stopping');

    await chat.getByRole('button', { name: 'Stop' }).click();

    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden({ timeout: 15_000 });
  });

  test('aHarnessKilledMidTurn_endsTheTurnWithAnError_andTheNextPromptStartsAFreshOne', async ({
    app,
    page,
  }) => {
    const chat: Locator = await openAgent(app, page);
    await send(chat, 'pid');
    const killed: number = await harnessPid(chat);

    process.kill(killed, 'SIGKILL');

    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden({ timeout: 15_000 });
    await expect(chat.locator('app-agent-error-card')).toContainText(/harness/i);
    await send(chat, 'still here');
    await expect(agentText(chat)).toContainText('echo: still here');
  });

  test('aHarnessKilledBetweenTurns_isReplacedByTheNextPrompt', async ({ app, page }) => {
    const chat: Locator = await openAgent(app, page);
    await send(chat, 'pid');
    const killed: number = await harnessPid(chat);
    await chat.getByRole('button', { name: 'Stop' }).click();
    await expect(chat.getByRole('button', { name: 'Stop' })).toBeHidden();

    process.kill(killed, 'SIGKILL');
    // Nothing to wait on from the outside but the process itself.
    await expect
      .poll((): boolean => {
        try {
          return process.kill(killed, 0);
        } catch {
          return false;
        }
      })
      .toBe(false);

    await send(chat, 'after the crash');
    await expect(agentText(chat)).toContainText('echo: after the crash');
  });
});
