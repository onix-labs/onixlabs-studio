import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  answerMessageBoxWith,
  answerOpenDialogWith,
  explorerRow,
  messageBoxesAsked,
  modalWindow,
  ribbonButton,
} from './helpers';
import { GIT, seedInstall } from './seeded-installs';

/**
 * Runs Git in the fixture repository, which is how a test reads what actually happened: the
 * repository, not the panel reporting on it.
 * @param repository The repository.
 * @param args The arguments.
 * @returns Returns what Git printed, trimmed.
 */
function git(repository: string, ...args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

/**
 * Makes a repository with a commit on `main`, and a `feature` branch holding one file `main` has not.
 * The identity is the repository's own, so a commit made through Studio needs nothing from the machine.
 * @param repository The directory to make it in.
 */
function writeRepository(repository: string): void {
  git(repository, 'init', '-q', '-b', 'main');
  git(repository, 'config', 'user.name', 'E2E');
  git(repository, 'config', 'user.email', 'e2e@example.invalid');
  git(repository, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'original\n');
  git(repository, 'add', '-A');
  git(repository, 'commit', '-qm', 'first');
  git(repository, 'checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(repository, 'only-on-feature.txt'), 'feature\n');
  git(repository, 'add', '-A');
  git(repository, 'commit', '-qm', 'on feature');
  git(repository, 'checkout', '-q', 'main');
}

/**
 * Opens the repository as a workspace and trusts it when asked. A repository is an unknown folder
 * until the user says otherwise, so nothing reads it before this.
 * @param app The launched application.
 * @param page The main application window.
 * @param repository The repository.
 */
async function openTrusted(
  app: ElectronApplication,
  page: Page,
  repository: string,
): Promise<void> {
  await answerOpenDialogWith(app, repository);
  const welcome: Page = await modalWindow(app);
  await welcome.getByText('Open Directory or File').click();
  await expect(page.locator('app-directory-view')).toBeVisible();
  const asked: Page = await modalWindow(app, [welcome]);
  await asked.getByRole('button', { name: 'Trust', exact: true }).click();
}

/**
 * Opens the Commit panel on the working tree, and waits for the changes it should list.
 * @param page The main application window.
 * @param changes How many changes the repository holds.
 * @returns Returns the panel.
 */
async function openCommitPanel(page: Page, changes: number): Promise<Locator> {
  await (await ribbonButton(page, 'Commit')).click();
  await page.getByRole('tab', { name: 'Commit' }).click();
  const panel: Locator = page.locator('app-commit-detail');
  await expect(panel.locator('.detail__file-name')).toHaveCount(changes);
  return panel;
}

/**
 * Finds a working-tree file's row in the Commit panel.
 * @param panel The Commit panel.
 * @param fileName The file's name.
 * @returns Returns the row.
 */
function changeRow(panel: Locator, fileName: string): Locator {
  return panel.locator('[role="treeitem"]', {
    has: panel.page().locator('.detail__file-name', { hasText: fileName }),
  });
}

test.describe('version control through the Git plugin', () => {
  test.use({ seedUserData: { write: (dir: string): void => seedInstall(dir, GIT) } });

  test('explorer_marksModifiedAndUntrackedFiles', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'changed\n');
    fs.writeFileSync(path.join(scratch, 'fresh.txt'), 'new\n');

    await openTrusted(app, page, scratch);

    await expect(explorerRow(page, path.join(scratch, 'tracked.txt'))).toHaveAttribute(
      'title',
      'Modified',
    );
    await expect(explorerRow(page, path.join(scratch, 'fresh.txt'))).toHaveAttribute(
      'title',
      /^Untracked/,
    );
  });

  test('explorer_picksUpAChangeMadeOutsideStudio', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    await openTrusted(app, page, scratch);
    const tracked: Locator = explorerRow(page, path.join(scratch, 'tracked.txt'));
    await expect(tracked).toBeVisible();
    await expect(tracked).not.toHaveAttribute('title', 'Modified');

    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'changed\n');

    await expect(tracked).toHaveAttribute('title', 'Modified', { timeout: 20_000 });
  });

  test('commit_ofTheCheckedFiles_leavesTheUncheckedOneUncommitted', async ({
    app,
    page,
    scratch,
  }) => {
    writeRepository(scratch);
    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'changed\n');
    fs.writeFileSync(path.join(scratch, 'fresh.txt'), 'new\n');
    await openTrusted(app, page, scratch);
    const panel: Locator = await openCommitPanel(page, 2);

    await changeRow(panel, 'fresh.txt').getByRole('checkbox').uncheck();
    await panel.getByRole('textbox', { name: 'Commit message' }).fill('change the tracked file');
    await panel.getByRole('button', { name: 'Commit', exact: true }).click();

    await expect
      .poll((): string => git(scratch, 'log', '-1', '--format=%s'))
      .toBe('change the tracked file');
    expect(git(scratch, 'show', '--name-only', '--format=', 'HEAD')).toBe('tracked.txt');
    expect(git(scratch, 'status', '--porcelain')).toBe('?? fresh.txt');
    await expect(changeRow(panel, 'tracked.txt')).toBeHidden();
    await expect(changeRow(panel, 'fresh.txt')).toBeVisible();
  });

  test('commit_takesWhatWasAlreadyStagedOutsideStudio', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    fs.writeFileSync(path.join(scratch, 'tracked.txt'), 'changed\n');
    git(scratch, 'add', 'tracked.txt');
    await openTrusted(app, page, scratch);
    const panel: Locator = await openCommitPanel(page, 1);

    await expect(changeRow(panel, 'tracked.txt')).toBeVisible();
    await panel.getByRole('textbox', { name: 'Commit message' }).fill('already staged');
    await panel.getByRole('button', { name: 'Commit', exact: true }).click();

    await expect
      .poll((): string => git(scratch, 'log', '-1', '--format=%s'))
      .toBe('already staged');
    expect(git(scratch, 'status', '--porcelain')).toBe('');
  });

  test('checkOut_switchesTheBranch_andTheWorkingTreeFollows', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    await openTrusted(app, page, scratch);
    await (await ribbonButton(page, 'Commit')).click();

    await page.locator('[data-tree-id="branch:feature"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Check Out' }).click();

    await expect.poll((): string => git(scratch, 'branch', '--show-current')).toBe('feature');
    expect(fs.existsSync(path.join(scratch, 'only-on-feature.txt'))).toBe(true);
    await expect(page.locator('app-status-strip-container')).toContainText('feature');
  });

  test('discard_restoresATrackedFile_onlyOnceConfirmed', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    const tracked: string = path.join(scratch, 'tracked.txt');
    fs.writeFileSync(tracked, 'changed\n');
    await openTrusted(app, page, scratch);
    const panel: Locator = await openCommitPanel(page, 1);
    const row: Locator = changeRow(panel, 'tracked.txt');

    await answerMessageBoxWith(app, 'Cancel');
    await row.hover();
    await row.getByRole('button', { name: 'Discard changes' }).click();
    await expect
      .poll((): Promise<readonly string[]> => messageBoxesAsked(app))
      .toEqual(['Discard the changes to "tracked.txt"?']);
    expect(fs.readFileSync(tracked, 'utf8')).toBe('changed\n');

    await answerMessageBoxWith(app, 'Discard');
    await row.hover();
    await row.getByRole('button', { name: 'Discard changes' }).click();

    await expect.poll((): string => fs.readFileSync(tracked, 'utf8')).toBe('original\n');
    await expect(row).toBeHidden();
  });

  test('discard_ofAnUntrackedFile_deletesIt_andOnlyIt', async ({ app, page, scratch }) => {
    writeRepository(scratch);
    const fresh: string = path.join(scratch, 'fresh.txt');
    const keep: string = path.join(scratch, 'keep.txt');
    fs.writeFileSync(fresh, 'new\n');
    fs.writeFileSync(keep, 'new\n');
    await openTrusted(app, page, scratch);
    const panel: Locator = await openCommitPanel(page, 2);
    await answerMessageBoxWith(app, 'Discard');

    const row: Locator = changeRow(panel, 'fresh.txt');
    await row.hover();
    await row.getByRole('button', { name: 'Discard changes' }).click();

    await expect.poll((): boolean => fs.existsSync(fresh)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(path.join(scratch, 'tracked.txt'))).toBe(true);
  });
});
