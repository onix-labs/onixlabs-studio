import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow } from './helpers';

/**
 * Opens the Containers tab from the welcome screen.
 *
 * Not `openTabFromWelcome`, which clicks an action directly: the welcome screen is a single-open
 * accordion with Get Started open, and Containers lives under Tools — so the group has to be expanded
 * before its actions exist in the DOM at all.
 * @param app The Electron application.
 * @param page The main window.
 */
async function openContainers(app: ElectronApplication, page: Page): Promise<void> {
  const welcome: Page = await modalWindow(app);
  await welcome.getByRole('button', { name: 'Tools' }).click();
  await welcome.getByText('Containers', { exact: true }).click();
  await expect(page.locator('app-containers-view')).toBeVisible();
}

/**
 * The Containers surface end to end, against a Studio that ships no container engine (#596, #597).
 *
 * What can be asserted here is bounded by what a test machine has. No container engine is running, and
 * seeding a real one would mean shipping a third-party daemon, so these cover the two states that need
 * none — *nothing installed* and *installed but not running*. Those are also the two states the surface
 * used to confuse with each other, which is the whole reason #455 and #595 exist.
 *
 * Listing containers needs a live engine, and stays in the unit suite against a stubbed backend.
 */
test.describe('containers with no engine installed', () => {
  test('offersAnEngineRatherThanReportingNothingRunning', async ({ app, page }) => {
    await openContainers(app, page);
    const view: Locator = page.locator('app-containers-view');

    // The distinction the epic exists for: a fresh Studio has nothing to talk to because nothing is
    // installed, which is a different problem from an engine being stopped, and has a different fix.
    await expect(view).toContainText('No container engine is installed');
    await expect(view).not.toContainText("isn't running");
  });
});

test.describe('containers with an engine installed', () => {
  // A synthetic engine whose socket cannot exist, so it is installed but not running — the one state
  // reachable without a real engine on the machine.
  test.use({ sideloadEngine: 'Test Engine' });

  test('namesTheEngineFromItsManifestAndSaysHowToStartIt', async ({ app, page }) => {
    await openContainers(app, page);
    const view: Locator = page.locator('app-containers-view');

    // Reaching the catalogue at all proves the contribution point end to end: nothing in core knows
    // this engine exists, and its manifest alone put it there (#594).
    await expect(view).toContainText("Test Engine isn't running");
    // Named rather than guessed at, and offered the command that starts it rather than a button
    // Studio cannot honour (#455, #596).
    await expect(view).toContainText('e2e engine start');
    await expect(view).not.toContainText('No container engine is installed');
  });

  test('offersNoButtonThatWouldStartTheEngine', async ({ app, page }) => {
    await openContainers(app, page);
    const actions: Locator = page.locator('app-containers-view .containers__empty-actions button');

    // Studio talks to an engine; it does not run one. Refresh is the only thing it can honestly offer.
    await expect(actions).toHaveText(['Refresh']);
  });
});
