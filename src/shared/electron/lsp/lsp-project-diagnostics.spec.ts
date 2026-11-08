import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: (): string => '/tmp' } }));

const { ProjectDiagnosticsCheck } = await import('./lsp-project-diagnostics');

/**
 * One command the fake server was sent.
 */
interface SentCommand {
  readonly command: string;
  readonly arguments: readonly unknown[];
}

describe('ProjectDiagnosticsCheck (#1207)', () => {
  const APP: string = 'file:///w/packages/app/src/main.ts';
  const APP_TOO: string = 'file:///w/packages/app/src/other.ts';
  const SHAPES: string = 'file:///w/packages/shapes/src/shapes.ts';
  const LOOSE: string = 'file:///w/scratch.js';

  /**
   * The configuration tsserver says each fixture file's project has, as `projectInfo` answers.
   */
  const CONFIGS: Readonly<Record<string, string>> = {
    [APP]: '/w/packages/app/tsconfig.json',
    [APP_TOO]: '/w/packages/app/tsconfig.json',
    [SHAPES]: '/w/packages/shapes/tsconfig.json',
    [LOOSE]: '/dev/null/inferredProject1*',
  };

  let sent: SentCommand[];
  let open: string[];
  let held: (() => void) | null;

  /**
   * Builds a check over a fake server that answers `projectInfo` from {@link CONFIGS}, and holds a
   * `geterrForProject` until the test lets it go when `hold` is set.
   * @param hold Whether to hold the first project check.
   * @returns Returns the check.
   */
  function check(hold: boolean = false): InstanceType<typeof ProjectDiagnosticsCheck> {
    return new ProjectDiagnosticsCheck(
      {
        sendRequest: (_method: string, params: unknown): Promise<unknown> => {
          const command: SentCommand = params as SentCommand;
          sent.push(command);
          const [request, args] = command.arguments as [string, { file: string }];
          if (request === 'projectInfo') {
            return Promise.resolve({ body: { configFileName: CONFIGS[args.file] } });
          }
          if (hold && held === null) {
            return new Promise<unknown>((resolve: (value: unknown) => void): void => {
              held = (): void => resolve(null);
            });
          }
          return Promise.resolve(null);
        },
      },
      (): readonly string[] => open,
      '/w::typescript',
    );
  }

  /**
   * Lists the files each project check was sent.
   * @returns Returns the files, in order.
   */
  function checked(): string[] {
    return sent
      .filter((command: SentCommand): boolean => command.arguments[0] === 'geterrForProject')
      .map((command: SentCommand): string => (command.arguments[1] as { file: string }).file);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    open = [APP, APP_TOO, SHAPES, LOOSE];
    held = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checksEachProjectOnce_throughTheServersTsserverCommand', async () => {
    check().schedule();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checked()).toEqual([APP, SHAPES]);
    expect(sent.at(-1)).toEqual({
      command: 'typescript.tsserverRequest',
      arguments: [
        'geterrForProject',
        { file: SHAPES, delay: 0 },
        { isAsync: true, lowPriority: true },
      ],
    });
  });

  it('leavesInferredProjectsOut_asTheirFilesAreTheOpenOnes', async () => {
    open = [LOOSE];
    check().schedule();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checked()).toEqual([]);
  });

  it('waitsForQuiet_soABurstOfOpensAndSavesAsksOnce', async () => {
    const subject: InstanceType<typeof ProjectDiagnosticsCheck> = check();
    subject.schedule();
    await vi.advanceTimersByTimeAsync(600);
    subject.schedule();
    await vi.advanceTimersByTimeAsync(600);

    expect(checked()).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    expect(checked()).toEqual([APP, SHAPES]);
  });

  it('runsAgainAfterACheckAskedForWhileOneRan_neverAlongsideIt', async () => {
    const subject: InstanceType<typeof ProjectDiagnosticsCheck> = check(true);
    subject.schedule();
    await vi.advanceTimersByTimeAsync(1_000);
    subject.schedule();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checked()).toEqual([APP]);

    held?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(checked()).toEqual([APP, SHAPES]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(checked()).toEqual([APP, SHAPES, APP, SHAPES]);
  });

  it('sendsNothingOnceStopped', async () => {
    const subject: InstanceType<typeof ProjectDiagnosticsCheck> = check();
    subject.schedule();
    subject.stop();
    subject.schedule();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sent).toEqual([]);
  });

  it('survivesAServerThatFails', async () => {
    const subject: InstanceType<typeof ProjectDiagnosticsCheck> = new ProjectDiagnosticsCheck(
      { sendRequest: (): Promise<unknown> => Promise.reject(new Error('gone')) },
      (): readonly string[] => open,
      '/w::typescript',
    );
    subject.schedule();

    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
  });
});
