import { Service } from '@angular/core';

/**
 * Says how a test is to be run: plainly, or under the debugger.
 */
export type TestRunMode = 'run' | 'debug';

/**
 * Describes a test a source location declares, as a workspace's Tests panel found it.
 */
export interface TestAtLocation {
  /**
   * Gets the test-adapter plugin that found it.
   */
  readonly pluginId: string;

  /**
   * Gets its node identifier, opaque outside its plugin.
   */
  readonly id: string;

  /**
   * Gets what the Tests panel calls it.
   */
  readonly label: string;

  /**
   * Gets whether it is one test, or a suite or file standing for the tests beneath it.
   */
  readonly kind: 'test' | 'suite' | 'file' | 'project';

  /**
   * Gets whether its adapter can debug it: a single test whose plugin confirmed `debug`.
   */
  readonly debuggable: boolean;
}

/**
 * What a workspace tab registers so tests in its folder can be run from elsewhere (#1352).
 */
export interface TestRunHandler {
  /**
   * Gets the absolute folder the handler's workspace has open, or null when none.
   * @returns Returns the folder.
   */
  root(): string | null;

  /**
   * Finds the test a source line declares.
   * @param path The file's absolute path.
   * @param line The 1-based line.
   * @returns Returns the test, or null when the line declares none the panel knows.
   */
  testAt(path: string, line: number): TestAtLocation | null;

  /**
   * Runs or debugs a test the handler found.
   * @param test The test, as {@link testAt} answered.
   * @param mode How to run it.
   * @returns Returns a promise resolving true once the run or debug session started.
   */
  run(test: TestAtLocation, mode: TestRunMode): Promise<boolean>;
}

/**
 * The application's run/debug-a-test entry point (#1352): the seam a code lens, a gutter action or a
 * command routes through to run the test under the caret, without knowing which workspace, framework or
 * plugin it belongs to.
 *
 * Each workspace tab registers its Tests panel's handler for as long as it is open. A request goes to
 * the handler whose folder holds the file, so two open workspaces never run each other's tests. Every
 * run goes through the test-adapter slot (#1351) and shows in the workspace's Tests terminal and
 * panel; a debug goes through the workspace's debugger.
 *
 * ```ts
 * const tests: TestRuns = inject(TestRuns);
 * const test: TestAtLocation | null = tests.testAt(path, line);
 * if (test !== null) {
 *   void tests.run(test, 'run'); // or 'debug', when test.debuggable
 * }
 * ```
 */
@Service()
export class TestRuns {
  /**
   * Holds the registered handlers, one per open workspace tab.
   */
  private readonly handlers: Set<TestRunHandler> = new Set<TestRunHandler>();

  /**
   * Registers a workspace tab's handler.
   * @param handler The handler.
   * @returns Returns the function that unregisters it.
   */
  public register(handler: TestRunHandler): () => void {
    this.handlers.add(handler);
    return (): void => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Finds the test a source line declares, in whichever open workspace holds the file. Cheap and
   * synchronous, so a code-lens provider can ask it for every lens it is about to show.
   * @param path The file's absolute path.
   * @param line The 1-based line.
   * @returns Returns the test, or null when no open workspace knows one there.
   */
  public testAt(path: string, line: number): TestAtLocation | null {
    return this.handlerFor(path)?.testAt(path, line) ?? null;
  }

  /**
   * Runs or debugs a test {@link testAt} found.
   * @param path The file's absolute path, which picks the workspace.
   * @param test The test.
   * @param mode How to run it.
   * @returns Returns a promise resolving true once the run or debug session started; false when no
   * open workspace holds the file, or it could not start.
   */
  public run(path: string, test: TestAtLocation, mode: TestRunMode): Promise<boolean> {
    const handler: TestRunHandler | undefined = this.handlerFor(path);
    return handler === undefined ? Promise.resolve(false) : handler.run(test, mode);
  }

  /**
   * Runs or debugs the test a source line declares — {@link testAt} and {@link run} in one.
   * @param path The file's absolute path.
   * @param line The 1-based line.
   * @param mode How to run it.
   * @returns Returns a promise resolving true once it started; false when the line declares no test.
   */
  public runAt(path: string, line: number, mode: TestRunMode): Promise<boolean> {
    const test: TestAtLocation | null = this.testAt(path, line);
    return test === null ? Promise.resolve(false) : this.run(path, test, mode);
  }

  /**
   * Finds the handler whose folder holds a file: the deepest, when one workspace is inside another.
   * @param path The file's absolute path.
   * @returns Returns the handler, or undefined when none holds it.
   */
  private handlerFor(path: string): TestRunHandler | undefined {
    let best: TestRunHandler | undefined;
    let bestLength: number = -1;
    for (const handler of this.handlers) {
      const root: string | null = handler.root();
      if (root === null) {
        continue;
      }
      const inside: boolean =
        path === root ||
        path.startsWith(root.endsWith('/') ? root : `${root}/`) ||
        path.startsWith(root.endsWith('\\') ? root : `${root}\\`);
      if (inside && root.length > bestLength) {
        best = handler;
        bestLength = root.length;
      }
    }
    return best;
  }
}
