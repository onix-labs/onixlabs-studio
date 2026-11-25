import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MOD, modalWindow, openTabFromWelcome, ribbonButton } from './helpers';

/**
 * Where an element is on the page.
 */
type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/**
 * Sizes the main window.
 * @param app The launched application.
 * @param page The main application window.
 * @param width The width, in pixels.
 */
async function setWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, value: number): void => {
    const window: Electron.BrowserWindow | undefined = BrowserWindow.getAllWindows().find(
      (candidate: Electron.BrowserWindow): boolean => candidate.isVisible(),
    );
    window?.setMinimumSize(300, 300);
    window?.setSize(value, 800);
  }, width);
  await expect.poll((): Promise<number> => page.evaluate((): number => innerWidth)).toBe(width);
}

/**
 * Toggles a panel from the ribbon.
 * @param page The main application window.
 * @param name The panel's button.
 */
async function toggle(page: Page, name: string): Promise<void> {
  await (await ribbonButton(page, name)).click();
  await page.keyboard.press('Escape');
  // The flyout the button may have been in fades; until it has gone, what it holds still looks clickable.
  await expect(page.locator('.ribbon-overflow__flyout:visible')).toHaveCount(0);
}

/**
 * Opens a tool's tab from the welcome screen.
 * @param app The launched application.
 * @param tool The tool's name.
 */
async function openTool(app: ElectronApplication, tool: string): Promise<void> {
  const welcome: Page = await modalWindow(app);
  await welcome.getByRole('tab', { name: 'Tools & Settings' }).click();
  await welcome.locator('.welcome__tool', { hasText: tool }).first().click();
}

/**
 * Gets the width of an element.
 * @param element The element.
 * @returns Returns the width, in pixels, or zero when it isn't drawn.
 */
async function widthOf(element: Locator): Promise<number> {
  return (await element.boundingBox())?.width ?? 0;
}

/**
 * Gets where a view's main content is.
 * @param view The view.
 * @returns Returns its box.
 */
async function mainBox(view: Locator): Promise<Box> {
  return (await view.locator('.dock-container__main').boundingBox())!;
}

/**
 * Starts dragging a panel by its group's title bar, to a point.
 * @param page The main application window.
 * @param title The panel's title.
 * @param x The point's x coordinate.
 * @param y The point's y coordinate.
 */
async function dragTo(page: Page, title: string, x: number, y: number): Promise<void> {
  const bar: { x: number; y: number } = (await page
    .locator('.dock-tab-group__title-text:visible', { hasText: title })
    .boundingBox())!;
  await page.mouse.move(bar.x + 5, bar.y + 5);
  await page.mouse.down();
  await page.mouse.move(bar.x + 30, bar.y + 30, { steps: 4 });
  await page.mouse.move(x, y, { steps: 8 });
  // The last move resolves on the next frame.
  await page.waitForTimeout(100);
}

/**
 * The rules a simple dock fits its panels to the window by (#1575).
 */
test.describe('the main view keeps half the room', () => {
  test('whatDoesNotFit_collapses_andComesBackAsTheWindowGrows', async ({ app, page }) => {
    await openTool(app, 'Plugin Manager');
    const view: Locator = page.locator('app-plugin-manager-view');
    const main: Locator = view.locator('.dock-container__main');
    const strips: Locator = view.locator('app-dock-collapsed-strip:visible');
    await setWidth(app, page, 1280);
    await toggle(page, 'Agent');
    await expect(strips).toHaveCount(0);

    for (const [width, collapsed] of [
      [1240, 0],
      [1200, 1],
      [900, 1],
      [780, 2],
      [600, 2],
    ] as const) {
      await setWidth(app, page, width);
      await expect(strips).toHaveCount(collapsed);
      expect(await widthOf(main)).toBeGreaterThanOrEqual(width / 2);
    }
    await setWidth(app, page, 900);
    await expect(strips).toHaveCount(1);
    await setWidth(app, page, 1280);
    await expect(strips).toHaveCount(0);
  });

  test('resizingTheWindow_collapsesOnceAndNeverFlickers', async ({ app, page }) => {
    await openTool(app, 'Plugin Manager');
    await setWidth(app, page, 1280);
    await toggle(page, 'Agent');
    await page.evaluate((): void => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      const look: () => void = (): void => {
        const now: string = String(
          [...document.querySelectorAll('app-dock-collapsed-strip')].filter(
            (strip: Element): boolean => strip.getBoundingClientRect().width > 0,
          ).length,
        );
        if (seen.at(-1) !== now) {
          seen.push(now);
        }
        requestAnimationFrame(look);
      };
      look();
    });
    for (const step of [-10, 10]) {
      for (let moved: number = 0; moved < 600; moved += 10) {
        await app.evaluate(({ BrowserWindow }, by: number): void => {
          const window: Electron.BrowserWindow = BrowserWindow.getAllWindows().find(
            (candidate: Electron.BrowserWindow): boolean => candidate.isVisible(),
          )!;
          window.setSize(window.getSize()[0] + by, 800);
        }, step);
        await page.waitForTimeout(20);
      }
    }
    await expect
      .poll((): Promise<string> =>
        page.evaluate((): string => (window as unknown as { seen: string[] }).seen.join('')),
      )
      .toBe('01210');
  });

  test('aPanelOpenedWithNoRoom_slidesOut_andCanNotBeDocked_untilThereIs', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await setWidth(app, page, 700);
    await toggle(page, 'Agent');
    const flyout: Locator = page.locator('.dock-collapsed-strip__flyout');
    await expect(flyout).toBeVisible();
    expect(await widthOf(flyout)).toBeGreaterThanOrEqual(330);
    await expect(flyout.getByRole('button', { name: 'Dock', exact: true })).toBeDisabled();

    await setWidth(app, page, 1000);
    await expect(flyout).toBeHidden();
    await expect(page.locator('app-markdown-view app-dock-tab-group:visible')).toHaveCount(1);
  });

  test('collapsedByItsButton_aPanelStaysCollapsed_untilDocked', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await setWidth(app, page, 1000);
    await toggle(page, 'Agent');
    const view: Locator = page.locator('app-markdown-view');
    await view.getByRole('button', { name: 'Auto Hide' }).click();
    const strip: Locator = view.locator('app-dock-collapsed-strip:visible');
    await expect(strip).toHaveCount(1);

    await setWidth(app, page, 1280);
    await expect(strip).toHaveCount(1);
    await strip.getByRole('tab', { name: 'Agent' }).click();
    await view.getByRole('button', { name: 'Dock', exact: true }).click();
    await expect(strip).toHaveCount(0);
  });

  test('draggingAPanel_greysTheSidesItMayNotDockTo_andGroupsItWithAList', async ({ app, page }) => {
    await openTool(app, 'Plugin Manager');
    await setWidth(app, page, 1280);
    await toggle(page, 'Agent');
    const view: Locator = page.locator('app-plugin-manager-view');
    const greyed: Locator = page.locator('.dock-overlay__guide--disabled');

    await dragTo(page, 'Agent', 600, 455);
    await expect(
      page.locator('.dock-overlay__guide--top.dock-overlay__guide--disabled'),
    ).toBeVisible();
    await expect(
      page.locator('.dock-overlay__guide--bottom.dock-overlay__guide--disabled'),
    ).toBeVisible();
    await expect(page.locator('.dock-overlay__edge--disabled')).toHaveCount(2);
    // Dropping on a side it may not dock to leaves it where it was.
    await page.mouse.move(580, 455 + 37, { steps: 3 });
    await page.mouse.up();
    await expect(view.locator('app-dock-tab-group:visible')).toHaveCount(2);

    await dragTo(page, 'Agent', 120, 455);
    await expect(greyed).toHaveCount(0);
    await page.mouse.up();
    await expect(view.locator('app-dock-tab-group:visible')).toHaveCount(1);
    await expect(view.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

    // The list in front has no Close, and collapses as the agent does.
    await view.locator('.dock-tab__label', { hasText: 'Plugins' }).click();
    await expect(view.getByRole('button', { name: 'Close', exact: true })).toBeHidden();
    await expect(view.getByRole('button', { name: 'Auto Hide' })).toBeVisible();
  });

  test('panelsStackedInAColumn_collapseToOneStrip', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await page.locator('app-markdown-view .ProseMirror').click();
    await page.keyboard.type('# Overview');
    await setWidth(app, page, 1280);
    await toggle(page, 'Outline');
    await toggle(page, 'Agent');
    const view: Locator = page.locator('app-markdown-view');
    const group: { x: number; y: number; width: number; height: number } = (await view
      .locator('app-dock-tab-group:visible')
      .boundingBox())!;
    await dragTo(page, 'Agent', group.x + group.width / 2, group.y + group.height / 2 + 37);
    await page.mouse.up();
    await expect(view.locator('app-dock-tab-group:visible')).toHaveCount(2);

    const strips: Locator = view.locator('app-dock-collapsed-strip:visible');
    // Wide enough for the outline, once the agent is out of its way.
    await setWidth(app, page, 640);
    await expect(strips).toHaveCount(1);
    await setWidth(app, page, 500);
    await expect(strips).toHaveCount(2);
    for (const strip of await strips.all()) {
      expect(await strip.boundingBox()).toMatchObject({ x: 470, width: 30 });
    }
    await strips.first().getByRole('tab').click();
    await expect(view.locator('.dock-collapsed-strip__flyout')).toBeVisible();

    await setWidth(app, page, 1280);
    await expect(strips).toHaveCount(0);
  });

  test('aPanelOnTheLeft_slidesOutOverTheMainView_whateverIsBetweenItAndTheEdge', async ({
    app,
    page,
  }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await page.locator('app-markdown-view .ProseMirror').click();
    await page.keyboard.type('# Overview');
    await setWidth(app, page, 1280);
    await toggle(page, 'Outline');
    await setWidth(app, page, 1600);
    await dragTo(page, 'Outline', 34, 455);
    await page.mouse.up();
    await toggle(page, 'Agent');
    const view: Locator = page.locator('app-markdown-view');
    const main: Box = await mainBox(view);
    await dragTo(page, 'Agent', main.x + main.width / 2 - 37, main.y + main.height / 2);
    await page.mouse.up();
    await expect.poll(async (): Promise<number> => (await mainBox(view)).x).toBeGreaterThan(600);

    // With the outline closed the agent is the first group drawn, though not the first in the layout.
    await view.getByRole('button', { name: 'Close', exact: true }).first().click();
    await view.getByRole('button', { name: 'Auto Hide' }).click();
    const strip: Locator = view.locator('app-dock-collapsed-strip:visible');
    expect(await strip.boundingBox()).toMatchObject({ x: 0 });
    await strip.getByRole('tab', { name: 'Agent' }).click();
    const flyout: Locator = view.locator('.dock-collapsed-strip__flyout');
    expect(await widthOf(flyout)).toBeGreaterThanOrEqual(360);
    expect((await flyout.boundingBox())!.x).toBeGreaterThanOrEqual(30);
    await view.getByRole('button', { name: 'Dock', exact: true }).click();
    await expect(strip).toHaveCount(0);
  });

  test('aPanelThatComesBackOfItself_leavesTheKeyboardWhereItWas', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New Markdown File', 'app-markdown-view');
    await setWidth(app, page, 1280);
    const editor: Locator = page.locator('app-markdown-view .ProseMirror');
    await editor.click();
    await page.keyboard.press(`${MOD}+f`);
    const find: Locator = page.locator('app-find-panel input').first();
    await expect(find).toBeFocused();
    await editor.click();
    await page.keyboard.type('one');
    await setWidth(app, page, 440);
    await expect(page.locator('app-markdown-view app-dock-collapsed-strip:visible')).toHaveCount(1);
    await setWidth(app, page, 1280);
    await expect(find).toBeVisible();
    await page.keyboard.type(' two');
    await expect(editor).toHaveText('one two');

    // Opened on purpose, it takes the keyboard. The first press closes it.
    await page.keyboard.press(`${MOD}+f`);
    await expect(find).toBeHidden();
    await page.keyboard.press(`${MOD}+f`);
    await expect(find).toBeFocused();
  });
});
