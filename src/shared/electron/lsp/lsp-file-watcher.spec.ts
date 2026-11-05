import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileChangeType, FileEvent, LspFileWatcher, MAX_PENDING_PATHS } from './lsp-file-watcher';

/**
 * The private steps driven directly, since a storm of native events cannot be produced on demand.
 */
interface WatcherInternals {
  onEvent(eventType: string, filename: string): void;
  flush(): Promise<void>;
}

/**
 * Waits long enough for a coalescing window (and the platform watcher's own latency) to pass.
 * @returns Returns a promise that resolves after the wait.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 600);
  });
}

describe('LspFileWatcher', () => {
  let root: string;
  let watcher: LspFileWatcher | null;
  let batches: (readonly FileEvent[])[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-lsp-watch-'));
    batches = [];
    watcher = null;
  });

  afterEach(() => {
    watcher?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Starts a watcher on the temp root, collecting every batch.
   */
  function start(): void {
    watcher = new LspFileWatcher(root, (events: readonly FileEvent[]): void => {
      batches.push(events);
    });
  }

  /**
   * Flattens the collected batches.
   * @returns Returns every event delivered so far.
   */
  function events(): FileEvent[] {
    return batches.flat();
  }

  it('reportsACreatedFile_asCreated_withItsFileUri', async () => {
    start();
    await settle();
    writeFileSync(path.join(root, 'a.ts'), 'x');
    await settle();

    const created: FileEvent | undefined = events().find(
      (event: FileEvent): boolean => event.uri === pathToFileURL(path.join(root, 'a.ts')).href,
    );
    expect(created).toBeDefined();
    expect(created?.type).toBe(FileChangeType.Created);
  });

  it('reportsADeletedFile_asDeleted', async () => {
    const file: string = path.join(root, 'gone.ts');
    writeFileSync(file, 'x');
    start();
    await settle();
    rmSync(file);
    await settle();

    // FSEvents may still deliver the pre-watch write (as a Created) before the delete lands; the
    // last word on the file is what matters.
    const forFile: FileEvent[] = events().filter(
      (event: FileEvent): boolean => event.uri === pathToFileURL(file).href,
    );
    expect(forFile.at(-1)?.type).toBe(FileChangeType.Deleted);
  });

  it('dropsDependencyChurn_theSameWayTheExplorersDo', async () => {
    // `npm install` writes thousands of files under node_modules; a server told about each would
    // re-evaluate its project model thousands of times. The same choke point the explorers use.
    mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    start();
    await settle();
    writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    await settle();

    expect(
      events().some((event: FileEvent): boolean => event.uri.includes('node_modules/pkg/index.js')),
    ).toBe(false);
  });

  it('honoursRegisteredPatterns_reportingOnlyMatches', async () => {
    start();
    watcher?.register('r1', [{ globPattern: '**/*.rs' }]);
    await settle();
    writeFileSync(path.join(root, 'main.rs'), 'x');
    writeFileSync(path.join(root, 'notes.txt'), 'x');
    await settle();

    const uris: string[] = events().map((event: FileEvent): string => event.uri);
    expect(uris.some((uri: string): boolean => uri.endsWith('/main.rs'))).toBe(true);
    expect(uris.some((uri: string): boolean => uri.endsWith('/notes.txt'))).toBe(false);
  });

  it('reportsTheUnionOfRegistrations_eachRelativeToItsOwnBaseFolder (#1170)', async () => {
    // Roslyn's shape: one registration per project, each a pattern relative to that project.
    mkdirSync(path.join(root, 'Core'), { recursive: true });
    mkdirSync(path.join(root, 'Tests'), { recursive: true });
    start();
    watcher?.register('core-cs', [
      { globPattern: { baseUri: pathToFileURL(path.join(root, 'Core')).href, pattern: '**/*.cs' } },
    ]);
    watcher?.register('tests-proj', [
      {
        globPattern: {
          baseUri: pathToFileURL(path.join(root, 'Tests')).href,
          pattern: 'Tests.csproj',
        },
      },
    ]);
    await settle();
    writeFileSync(path.join(root, 'Core', 'A.cs'), 'x');
    writeFileSync(path.join(root, 'Tests', 'Tests.csproj'), 'x');
    writeFileSync(path.join(root, 'Tests', 'B.cs'), 'x');
    await settle();

    const uris: string[] = events().map((event: FileEvent): string => event.uri);
    expect(uris.some((uri: string): boolean => uri.endsWith('/Core/A.cs'))).toBe(true);
    expect(uris.some((uri: string): boolean => uri.endsWith('/Tests/Tests.csproj'))).toBe(true);
    // Neither registration asked for source files under Tests.
    expect(uris.some((uri: string): boolean => uri.endsWith('/Tests/B.cs'))).toBe(false);
  });

  /**
   * Reaches the watcher's private steps.
   * @returns Returns them.
   */
  function internals(): WatcherInternals {
    return watcher as unknown as WatcherInternals;
  }

  it('flush_acrossManyBatches_classifiesEachPathAndKeepsTheirOrder', async () => {
    start();
    writeFileSync(path.join(root, 'entry-0.ts'), 'x');
    writeFileSync(path.join(root, 'entry-600.ts'), 'x');
    for (let index: number = 0; index <= 600; index += 1) {
      internals().onEvent('rename', `entry-${index}.ts`);
    }

    await internals().flush();

    expect(events()).toHaveLength(601);
    expect(events()[0]).toMatchObject({ type: FileChangeType.Created });
    expect(events()[0].uri.endsWith('/entry-0.ts')).toBe(true);
    expect(events()[300]).toMatchObject({ type: FileChangeType.Deleted });
    expect(events()[600]).toMatchObject({ type: FileChangeType.Created });
    expect(events()[600].uri.endsWith('/entry-600.ts')).toBe(true);
  });

  it('flush_doesNotHoldTheEventLoopForTheWholeWindow', async () => {
    start();
    for (let index: number = 0; index < 600; index += 1) {
      internals().onEvent('change', `entry-${index}.ts`);
    }
    let turns: number = 0;
    const counting: NodeJS.Timeout = setInterval((): void => {
      turns += 1;
    }, 0);

    await internals().flush();
    clearInterval(counting);

    expect(events()).toHaveLength(600);
    expect(turns).toBeGreaterThan(0);
  });

  it('close_whileAFlushIsResolving_deliversNothing', async () => {
    start();
    for (let index: number = 0; index < 600; index += 1) {
      internals().onEvent('rename', `entry-${index}.ts`);
    }

    const flushing: Promise<void> = internals().flush();
    watcher?.close();
    await flushing;

    expect(batches).toEqual([]);
  });

  it('eventsArrivingDuringAFlush_goOutInTheNextWindow', async () => {
    start();
    // The native watcher's own first events for the new root are not what is under test.
    await settle();
    batches.length = 0;
    for (let index: number = 0; index < 600; index += 1) {
      internals().onEvent('change', `entry-${index}.ts`);
    }

    const flushing: Promise<void> = internals().flush();
    internals().onEvent('change', 'latecomer.ts');
    await flushing;

    expect(batches).toHaveLength(1);
    await settle();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
    expect(batches[1][0].uri.endsWith('/latecomer.ts')).toBe(true);
  });

  it('onEvent_pastTheCap_dropsNewPaths_butAPathAlreadyHeldStillUpdates', async () => {
    start();
    // The native watcher's own first events for the new root are not what is under test.
    await settle();
    batches.length = 0;
    for (let index: number = 0; index < MAX_PENDING_PATHS; index += 1) {
      internals().onEvent('change', `entry-${index}.ts`);
    }

    internals().onEvent('change', 'one-too-many.ts');
    internals().onEvent('rename', 'entry-0.ts');
    await internals().flush();

    expect(events()).toHaveLength(MAX_PENDING_PATHS);
    expect(
      events().some((event: FileEvent): boolean => event.uri.endsWith('/one-too-many.ts')),
    ).toBe(false);
    // Gone from disk and renamed: resolved at flush, so it did not stay a mere change.
    expect(events()[0]).toMatchObject({ type: FileChangeType.Deleted });
  });

  it('close_stopsDelivering', async () => {
    start();
    await settle();
    watcher?.close();
    writeFileSync(path.join(root, 'late.ts'), 'x');
    await settle();

    expect(events().some((event: FileEvent): boolean => event.uri.endsWith('/late.ts'))).toBe(
      false,
    );
  });
});
