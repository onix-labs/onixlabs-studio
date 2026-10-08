import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  FAKE_HARNESS_ID,
  GIT,
  GITHUB,
  INSTALLED_VERSION,
  installDirectory,
  invoke,
  SeedablePlugin,
  seedFakeHarness,
  seedInstall,
  writeInstalledTree,
} from './seeded-installs';

/**
 * Counts the processes running from a directory — a plugin's install directory for one version, which
 * only that version's process names on its command line. A process keeps the path it was started with
 * even once the files under it are deleted, which is exactly what makes a stale one visible.
 * @param directory The directory.
 * @returns Returns how many processes run from it.
 */
function processesUnder(directory: string): number {
  const listing: string = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' });
  return listing.split('\n').filter((line: string): boolean => line.includes(directory)).length;
}

/**
 * Reads the profile directory the fixture launched the application with.
 * @param app The launched application.
 * @returns Returns the userData directory.
 */
function userDataOf(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app: electronApp }): string => electronApp.getPath('userData'));
}

/**
 * Gets the directory every installed version of a plugin lives under.
 * @param userDataDir The userData directory.
 * @param plugin The plugin.
 * @returns Returns the directory.
 */
function everyVersionOf(userDataDir: string, plugin: SeedablePlugin): string {
  return path.join(userDataDir, 'lsp-servers', plugin.id);
}

/**
 * A plugin removed or updated in the Plugin Manager stops running the version it replaced (#881).
 *
 * Before, its process outlived its files: a removed GitHub went on answering for pull requests and CI
 * runs, a removed Git for repositories, and an update was not used until Studio restarted.
 */
test.describe('a removed or updated plugin stops its old process (#881)', () => {
  test.describe('Git', () => {
    test.use({ seedUserData: { write: (dir: string): void => seedInstall(dir, GIT) } });

    test('uninstall_endsTheRunningProcess', async ({
      app,
      page,
    }: {
      app: ElectronApplication;
      page: Page;
    }) => {
      const installs: string = everyVersionOf(await userDataOf(app), GIT);
      // Asking what the plugin supports starts it, as any source-control surface would.
      await invoke(page, 'source-control:list-plugins');
      await expect.poll((): number => processesUnder(installs)).toBeGreaterThan(0);

      const result: { success: boolean } = await invoke(page, 'plugins:uninstall', GIT.id);

      expect(result.success).toBe(true);
      await expect.poll((): number => processesUnder(installs), { timeout: 10_000 }).toBe(0);
    });

    test('update_replacesTheRunningProcessWithTheNewVersion', async ({
      app,
      page,
    }: {
      app: ElectronApplication;
      page: Page;
    }) => {
      const userData: string = await userDataOf(app);
      const old: string = installDirectory(userData, GIT, INSTALLED_VERSION);
      const offered: string = installDirectory(userData, GIT, '0.3.0');
      await invoke(page, 'source-control:list-plugins');
      await expect.poll((): number => processesUnder(old)).toBeGreaterThan(0);
      // The catalogue's 0.3.0, already downloaded: the install verifies it is complete and uses it
      // rather than fetching, which keeps the case offline. Written only now, because a version
      // present at launch would be the one started in the first place.
      writeInstalledTree(userData, GIT, '0.3.0');

      const result: { success: boolean } = await invoke(page, 'plugins:install', GIT.id);
      await invoke(page, 'source-control:list-plugins');

      expect(result.success).toBe(true);
      await expect.poll((): number => processesUnder(old), { timeout: 10_000 }).toBe(0);
      await expect
        .poll((): number => processesUnder(offered), { timeout: 10_000 })
        .toBeGreaterThan(0);
    });
  });

  test.describe('GitHub', () => {
    test.use({ seedUserData: { write: (dir: string): void => seedInstall(dir, GITHUB) } });

    test('uninstall_endsTheRunningProcess_andItsHostsAreNoLongerServed', async ({
      app,
      page,
    }: {
      app: ElectronApplication;
      page: Page;
    }) => {
      const installs: string = everyVersionOf(await userDataOf(app), GITHUB);
      // Listing the hosts asks each one how it is signed in, which starts the plugin; no network or
      // sign-in is needed for it to answer that it is not.
      const before: readonly { host: string }[] = await invoke(page, 'forge:hosts');
      expect(before.map((account: { host: string }): string => account.host)).toContain(
        'github.com',
      );
      await expect.poll((): number => processesUnder(installs)).toBeGreaterThan(0);

      const result: { success: boolean } = await invoke(page, 'plugins:uninstall', GITHUB.id);

      expect(result.success).toBe(true);
      await expect.poll((): number => processesUnder(installs), { timeout: 10_000 }).toBe(0);
      expect(await invoke<readonly unknown[]>(page, 'forge:hosts')).toEqual([]);
    });
  });

  test.describe('an agent harness holding a live session', () => {
    test.use({ seedUserData: { write: (dir: string): void => seedFakeHarness(dir) } });

    test('uninstall_endsAnIdleSessionAtOnce', async ({
      app,
      page,
    }: {
      app: ElectronApplication;
      page: Page;
    }) => {
      const installs: string = path.join(await userDataOf(app), 'lsp-servers', FAKE_HARNESS_ID);
      await startTurn(page, 'idle-run', 'hello');
      expect((await settled(page, 'idle-run')).state).toBe('completed');
      // The turn is over but the session is held open, which is the point of a live harness.
      expect(processesUnder(installs)).toBeGreaterThan(0);

      await invoke(page, 'plugins:uninstall', FAKE_HARNESS_ID);

      await expect.poll((): number => processesUnder(installs), { timeout: 10_000 }).toBe(0);
      expect(await endedSessions(page)).toContainEqual({
        agentSessionId: SESSION,
        reason: 'retired',
      });
    });

    test('uninstall_letsATurnInProgressFinish_thenEndsTheSession', async ({
      app,
      page,
    }: {
      app: ElectronApplication;
      page: Page;
    }) => {
      // Matthew's rule: a version change never cuts off a turn the user is watching.
      const installs: string = path.join(await userDataOf(app), 'lsp-servers', FAKE_HARNESS_ID);
      await startTurn(page, 'busy-run', 'hold 3000');
      // ⚠️ Mid-turn means the harness has the turn, not merely that its process exists. The fake
      // reports its session as the turn begins; removing the plugin any earlier deletes the script
      // while the runtime is still loading it, which is a different (and much rarer) failure.
      await expect
        .poll(async (): Promise<boolean> =>
          (await recordedEvents(page)).some(
            (event: AiEventLike): boolean =>
              event.requestId === 'busy-run' && event.kind === 'session',
          ),
        )
        .toBe(true);

      await invoke(page, 'plugins:uninstall', FAKE_HARNESS_ID);

      // Still running, and still answering: the turn finishes as though nothing happened.
      expect(processesUnder(installs)).toBeGreaterThan(0);
      const finished: AiEventLike = await settled(page, 'busy-run');
      expect(finished.state).toBe('completed');
      expect(await textOf(page, 'busy-run')).toBe('echo: hold 3000');
      // …and only then does the session end.
      await expect.poll((): number => processesUnder(installs), { timeout: 10_000 }).toBe(0);
      expect(await endedSessions(page)).toContainEqual({
        agentSessionId: SESSION,
        reason: 'retired',
      });
    });
  });
});

/**
 * The part of an agent event these cases read.
 */
interface AiEventLike {
  readonly requestId?: string;
  readonly kind: string;
  readonly state?: string;
  readonly delta?: string;
  readonly agentSessionId?: string;
  readonly reason?: string;
}

/**
 * Holds the conversation every harness case runs in.
 */
const SESSION: string = 'e2e-live-session';

/**
 * Holds the connection pointed at the fake harness. Credential-free, so nothing is asked for.
 */
const CONNECTION: Readonly<Record<string, unknown>> = {
  id: 'e2e-connection',
  kind: 'e2e',
  label: 'E2E',
  auth: 'none',
  harnessId: FAKE_HARNESS_ID,
  models: [{ id: 'e2e-model', label: 'E2E Model', contextWindow: 100_000 }],
  defaultModelId: 'e2e-model',
};

/**
 * Starts a turn in the live session, recording every agent event the window is sent from then on.
 *
 * ⚠️ The connection is registered in the same breath as the run. The renderer replaces the main
 * process's connections with the user's own whenever it lists providers — at start-up, among other
 * times — and a run naming a connection that list does not hold is refused as an unknown provider.
 * @param page The main window.
 * @param requestId The run's identifier.
 * @param prompt What the fake harness is asked.
 */
async function startTurn(page: Page, requestId: string, prompt: string): Promise<void> {
  await page.evaluate(
    async ({
      connection,
      request,
    }: {
      connection: Readonly<Record<string, unknown>>;
      request: Readonly<Record<string, unknown>>;
    }): Promise<void> => {
      const studio: {
        bridge: {
          invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
          on: (channel: string, listener: (event: unknown) => void) => () => void;
        };
        e2eAiEvents?: unknown[];
      } = window as never;
      if (studio.e2eAiEvents === undefined) {
        const recorded: unknown[] = [];
        studio.e2eAiEvents = recorded;
        studio.bridge.on('ai:event', (event: unknown): void => void recorded.push(event));
      }
      await studio.bridge.invoke('ai:list-providers', [connection]);
      await studio.bridge.invoke('ai:run', request);
    },
    {
      connection: CONNECTION,
      request: {
        requestId,
        agentSessionId: SESSION,
        providerId: CONNECTION['id'],
        model: 'e2e-model',
        prompt,
        workspaceRoot: null,
        owningTabId: null,
        permissionPosture: 'prompt',
        tokenCap: 0,
        surface: 'editor',
        mode: 'agent',
        agentSessionLifetimeMs: 0,
      },
    },
  );
}

/**
 * Reads every agent event recorded so far.
 * @param page The main window.
 * @returns Returns the events, in arrival order.
 */
function recordedEvents(page: Page): Promise<readonly AiEventLike[]> {
  return page.evaluate((): readonly AiEventLike[] =>
    ((window as never as { e2eAiEvents?: AiEventLike[] }).e2eAiEvents ?? []).slice(),
  );
}

/**
 * Waits for a run to settle, and returns the status it settled with.
 * @param page The main window.
 * @param requestId The run.
 * @returns Returns the settling status event.
 */
async function settled(page: Page, requestId: string): Promise<AiEventLike> {
  const isSettled: (event: AiEventLike) => boolean = (event: AiEventLike): boolean =>
    event.requestId === requestId && event.kind === 'status' && event.state !== 'started';
  await expect
    .poll(async (): Promise<boolean> => (await recordedEvents(page)).some(isSettled), {
      timeout: 15_000,
    })
    .toBe(true);
  return (await recordedEvents(page)).find(isSettled)!;
}

/**
 * Reads the assistant text a run produced.
 * @param page The main window.
 * @param requestId The run.
 * @returns Returns the text.
 */
async function textOf(page: Page, requestId: string): Promise<string> {
  return (await recordedEvents(page))
    .filter((event: AiEventLike): boolean => event.requestId === requestId && event.kind === 'text')
    .map((event: AiEventLike): string => event.delta ?? '')
    .join('');
}

/**
 * Reads the live sessions reported ended, and why.
 * @param page The main window.
 * @returns Returns each ended session and its reason.
 */
async function endedSessions(
  page: Page,
): Promise<readonly { agentSessionId?: string; reason?: string }[]> {
  return (await recordedEvents(page))
    .filter((event: AiEventLike): boolean => event.kind === 'session-ended')
    .map((event: AiEventLike) => ({ agentSessionId: event.agentSessionId, reason: event.reason }));
}
