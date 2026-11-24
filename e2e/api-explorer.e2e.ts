import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { MOD, openTabFromWelcome } from './helpers';

/**
 * Adds a request from the ribbon, waiting for its panel so what follows is done to it and not to the
 * one before.
 * @param page The main application window.
 * @returns Returns the request's panel.
 */
async function addRequest(page: Page): Promise<Locator> {
  const panels: Locator = page.locator('app-api-request-panel');
  const before: number = await panels.count();
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(panels).toHaveCount(before + 1);
  return panels.nth(before);
}

/**
 * Adds a request from the ribbon and sends it.
 * @param page The main application window.
 * @param url The address to send it to.
 * @returns Returns the request's panel.
 */
async function sendNewRequest(page: Page, url: string): Promise<Locator> {
  const request: Locator = await addRequest(page);
  await request.locator('.request__url input').fill(url);
  await request.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request.locator('.request__status')).toContainText('200');
  return request;
}

/**
 * The API Explorer against a server of the test's own.
 */
test.describe('the API Explorer', () => {
  let server: http.Server;
  let url: string;

  test.beforeEach(async () => {
    server = http.createServer((_request: http.IncomingMessage, reply: http.ServerResponse) => {
      reply.setHeader('content-type', 'application/json');
      reply.end(JSON.stringify({ needle: 1, list: ['needle', 'hay'] }));
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  test.afterEach(() => {
    server.close();
  });

  test('theResponseDivider_drags_andANewRequestStartsWhereItWasLeft', async ({ app, page }) => {
    await openTabFromWelcome(app, page, 'New API Explorer', 'app-api-explorer-view');
    const first: Locator = await sendNewRequest(page, url);
    const before: number = (await first.locator('.request__response').boundingBox())!.height;

    const box: { x: number; y: number; width: number } = (await first
      .locator('.request__response')
      .boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 38, { steps: 4 });
    await page.mouse.up();
    const dragged: number = (await first.locator('.request__response').boundingBox())!.height;
    expect(dragged).toBeGreaterThan(before + 30);

    const second: Locator = await sendNewRequest(page, url);

    const opened: number = (await second.locator('.request__response').boundingBox())!.height;
    expect(Math.abs(opened - dragged)).toBeLessThanOrEqual(1);
  });

  test('findInAResponse_opensTheExplorersOneFindPanel_whichFollowsTheRequestInFront', async ({
    app,
    page,
  }) => {
    await openTabFromWelcome(app, page, 'New API Explorer', 'app-api-explorer-view');
    const first: Locator = await sendNewRequest(page, url);
    const find: Locator = page.locator('app-api-find-panel');
    await expect(find).toBeHidden();

    // On its first line: the text layer inside is taller than the pane shows.
    await first.locator('.request__payload').click({ position: { x: 80, y: 20 } });
    await page.keyboard.press(`${MOD}+f`);

    // In the dock beside the Agent, rather than inside the request.
    await expect(find).toBeVisible();
    await expect(first.locator('app-search-view')).toHaveCount(0);
    await find.locator('input').first().fill('needle');
    await page.keyboard.press('Enter');
    await expect(find.locator('.search-view__results')).toContainText('Response Body');
    await expect(find.locator('.search-view__results .tree-row')).toHaveCount(3);

    // A request with no body open has nothing to search, until it has been sent.
    const second: Locator = await addRequest(page);
    await expect(find).toContainText('no body open to search');
    await second.locator('.request__url input').fill(url);
    await second.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(find.locator('.search-view__results .tree-row')).toHaveCount(3);
    await expect(find).toHaveCount(1);
  });
});
