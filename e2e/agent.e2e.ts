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
