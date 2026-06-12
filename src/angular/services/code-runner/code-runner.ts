import { inject, Service } from '@angular/core';
import { RunApi, TempFileResult } from '../../../shared/studio-api';
import { CodeTerminals } from '../code-terminals/code-terminals';

/**
 * Describes how a given language is executed.
 */
interface LanguageRunner {
  /**
   * Gets the file extension to write the source under.
   */
  readonly extension: string;

  /**
   * Builds the shell command that runs the source file.
   * @param filePath The absolute path of the source file.
   * @returns Returns the command to run.
   */
  buildCommand(filePath: string): string;
}

/**
 * Quotes a path for safe use in a shell command.
 * @param filePath The path to quote.
 * @returns Returns the double-quoted path.
 */
function quote(filePath: string): string {
  return `"${filePath}"`;
}

/**
 * Maps Monaco language identifiers to their runner. A language without an entry cannot be run.
 */
const RUNNERS: Readonly<Record<string, LanguageRunner>> = {
  javascript: { extension: '.js', buildCommand: (p: string): string => `node ${quote(p)}` },
  typescript: { extension: '.ts', buildCommand: (p: string): string => `tsx ${quote(p)}` },
  python: { extension: '.py', buildCommand: (p: string): string => `python3 ${quote(p)}` },
  shell: { extension: '.sh', buildCommand: (p: string): string => `bash ${quote(p)}` },
  csharp: { extension: '.cs', buildCommand: (p: string): string => `dotnet run ${quote(p)}` },
};

/**
 * Runs the active code document by writing it to a temporary file and piping the matching
 * per-language command into the tab's docked terminal.
 */
@Service()
export class CodeRunner {
  /**
   * Holds the docked-terminal panel state the run command is queued into.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Holds the run bridge, or undefined when running outside Electron.
   */
  private readonly api: RunApi | undefined = window.studio?.run;

  /**
   * Returns whether the given language can be run.
   * @param language The Monaco language identifier.
   * @returns Returns true when a runner exists for the language.
   */
  public canRun(language: string): boolean {
    return RUNNERS[language] !== undefined;
  }

  /**
   * Runs the given content for a tab: writes it to a temporary file and queues its run command in the
   * tab's docked terminal. Does nothing when the language has no runner or Electron is unavailable.
   * @param tabId The owning tab identifier.
   * @param language The Monaco language identifier.
   * @param content The source content to run.
   */
  public async run(tabId: string, language: string, content: string): Promise<void> {
    const runner: LanguageRunner | undefined = RUNNERS[language];
    if (runner === undefined || this.api === undefined) {
      return;
    }
    const result: TempFileResult = await this.api.writeTempFile(tabId, runner.extension, content);
    if (!result.success || result.path === undefined) {
      return;
    }
    this.codeTerminals.queueCommand(tabId, runner.buildCommand(result.path));
  }
}
