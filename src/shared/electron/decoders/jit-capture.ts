import { execFile, ExecFileException } from 'node:child_process';
import { CodeListing, ListingRow, ListingSection } from '@shared/api/code-listing';
import { JitCaptureResult, JitTier } from '@shared/api/jit-capture';
import { logger } from '../logger';

/**
 * Specifies how long a captured program may run before it is stopped.
 *
 * JIT assembly is only produced by *running* the program, so a program that never exits would never
 * produce a listing. Stopping it is reported rather than hidden: what came out before the stop is
 * still shown, and the listing says the run was cut short, because silently truncating would look
 * like the JIT simply compiled less than it did.
 */
const RUN_TIMEOUT_MS: number = 20_000;

/**
 * Specifies the largest output that will be captured, bounding a program that floods stdout.
 */
const MAX_OUTPUT_BYTES: number = 32 * 1024 * 1024;

/**
 * Runs a .NET assembly with JIT disassembly enabled and turns what it printed into a listing.
 *
 * Verified against a stock .NET SDK — no checked runtime is needed, which is what makes this shippable
 * at all rather than a developer-only trick.
 */
export class JitCapture {
  /**
   * Captures JIT assembly for the methods matching a pattern.
   * @param assemblyPath The assembly to run.
   * @param methodPattern The `DOTNET_JitDisasm` pattern, such as `*` or a method name.
   * @param tier The optimisation tier to ask for.
   * @returns Returns the listing, or the reason the run produced none.
   */
  public async capture(
    assemblyPath: string,
    methodPattern: string,
    tier: JitTier,
  ): Promise<JitCaptureResult> {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ['DOTNET_JitDisasm']: methodPattern,
      // Diffable output drops the addresses that change between runs, so the same code reads the same
      // way twice — which matters when the point is comparing what you changed.
      ['DOTNET_JitDisasmDiffable']: '1',
    };
    if (tier === 'full-opts') {
      environment['DOTNET_TieredCompilation'] = '0';
    }

    const command: string = `DOTNET_JitDisasm=${methodPattern}${
      tier === 'full-opts' ? ' DOTNET_TieredCompilation=0' : ''
    } dotnet ${assemblyPath}`;
    logger.debug('JitCapture', `Running ${command}`);

    const outcome: { stdout: string; stopped: boolean; error: string | null } = await this.run(
      assemblyPath,
      environment,
    );
    if (outcome.error !== null) {
      return { ok: false, error: outcome.error };
    }

    const listing: CodeListing = parseJitDisasm(outcome.stdout, command, tier);
    if (listing.sections.length === 0) {
      return {
        ok: false,
        error: outcome.stopped
          ? 'The program was still running after 20 seconds and printed no JIT output. JIT assembly needs a program that reaches the method and exits.'
          : `The program ran but the JIT compiled nothing matching '${methodPattern}'. A method is only compiled when it is actually called.`,
      };
    }
    return { ok: true, listing, stopped: outcome.stopped };
  }

  /**
   * Runs the assembly, capturing stdout and reporting whether it had to be stopped.
   * @param assemblyPath The assembly to run.
   * @param environment The environment to run it under.
   * @returns Returns the captured output and how the run ended.
   */
  private run(
    assemblyPath: string,
    environment: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stopped: boolean; error: string | null }> {
    return new Promise((resolve): void => {
      execFile(
        'dotnet',
        [assemblyPath],
        {
          encoding: 'utf8' as const,
          env: environment,
          timeout: RUN_TIMEOUT_MS,
          killSignal: 'SIGKILL' as const,
          maxBuffer: MAX_OUTPUT_BYTES,
        },
        (error: ExecFileException | null, stdout: string): void => {
          if (error === null) {
            resolve({ stdout, stopped: false, error: null });
            return;
          }
          // A killed run still printed everything the JIT emitted before the kill, so its output is
          // kept rather than discarded along with the error.
          if (error.killed === true) {
            resolve({ stdout, stopped: true, error: null });
            return;
          }
          if (error.code === 'ENOENT') {
            resolve({
              stdout: '',
              stopped: false,
              error: 'The .NET SDK could not be found on this machine.',
            });
            return;
          }
          // A non-zero exit is not a failure to capture: a program that threw still had its methods
          // compiled, and that output is what was asked for.
          resolve({ stdout, stopped: false, error: null });
        },
      );
    });
  }
}

/**
 * Parses JIT disassembly output into a listing.
 *
 * The format is one block per compiled method, opened by an `; Assembly listing for method …` line and
 * closed by `; Total bytes of code …`.
 *
 * The JIT reports an offset per instruction *group*, never per instruction, so group labels carry
 * addresses and instruction rows carry none. That is why the listing contract makes a row's address
 * optional: inventing one here would be the only alternative.
 * @param text The captured output.
 * @param command The command that produced it, for the listing's origin.
 * @param tier The tier that was asked for.
 * @returns Returns the listing.
 */
export function parseJitDisasm(text: string, command: string, tier: JitTier): CodeListing {
  const sections: ListingSection[] = [];
  let current: { title: string; notes: string[]; rows: ListingRow[] } | null = null;

  const flush: () => void = (): void => {
    if (current !== null && current.rows.length > 0) {
      sections.push({
        id: current.title,
        title: current.title,
        notes: current.notes,
        rows: current.rows,
      });
    }
    current = null;
  };

  for (const line of text.split('\n')) {
    const header: RegExpMatchArray | null =
      /^; Assembly listing for method (.+?)\s*\(([^)]+)\)\s*$/.exec(line);
    if (header !== null) {
      flush();
      current = { title: header[1], notes: [`tier: ${header[2]}`], rows: [] };
      continue;
    }
    if (current === null) {
      continue;
    }

    const total: RegExpMatchArray | null = /^; Total bytes of code (\d+)/.exec(line);
    if (total !== null) {
      current.notes.push(`total code size: ${total[1]} bytes`);
      flush();
      continue;
    }

    const comment: RegExpMatchArray | null = /^; (.+)$/.exec(line);
    if (comment !== null) {
      if (current.rows.length === 0) {
        current.notes.push(comment[1]);
      }
      continue;
    }

    const label: RegExpMatchArray | null = /^(G_M\w+):\s*(?:;; offset=0x([0-9A-Fa-f]+))?/.exec(
      line,
    );
    if (label !== null) {
      current.rows.push({
        kind: 'label',
        address: label[2] === undefined ? undefined : Number.parseInt(label[2], 16),
        mnemonic: label[1],
        operands: '',
      });
      continue;
    }

    const instruction: RegExpMatchArray | null = /^\s{2,}(\S+)\s*(.*?)\s*$/.exec(line);
    if (instruction !== null) {
      current.rows.push({
        kind: 'instruction',
        mnemonic: instruction[1],
        operands: instruction[2],
      });
    }
  }
  flush();

  return {
    language: 'JIT-generated assembly',
    addressing: 'runtime-address',
    origin: { kind: 'process', command, tier: tier === 'full-opts' ? 'FullOpts' : 'Tier0' },
    sections,
  };
}
