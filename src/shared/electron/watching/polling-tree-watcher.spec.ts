import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { shouldPollInside } from '../directory-watch-filter';
import { PollingTreeWatcher } from './polling-tree-watcher';

/**
 * Describes one event the watcher reported.
 */
interface Reported {
  readonly eventType: string;
  readonly filename: string | null;
}

/**
 * Specifies the interval the specs poll at.
 */
const INTERVAL_MS: number = 40;

/**
 * Waits for a few polls to pass.
 * @returns Returns a promise that resolves after the wait.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, INTERVAL_MS * 5);
  });
}

describe('PollingTreeWatcher', () => {
  let root: string;
  let watcher: PollingTreeWatcher | undefined;
  let reported: Reported[];
  let errors: Error[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-poll-'));
    reported = [];
    errors = [];
    watcher = undefined;
  });

  afterEach(() => {
    watcher?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Starts polling the temp root.
   * @param recursive Whether everything beneath it is polled.
   */
  function start(recursive: boolean = true): void {
    watcher = new PollingTreeWatcher(
      root,
      {
        intervalMs: INTERVAL_MS,
        recursive,
        descend: (relative: string): boolean => shouldPollInside(relative),
      },
      (eventType: string, filename: string | null): void => {
        reported.push({ eventType, filename });
      },
      (error: Error): void => {
        errors.push(error);
      },
    );
  }

  /**
   * Gets the paths reported with an event type.
   * @param eventType The event type.
   * @returns Returns the paths.
   */
  function paths(eventType: string): (string | null)[] {
    return reported
      .filter((event: Reported): boolean => event.eventType === eventType)
      .map((event: Reported): string | null => event.filename);
  }

  it('reportsNothingForWhatWasThereBeforeItStarted', async () => {
    writeFileSync(path.join(root, 'index.html'), 'x');

    start();
    await settle();

    expect(reported).toEqual([]);
  });

  it('reportsACreatedFile_asARename_relativeToTheRoot', async () => {
    mkdirSync(path.join(root, 'site'));
    start();
    await settle();

    writeFileSync(path.join(root, 'site', 'index.html'), 'x');
    await settle();

    expect(paths('rename')).toContain(path.join('site', 'index.html'));
  });

  it('reportsAModifiedFile_asAChange', async () => {
    const file: string = path.join(root, 'a.css');
    writeFileSync(file, 'a');
    start();
    await settle();

    writeFileSync(file, 'body { color: red; }');
    await settle();

    expect(paths('change')).toEqual(['a.css']);
  });

  it('reportsAChangeOfTimeAlone_asAChange', async () => {
    const file: string = path.join(root, 'a.txt');
    writeFileSync(file, 'same');
    start();
    await settle();

    utimesSync(file, new Date(2030, 0, 1), new Date(2030, 0, 1));
    await settle();

    expect(paths('change')).toEqual(['a.txt']);
  });

  it('reportsADeletedFile_asARename', async () => {
    const file: string = path.join(root, 'gone.js');
    writeFileSync(file, 'x');
    start();
    await settle();

    rmSync(file);
    await settle();

    expect(paths('rename')).toEqual(['gone.js']);
  });

  it('readsNothingInsideDependencyFolders_butSeesThemAppear', async () => {
    start();
    await settle();

    mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    await settle();

    expect(paths('rename')).toEqual(['node_modules']);
  });

  it('readsOnlyTheRootsOwnEntries_whenNotRecursive', async () => {
    mkdirSync(path.join(root, 'nested'));
    start(false);
    await settle();

    writeFileSync(path.join(root, 'nested', 'deep.txt'), 'x');
    writeFileSync(path.join(root, 'top.txt'), 'x');
    await settle();

    expect(paths('rename')).toEqual(['top.txt']);
  });

  it('reportsAnError_whenTheRootGoesAway', async () => {
    start();
    await settle();

    rmSync(root, { recursive: true, force: true });
    await settle();

    expect(errors).toHaveLength(1);
  });

  it('reportsNothingAfterClosing', async () => {
    start();
    await settle();

    watcher?.close();
    writeFileSync(path.join(root, 'late.txt'), 'x');
    await settle();

    expect(reported).toEqual([]);
  });
});
