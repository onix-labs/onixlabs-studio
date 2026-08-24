import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { createTwoFilesPatch } from 'diff';
import { AiEvent, AiProviderInfo } from '@shared/api/ai-types';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { FileDiff } from '../source-control/source-control-provider';
import { GitFileChange } from './repository-data';
import { Repository } from './repository';

/**
 * The largest unified-diff excerpt included per file, so one big file cannot crowd out the rest.
 */
const PATCH_CHAR_BUDGET: number = 4_000;

/**
 * The largest total prompt payload of diff content, keeping the request comfortably inside a model's
 * context whatever the working tree looks like.
 */
const TOTAL_CHAR_BUDGET: number = 24_000;

/**
 * The most files whose diffs are inlined; the rest are named in the file list only.
 */
const MAX_DIFFED_FILES: number = 12;

/**
 * How long a generation may run before it is aborted and treated as failed.
 */
const GENERATE_TIMEOUT_MS: number = 90_000;

/**
 * Generates a draft commit message from the files selected in the commit panel, using the first
 * available AI provider in read-only chat mode. The prompt carries the file list and truncated
 * unified diffs (computed locally from the provider's diff sides), so the model needs no tools; any
 * tool-permission request raised anyway is denied so the run can never block on the user. Outside
 * Electron, or with no provider available, generation resolves null and the affordance disables.
 */
@Service()
export class CommitMessageGenerator {
  /**
   * Holds the agent runtime the generation runs through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the settings service, the source of the user's connections the providers are built from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the repository supplying the selected files' diff content.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds a value indicating whether a generation is currently running.
   */
  private readonly generatingSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether a generation is currently running.
   */
  public readonly generating: Signal<boolean> = this.generatingSignal.asReadonly();

  /**
   * Gets a value indicating whether an agent bridge exists at all (i.e. running in Electron).
   * Provider availability is checked per generation, since credentials can change at runtime.
   */
  public readonly isAvailable: boolean = this.runtime.isAvailable;

  /**
   * Generates a commit message for the given files, or resolves null when generation is unavailable,
   * already running, given nothing to describe, or fails.
   * @param files The changed files the commit will contain.
   * @returns Returns the generated message, or null.
   */
  public async generate(files: readonly GitFileChange[]): Promise<string | null> {
    if (!this.runtime.isAvailable || this.generatingSignal() || files.length === 0) {
      return null;
    }
    this.generatingSignal.set(true);
    this.log.info(
      'CommitMessageGenerator',
      `Generating commit message for ${files.length} file(s)`,
    );
    try {
      const providers: readonly AiProviderInfo[] = await this.runtime.listProviders(
        this.settings.aiConnections(),
      );
      const provider: AiProviderInfo | undefined = providers.find(
        (candidate: AiProviderInfo): boolean => candidate.available,
      );
      if (provider === undefined) {
        this.log.warn('CommitMessageGenerator', 'No available AI provider; generation skipped');
        return null;
      }
      this.log.debug('CommitMessageGenerator', `Using provider '${provider.id}'`);
      const prompt: string = await this.buildPrompt(files);
      const message: string | null = await this.runOnce(provider.id, prompt);
      this.log.info(
        'CommitMessageGenerator',
        message === null ? 'Generation produced no message' : 'Generated commit message',
      );
      return message;
    } finally {
      this.generatingSignal.set(false);
    }
  }

  /**
   * Builds the generation prompt: the instruction, the file list with statuses, and truncated unified
   * diffs for the first files within the character budgets.
   * @param files The changed files the commit will contain.
   * @returns Returns the prompt.
   */
  private async buildPrompt(files: readonly GitFileChange[]): Promise<string> {
    const listing: string = files
      .map(
        (file: GitFileChange): string =>
          `${file.untracked === true ? 'new (untracked)' : file.status} ${file.path}`,
      )
      .join('\n');
    const patches: string[] = [];
    let spent: number = 0;
    for (const file of files.slice(0, MAX_DIFFED_FILES)) {
      if (spent >= TOTAL_CHAR_BUDGET) {
        break;
      }
      const diff: FileDiff = await this.repository.loadDiff(file);
      const patch: string = createTwoFilesPatch(
        file.previousPath ?? file.path,
        file.path,
        diff.original,
        diff.modified,
      );
      const excerpt: string =
        patch.length > PATCH_CHAR_BUDGET
          ? `${patch.slice(0, PATCH_CHAR_BUDGET)}\n… (diff truncated)`
          : patch;
      patches.push(excerpt);
      spent += excerpt.length;
    }
    return [
      'Write a git commit message for the following changes.',
      'Reply with ONLY the commit message: an imperative summary line of at most 72 characters,',
      'optionally followed by a blank line and a short body. No markdown, no code fences, no quotes.',
      '',
      'Changed files:',
      listing,
      '',
      'Diffs:',
      patches.join('\n'),
    ].join('\n');
  }

  /**
   * Runs one unattended generation turn: collects the streamed text, denies any tool-permission
   * request, and settles on the run's terminal status (or a timeout, which aborts the run).
   * @param providerId The provider to run through.
   * @param prompt The generation prompt.
   * @returns Returns the cleaned message, or null when the run failed, was aborted, or timed out.
   */
  private runOnce(providerId: AiProviderInfo['id'], prompt: string): Promise<string | null> {
    return new Promise<string | null>((resolve: (message: string | null) => void): void => {
      let text: string = '';
      let dispose: () => void = (): void => undefined;
      const finish: (message: string | null) => void = (message: string | null): void => {
        clearTimeout(timer);
        dispose();
        resolve(message);
      };
      const requestId: string = this.runtime.run(providerId, prompt, { mode: 'chat' });
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        this.log.warn('CommitMessageGenerator', 'Generation timed out; aborting run');
        this.runtime.abort(requestId);
        finish(null);
      }, GENERATE_TIMEOUT_MS);
      dispose = this.runtime.onEvent((event: AiEvent): void => {
        if (event.requestId !== requestId) {
          return;
        }
        if (event.kind === 'text') {
          text += event.delta;
          return;
        }
        // Deny gated tools: the diff is inline, so the model needs none, and an unattended run must
        // never sit waiting on a permission prompt.
        if (event.kind === 'permission') {
          this.runtime.respondPermission(event.permissionId, false);
          return;
        }
        if (event.kind === 'status' && event.state !== 'started') {
          this.log.debug('CommitMessageGenerator', `Generation ended '${event.state}'`);
          finish(event.state === 'completed' ? this.clean(text) : null);
        }
      });
    });
  }

  /**
   * Cleans a model reply into a usable commit message: trims whitespace, strips a surrounding code
   * fence or quote pair, and rejects an empty result.
   * @param text The raw reply text.
   * @returns Returns the cleaned message, or null when empty.
   */
  private clean(text: string): string | null {
    let message: string = text.trim();
    const fence: RegExpExecArray | null = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(message);
    if (fence !== null) {
      message = fence[1].trim();
    }
    if (
      (message.startsWith('"') && message.endsWith('"')) ||
      (message.startsWith("'") && message.endsWith("'"))
    ) {
      message = message.slice(1, -1).trim();
    }
    return message.length === 0 ? null : message;
  }
}
