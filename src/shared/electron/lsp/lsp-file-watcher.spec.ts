import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileChangeType, FileEvent, LspFileWatcher } from './lsp-file-watcher';
import { globToRegExp } from './lsp-watch-glob';

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
    watcher?.setPatterns([globToRegExp('**/*.rs')]);
    await settle();
    writeFileSync(path.join(root, 'main.rs'), 'x');
    writeFileSync(path.join(root, 'notes.txt'), 'x');
    await settle();

    const uris: string[] = events().map((event: FileEvent): string => event.uri);
    expect(uris.some((uri: string): boolean => uri.endsWith('/main.rs'))).toBe(true);
    expect(uris.some((uri: string): boolean => uri.endsWith('/notes.txt'))).toBe(false);
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
