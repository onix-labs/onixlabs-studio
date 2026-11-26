import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { vi } from 'vitest';
import { shouldPollInside } from '../directory-watch-filter';
import type { PollingOptions } from './polling-tree-watcher';

/**
 * Holds the error code each path fails with, as a share that stops answering would.
 */
const faults: { readonly byPath: Map<string, string> } = vi.hoisted(() => ({
  byPath: new Map<string, string>(),
}));

/**
 * Fails a call on a faulted path with its code.
 * @param target The path asked about.
 */
function failIfFaulted(target: fs.PathLike): void {
  const code: string | undefined = faults.byPath.get(String(target));
  if (code !== undefined) {
    throw Object.assign(new Error(`${code}: ${String(target)}`), { code });
  }
}

vi.mock('node:fs', async (importOriginal: () => Promise<typeof fs>) => {
  const real: typeof fs = await importOriginal();
  const promises: typeof fs.promises = Object.assign({}, real.promises, {
    readdir: async (target: fs.PathLike, options: never): Promise<never> => {
      failIfFaulted(target);
      return (await real.promises.readdir(target, options)) as never;
    },
    lstat: async (target: fs.PathLike): Promise<fs.Stats> => {
      failIfFaulted(target);
      return await real.promises.lstat(target);
    },
    stat: async (target: fs.PathLike): Promise<fs.Stats> => {
      failIfFaulted(target);
      return await real.promises.stat(target);
    },
  });
  return Object.assign({}, real, { promises, default: Object.assign({}, real, { promises }) });
});

const { MAX_ROOT_FAILURES, PollingTreeWatcher } = await import('./polling-tree-watcher');

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
  let watcher: InstanceType<typeof PollingTreeWatcher> | undefined;
  let reported: Reported[];
  let errors: Error[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-poll-'));
    reported = [];
    errors = [];
    watcher = undefined;
    faults.byPath.clear();
  });

  afterEach(() => {
    watcher?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Starts polling the temp root.
   * @param recursive Whether everything beneath it is polled.
   */
  function start(recursive: boolean = true, overrides: Partial<PollingOptions> = {}): void {
    watcher = new PollingTreeWatcher(
      root,
      {
        intervalMs: INTERVAL_MS,
        recursive,
        descend: (relative: string): boolean => shouldPollInside(relative),
        ...overrides,
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

  it.each([['EIO'], ['ETIMEDOUT'], ['ESTALE'], ['EHOSTDOWN']])(
    'keepsWatching_throughATransientRootFailure %s',
    async (code: string) => {
      writeFileSync(path.join(root, 'kept.txt'), 'x');
      start();
      await settle();

      faults.byPath.set(root, code);
      // A blip of two polls: fewer than the failures it takes to give up.
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, INTERVAL_MS * 2.5);
      });
      faults.byPath.clear();
      writeFileSync(path.join(root, 'after.txt'), 'x');
      await settle();

      expect(errors).toEqual([]);
      expect(reported).toEqual([{ eventType: 'rename', filename: 'after.txt' }]);
    },
  );

  it('givesUp_afterTheRootFailsPollAfterPoll', async () => {
    start();
    await settle();

    faults.byPath.set(root, 'ETIMEDOUT');
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, INTERVAL_MS * (MAX_ROOT_FAILURES + 3));
    });

    expect(errors).toHaveLength(1);
    expect(reported).toEqual([]);
  });

  it('givesUp_atOnce_whenTheRootIsGone', async () => {
    start();
    await settle();

    faults.byPath.set(root, 'ENOENT');
    await settle();

    expect(errors).toHaveLength(1);
  });

  it('keepsAnUnreadableFolder_asItWas_ratherThanReportingItEmptied', async () => {
    mkdirSync(path.join(root, 'site'));
    writeFileSync(path.join(root, 'site', 'a.html'), 'x');
    writeFileSync(path.join(root, 'site', 'b.html'), 'x');
    start();
    await settle();

    faults.byPath.set(path.join(root, 'site'), 'EIO');
    await settle();
    faults.byPath.clear();
    await settle();

    expect(reported).toEqual([]);
  });

  it('keepsAnEntryThatCannotBeExamined_asItWas', async () => {
    writeFileSync(path.join(root, 'a.cs'), 'x');
    start();
    await settle();

    faults.byPath.set(path.join(root, 'a.cs'), 'EACCES');
    await settle();
    faults.byPath.clear();
    await settle();

    expect(reported).toEqual([]);
  });

  it('reportsAFolderThatCannotBeReadBecauseItIsGone', async () => {
    mkdirSync(path.join(root, 'site'));
    writeFileSync(path.join(root, 'site', 'a.html'), 'x');
    start();
    await settle();

    rmSync(path.join(root, 'site'), { recursive: true });
    await settle();

    expect(paths('rename').sort()).toEqual(['site', path.join('site', 'a.html')].sort());
  });

  it('reportsASameSizeRewrite_evenWithinTheTimestampGranularity', async () => {
    const file: string = path.join(root, 'a.css');
    writeFileSync(file, 'aaaa');
    const { mtime }: fs.Stats = fs.statSync(file);
    start();
    await settle();

    // Replace it with another file of the same size and the same modification time.
    writeFileSync(path.join(root, 'next.tmp'), 'bbbb');
    utimesSync(path.join(root, 'next.tmp'), mtime, mtime);
    reported.length = 0;
    fs.renameSync(path.join(root, 'next.tmp'), file);
    await settle();

    expect(paths('change')).toContain('a.css');
  });

  it('readsAFolderOnlyWhereDescentAllows_andReportsNothingForItComingIntoView', async () => {
    let readObj: boolean = false;
    mkdirSync(path.join(root, 'obj'));
    writeFileSync(path.join(root, 'obj', 'project.assets.json'), '{}');
    start(true, { descend: (relative: string): boolean => relative !== 'obj' || readObj });
    await settle();

    readObj = true;
    await settle();
    writeFileSync(path.join(root, 'obj', 'project.assets.json'), '{"restored": true}');
    await settle();

    expect(reported).toEqual([
      { eventType: 'change', filename: path.join('obj', 'project.assets.json') },
    ]);
  });

  it('looksOnlyAtTheNamedFiles_whenGivenSome', async () => {
    writeFileSync(path.join(root, 'open.ts'), 'x');
    start(false, { files: (): readonly string[] => ['open.ts'] });
    await settle();

    writeFileSync(path.join(root, 'other.ts'), 'x');
    writeFileSync(path.join(root, 'open.ts'), 'changed');
    await settle();

    expect(reported).toEqual([{ eventType: 'change', filename: 'open.ts' }]);
  });
});
