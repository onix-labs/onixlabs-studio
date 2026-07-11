import { expect, Locator, Page } from '@playwright/test';

/**
 * Opens a document tab from the welcome screen by clicking one of its actions (for example
 * `New Markdown File` or `New Code File`) and waits for the created view to be visible.
 * @param page The application window.
 * @param action The welcome-screen action text to click.
 * @param viewSelector The tab view element expected to appear (for example `app-markdown-view`).
 */
export async function openTabFromWelcome(
  page: Page,
  action: string,
  viewSelector: string,
): Promise<void> {
  await page.getByText(action).click();
  await expect(page.locator(viewSelector)).toBeVisible();
}

/**
 * Resolves a ribbon button by its accessible name, opening the `More ribbon groups` overflow
 * flyout first when the button's group is scooped behind it at the current window size.
 * @param page The application window.
 * @param name The button's accessible name (its ribbon label).
 * @returns Returns the visible ribbon button locator.
 */
export async function ribbonButton(page: Page, name: string): Promise<Locator> {
  const button: Locator = page.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    return button.first();
  }
  await page.getByRole('button', { name: 'More ribbon groups' }).click();
  await expect(button.first()).toBeVisible();
  return button.first();
}
