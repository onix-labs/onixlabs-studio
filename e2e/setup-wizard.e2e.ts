import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { modalWindow } from './helpers';

/**
 * The setup wizard: the blocking pass a user meets on a first launch and after every version change,
 * before they reach a tab.
 *
 * This is the one suite that lets the wizard run. Every other suite suppresses it, because a
 * throwaway profile is a first run and the wizard would otherwise stand in front of everything they
 * are about — which is precisely the behaviour asserted here.
 */
test.describe('setup wizard', () => {
  test.use({ runSetupWizard: true });

  /**
   * Resolves the wizard's window, which is the modal window the application opens at a cold start.
   * @param app The launched application.
   * @returns Returns the wizard window.
   */
  async function wizardWindow(app: Parameters<typeof modalWindow>[0]): Promise<Page> {
    const window: Page = await modalWindow(app);
    await expect(window.locator('.setup')).toBeVisible();
    return window;
  }

  test('firstRun_showsTheWizardRatherThanTheWelcomeScreen', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);

    // The wizard comes first and the welcome screen stands aside: both want the same cold start.
    await expect(wizard.locator('.setup__intro-title')).toContainText('ONIXLabs Studio');
    await expect(wizard.locator('.welcome__title')).toHaveCount(0);
  });

  test('firstRun_railStatesEveryStepAndMarksTheFirstAsCurrent', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);

    const labels: readonly string[] = await wizard.locator('.setup__step-label').allTextContents();
    // A first run has no previous version to report against, so it carries no What's New.
    expect(labels.map((label: string): string => label.trim())).toEqual([
      'Welcome',
      'Appearance',
      'Environment',
      'Tooling',
      'AI Provider',
      'Security',
      'Terminal',
      'Source Control',
    ]);

    await expect(wizard.locator('.setup__step--current .setup__step-label')).toHaveText('Welcome');
  });

  test('firstStep_offersNoWayBack', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);

    await expect(wizard.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  test('next_advancesTheStepAndTicksTheOneLeftBehind', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);

    await wizard.getByRole('button', { name: 'Next' }).click();

    await expect(wizard.locator('.setup__step--current .setup__step-label')).toHaveText(
      'Appearance',
    );
    await expect(wizard.locator('.setup__step--walked .setup__step-label')).toHaveText('Welcome');
  });

  test('back_afterAdvancing_returnsButKeepsTheStepWalked', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);
    await wizard.getByRole('button', { name: 'Next' }).click();

    await wizard.getByRole('button', { name: 'Back' }).click();

    await expect(wizard.locator('.setup__step--current .setup__step-label')).toHaveText('Welcome');
    // Going back does not un-walk what is behind you, so the tick stays.
    await expect(wizard.locator('.setup__step--walked')).toHaveCount(1);
  });

  test('lastStep_offersFinishRatherThanNext', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);
    const next: Locator = wizard.getByRole('button', { name: 'Next' });

    for (let step: number = 0; step < 7; step += 1) {
      await next.click();
    }

    await expect(wizard.locator('.setup__step--current .setup__step-label')).toHaveText(
      'Source Control',
    );
    await expect(wizard.getByRole('button', { name: 'Finish' })).toBeVisible();
    await expect(next).toHaveCount(0);
  });

  test('finish_closesTheWizardAndHandsOverToTheWelcomeScreen', async ({ app }) => {
    const wizard: Page = await wizardWindow(app);
    for (let step: number = 0; step < 7; step += 1) {
      await wizard.getByRole('button', { name: 'Next' }).click();
    }

    await wizard.getByRole('button', { name: 'Finish' }).click();

    // The wizard's window closes and the welcome screen takes the cold start it was standing aside
    // for. It is a different window, so the previous one is excluded from the search.
    const welcome: Page = await modalWindow(app, [wizard]);
    await expect(welcome.locator('.welcome__title')).toContainText('ONIXLabs Studio');
  });
});
