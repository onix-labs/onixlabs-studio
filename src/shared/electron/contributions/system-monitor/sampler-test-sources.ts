import { GpuSources } from './gpu-sampler';

/**
 * Describes a fake machine for a sampler's tests: its sources, a way to move its clock on, and the
 * commands run on it.
 */
export interface FakeMachine {
  /**
   * Gets what the sampler reads the machine through.
   */
  readonly sources: GpuSources;

  /**
   * Moves the machine's clock on.
   * @param ms The time to move it on by, in milliseconds.
   */
  readonly advance: (ms: number) => void;

  /**
   * Gets the commands run, in order.
   */
  readonly calls: string[];
}

/**
 * Builds a fake machine whose commands answer, in turn, with the outputs given for them (failing once
 * those run out), whose files and folders hold what is given, and whose clock moves only when told.
 * @param platform The platform.
 * @param outputs Each command's outputs, in the order it answers with them.
 * @param files Each file's content, by path.
 * @param folders Each folder's entries, by path.
 * @returns Returns the machine.
 */
export function fakeMachine(
  platform: string,
  outputs: Record<string, string[]>,
  files: Record<string, string> = {},
  folders: Record<string, string[]> = {},
): FakeMachine {
  let now: number = 1_000_000;
  const calls: string[] = [];
  return {
    calls,
    advance: (ms: number): void => {
      now += ms;
    },
    sources: {
      platform,
      run: (file: string): Promise<string> => {
        calls.push(file);
        const next: string | undefined = outputs[file]?.shift();
        return next === undefined ? Promise.reject(new Error(`no ${file}`)) : Promise.resolve(next);
      },
      readFile: (path: string): Promise<string> =>
        path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(path)),
      readdir: (path: string): Promise<readonly string[]> =>
        path in folders ? Promise.resolve(folders[path]) : Promise.reject(new Error(path)),
      now: (): number => now,
    },
  };
}
