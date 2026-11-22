import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderPoll, pollIntervalOf } from './poll-folder';

/**
 * Waits for a few polls to pass.
 * @returns Returns a promise that resolves after the wait.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 1000);
  });
}

describe('FolderPoll (#1254)', () => {
  let scratch: string = '';
  let poll: FolderPoll | undefined;
  let changed: string[] = [];

  beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-server-poll-')));
    fs.mkdirSync(path.join(scratch, 'css'));
    fs.writeFileSync(path.join(scratch, 'index.html'), '<p>old</p>');
    changed = [];
    poll = undefined;
  });

  afterEach(() => {
    poll?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Starts polling the scratch folder at the shortest interval accepted.
   */
  function start(): void {
    poll = new FolderPoll(scratch, 250, (relative: string): void => {
      changed.push(relative);
    });
  }

  it('reportsNothing_untilAFileChanges', async () => {
    start();
    await settle();

    expect(changed).toEqual([]);
  });

  it('reportsAChangedFile_anAddedOne_andARemovedOne', async () => {
    start();
    await settle();

    fs.writeFileSync(path.join(scratch, 'index.html'), '<p>new, and longer</p>');
    fs.writeFileSync(path.join(scratch, 'css', 'site.css'), 'p {}');
    await settle();
    fs.rmSync(path.join(scratch, 'css', 'site.css'));
    await settle();

    expect(changed).toEqual([
      'index.html',
      path.join('css', 'site.css'),
      path.join('css', 'site.css'),
    ]);
  });

  it('reportsASameSizeReplacement_withTheSameModificationTime', async () => {
    const page: string = path.join(scratch, 'index.html');
    const { mtime }: fs.Stats = fs.statSync(page);
    start();
    await settle();

    const next: string = path.join(scratch, 'index.tmp');
    fs.writeFileSync(next, '<p>new</p>');
    fs.utimesSync(next, mtime, mtime);
    fs.renameSync(next, page);
    await settle();

    expect(changed).toContain('index.html');
  });

  it('readsNothingInsideDotFoldersOrDependencies', async () => {
    fs.mkdirSync(path.join(scratch, '.git'));
    fs.mkdirSync(path.join(scratch, 'node_modules'));
    start();
    await settle();

    fs.writeFileSync(path.join(scratch, '.git', 'HEAD'), 'ref');
    fs.writeFileSync(path.join(scratch, 'node_modules', 'a.js'), 'x');
    await settle();

    expect(changed).toEqual([]);
  });

  it('reportsNothing_afterClosing', async () => {
    start();
    await settle();

    poll?.close();
    fs.writeFileSync(path.join(scratch, 'late.html'), 'x');
    await settle();

    expect(changed).toEqual([]);
  });
});

describe('pollIntervalOf', () => {
  it('clampsWhatStudioAsks_andIgnoresWhatIsNotANumber', () => {
    expect(pollIntervalOf(2000)).toBe(2000);
    expect(pollIntervalOf(1)).toBe(250);
    expect(pollIntervalOf(10_000_000)).toBe(60_000);
    expect(pollIntervalOf(undefined)).toBeUndefined();
    expect(pollIntervalOf(Number.NaN)).toBeUndefined();
  });
});
