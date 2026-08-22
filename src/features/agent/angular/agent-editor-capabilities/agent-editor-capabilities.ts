import { inject, Service } from '@angular/core';
import {
  CANCEL_EDIT_PREVIEW,
  COMMIT_EDIT_PREVIEW,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  InsertPlacement,
  PREVIEW_ACTIVE_DOCUMENT_EDIT,
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
} from '@shared/api/ai-types';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Documents, CodeDocument } from '@shared/angular/services/documents/documents';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { RunFileTaskProvider } from '@shared/angular/services/tasks/providers/run-file-task-provider';
import { Task } from '@shared/angular/services/tasks/task';
import { resolveLanguageId } from '@shared/angular/services/monaco/monaco-languages';
import { AgentEditPreview } from '../agent-edit-preview/agent-edit-preview';
import { EditOutcome, resolveEdit, resolveInsert } from './document-edit';
import { parseRunOutput, RunOutputParse } from './run-output';

/**
 * The prefix the code view derives a tab's run-terminal session id from (mirrors
 * `CodeTerminalPanel`). The run terminal registers with {@link Terminals} under `run-<tabId>`.
 */
const RUN_TERMINAL_PREFIX: string = 'run-';

/**
 * The maximum number of output lines the run capability returns, so a chatty program does not flood
 * the model's context. Only the most recent lines are kept.
 */
const RUN_MAX_OUTPUT_LINES: number = 400;

/**
 * How often (ms) the run capability polls the terminal buffer for the completion sentinel.
 */
const RUN_POLL_INTERVAL_MS: number = 150;

/**
 * The result of running the active document: whether a run started, the command, its exit result, and
 * the captured output. The renderer detects completion and the exit code from a sentinel appended to
 * the command (the run terminal is a persistent shell, so node-pty reports no per-command exit).
 */
interface RunResult {
  /**
   * Gets a value indicating whether the document was runnable and a run was started.
   */
  readonly ran: boolean;

  /**
   * Gets the model-facing reason nothing ran (unrunnable language, no document, etc.).
   */
  readonly detail?: string;

  /**
   * Gets the shell command that was run.
   */
  readonly command?: string;

  /**
   * Gets the program's exit code, or null when it could not be parsed (a non-POSIX shell, or a run
   * that did not finish within the timeout).
   */
  readonly exitCode?: number | null;

  /**
   * Gets a value indicating whether the program exited successfully (exit code 0).
   */
  readonly success?: boolean;

  /**
   * Gets a value indicating whether the run timed out before the sentinel appeared.
   */
  readonly timedOut?: boolean;

  /**
   * Gets the captured terminal output between the command and the completion sentinel.
   */
  readonly output?: string;
}

/**
 * The result of the read-active-document capability.
 */
interface ReadResult {
  /**
   * Gets a value indicating whether a code editor was available to read.
   */
  readonly available: boolean;

  /**
   * Gets the document text (empty when none was available).
   */
  readonly text: string;
}

/**
 * The result of the replace-active-document capability.
 */
interface ReplaceResult {
  /**
   * Gets a value indicating whether the active document was replaced.
   */
  readonly ok: boolean;
}

/**
 * The result of the edit and insert capabilities: whether the change applied, plus a model-facing
 * detail (a confirmation, or the reason it was not applied, phrased so the model can recover).
 */
interface EditResult {
  /**
   * Gets a value indicating whether the change was applied.
   */
  readonly ok: boolean;

  /**
   * Gets the model-facing confirmation or failure reason.
   */
  readonly detail: string;
}

/**
 * The editing surface an edit resolves against: the document's current source plus how to apply a
 * resolved outcome back to it. Markdown applies through a source round-trip (re-parsed by the editor);
 * code applies range edits granularly so Monaco's undo history stays per-edit.
 */
interface EditTarget {
  /**
   * Gets the document's current source text.
   */
  readonly source: string;

  /**
   * Gets which editor backs the target: `code` has a diff editor for previews; `markdown` does not.
   */
  readonly kind: 'code' | 'markdown';

  /**
   * Applies a resolved outcome to the document.
   * @param outcome The successful outcome to apply.
   * @returns Returns true when the document accepted the change.
   */
  apply(outcome: EditOutcome): boolean;
}

/**
 * A staged edit awaiting the user's decision: how to apply it, and whether a diff is showing for it
 * in the document well (code targets only).
 */
interface PendingPreview {
  /**
   * Applies the staged outcome to its document.
   */
  readonly apply: () => boolean;

  /**
   * Gets a value indicating whether the preview opened a diff that must be closed on settle.
   */
  readonly diffShown: boolean;
}

/**
 * The result of the preview capability: the staged preview's id and card copy, or the reason nothing
 * was staged.
 */
interface PreviewResult {
  /**
   * Gets a value indicating whether a preview was staged.
   */
  readonly available: boolean;

  /**
   * Gets the staged preview's identifier (staged previews only).
   */
  readonly previewId?: string;

  /**
   * Gets the display name of the document being edited (staged previews only).
   */
  readonly name?: string;

  /**
   * Gets a one-line summary of the staged change (staged previews only).
   */
  readonly summary?: string;

  /**
   * Gets a value indicating whether the staged change opened a diff in the document well (staged
   * previews only).
   */
  readonly diffShown?: boolean;

  /**
   * Gets the model-facing reason nothing was staged (failed previews only).
   */
  readonly detail?: string;
}

/**
 * Registers the agent's in-app editor capabilities with the {@link AiRuntime} registry: reading and
 * replacing the active code editor's text. The main-process agent providers invoke these by name over
 * the renderer bridge. Instantiated eagerly at start-up (see the app initializer) so the capabilities
 * are available whenever an agent runs.
 */
@Service()
export class AgentEditorCapabilities {
  /**
   * Holds the agent runtime the capabilities register with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the code-editor command seam the capabilities act through.
   */
  private readonly editorCommands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the markdown-editor command seam, consulted first so the agent reads the live markdown
   * document (including unsaved edits) when a markdown editor is active.
   */
  private readonly markdownCommands: MarkdownCommands = inject(MarkdownCommands);

  /**
   * Holds the document store, used to set a code document's language (syntax) and to resolve the
   * document to run.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the run-file task provider, used to write the document to a temp file and build the command
   * that runs it — the same seam the editor's Run action uses.
   */
  private readonly runFiles: RunFileTaskProvider = inject(RunFileTaskProvider);

  /**
   * Holds the docked run-terminal state, used to queue a run command into the code view's terminal.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

  /**
   * Holds the registry that reads a terminal's on-screen output by id, used to capture the run's
   * output and detect completion.
   */
  private readonly terminals: Terminals = inject(Terminals);

  /**
   * Tracks a per-session counter that makes each run's completion sentinel unique, so it never
   * collides with prior output already in the terminal buffer.
   */
  private runCounter: number = 0;

  /**
   * Holds the edit-preview diff surface (the staged change shown in the document well).
   */
  private readonly preview: AgentEditPreview = inject(AgentEditPreview);

  /**
   * Holds the staged previews awaiting a decision, keyed by preview id.
   */
  private readonly pendingPreviews: Map<string, PendingPreview> = new Map<string, PendingPreview>();

  /**
   * Tracks the counter that makes preview ids unique within this session.
   */
  private previewCounter: number = 0;

  /**
   * Initializes a new instance of the {@link AgentEditorCapabilities} class, registering the editor
   * capabilities.
   */
  public constructor() {
    this.runtime.registerCapability(
      READ_ACTIVE_DOCUMENT,
      (input: unknown): ReadResult => this.readActive(input),
    );
    this.runtime.registerCapability(
      REPLACE_ACTIVE_DOCUMENT,
      (input: unknown): ReplaceResult => this.replaceActive(input),
    );
    this.runtime.registerCapability(
      EDIT_ACTIVE_DOCUMENT,
      (input: unknown): EditResult => this.editActive(input),
    );
    this.runtime.registerCapability(
      INSERT_ACTIVE_DOCUMENT,
      (input: unknown): EditResult => this.insertActive(input),
    );
    this.runtime.registerCapability(
      PREVIEW_ACTIVE_DOCUMENT_EDIT,
      (input: unknown): PreviewResult => this.previewEdit(input),
    );
    this.runtime.registerCapability(
      COMMIT_EDIT_PREVIEW,
      (input: unknown): EditResult => this.commitPreview(input),
    );
    this.runtime.registerCapability(CANCEL_EDIT_PREVIEW, (input: unknown): void => {
      this.cancelPreview(input);
    });
    this.runtime.registerCapability(
      SET_ACTIVE_DOCUMENT_LANGUAGE,
      (input: unknown): EditResult => this.setActiveLanguage(input),
    );
    this.runtime.registerCapability(
      RUN_ACTIVE_DOCUMENT,
      (input: unknown): Promise<RunResult> => this.runActiveDocument(input),
    );
    this.log.info('agent.editor-capabilities', 'Registered agent editor capabilities');
  }

  /**
   * Sets the language (syntax) of the targeted code document from a `{ language, tabId }` input: the
   * owning tab's document when scoped, otherwise the active code document. The language is matched
   * case-insensitively against the supported Monaco ids and display names, so both `csharp` and `C#`
   * resolve. Changing it re-highlights the editor and updates the language picker (both read the
   * document's language signal).
   * @param input The capability input.
   * @returns Returns the {@link EditResult}.
   */
  private setActiveLanguage(input: unknown): EditResult {
    const requested: string | null = this.extractString(input, 'language');
    if (requested === null) {
      return { ok: false, detail: 'No language was provided.' };
    }
    const resolved: string | null = resolveLanguageId(requested);
    if (resolved === null) {
      return {
        ok: false,
        detail: `Unknown language "${requested}". Use a Monaco language id such as typescript, python, or csharp.`,
      };
    }
    const tabId: string | null = this.extractTabId(input) ?? this.documents.activeDocumentId();
    if (tabId === null || this.documents.get(tabId) === undefined) {
      return { ok: false, detail: 'No code document is open in the editor.' };
    }
    this.documents.setLanguage(tabId, resolved);
    this.log.info('agent.editor-capabilities', 'Set active document language', {
      tabId,
      language: resolved,
    });
    return { ok: true, detail: `The editor language is now ${resolved}.` };
  }

  /**
   * Runs the targeted code document in the code view's docked run terminal and reports the outcome.
   * The live editor content is written to a temp file and run through the same {@link RunFileTaskProvider}
   * the editor's Run action uses, so the user sees it run in their terminal. A completion sentinel is
   * appended to the command — `printf` of the exit status — so completion and the exit code can be read
   * back from the terminal buffer (the run terminal is a persistent shell, so node-pty never reports a
   * per-command exit). The sentinel is POSIX-shell syntax (bash/zsh/sh); on a non-POSIX shell it will
   * not match, and the run returns its output with an unknown exit status once the timeout elapses.
   * @param input The capability input: the owning `tabId` and an optional `timeoutSeconds`.
   * @returns Returns the {@link RunResult}.
   */
  private async runActiveDocument(input: unknown): Promise<RunResult> {
    this.log.trace('agent.editor-capabilities', 'Run active document invoked');
    const tabId: string | null = this.extractTabId(input) ?? this.documents.activeDocumentId();
    const codeDocument: CodeDocument | undefined =
      tabId === null ? undefined : this.documents.get(tabId);
    if (tabId === null || codeDocument === undefined) {
      return { ran: false, detail: 'No code document is open in the editor to run.' };
    }
    const language: string = codeDocument.language();
    if (!this.runFiles.canRun(language)) {
      return {
        ran: false,
        detail:
          `The editor language "${language}" cannot be run — there is no runner for it. Runnable ` +
          'languages include javascript, typescript, python, csharp, java, kotlin, rust, go, and shell.',
      };
    }
    const task: Task | null = this.runFiles.buildTask({
      tabId,
      language,
      content: codeDocument.content(),
    });
    const command: string | null = task === null ? null : await task.resolve();
    if (command === null) {
      return {
        ran: false,
        detail: 'The document could not be prepared to run (writing its temporary file failed).',
      };
    }
    this.runCounter += 1;
    const markerPrefix: string = `__STUDIO_RUN_${this.runCounter}_`;
    // Append a sentinel that prints the exit status once the command finishes. `$?` after the `;`
    // reflects the run command's exit code (including a short-circuited `&&` chain), and its digits
    // distinguish the printed sentinel from the echoed command line (which shows the literal `%s`).
    const sentinelCommand: string = `${command}; printf '\\n${markerPrefix}%s__\\n' "$?"`;
    // Queue the command into the tab's docked run terminal (mounting and showing it if needed); the
    // panel writes it once the terminal is ready.
    this.log.info('agent.editor-capabilities', 'Running active document', {
      tabId,
      language,
      command,
    });
    this.editorTerminals.queueCommand(tabId, sentinelCommand);
    const terminalId: string = `${RUN_TERMINAL_PREFIX}${tabId}`;
    const completion: { exitCode: number | null; output: string; timedOut: boolean } =
      await this.awaitRunCompletion(terminalId, markerPrefix, this.resolveRunTimeoutMs(input));
    this.log.info('agent.editor-capabilities', 'Run completed', {
      tabId,
      exitCode: completion.exitCode,
      timedOut: completion.timedOut,
    });
    return {
      ran: true,
      command,
      exitCode: completion.exitCode,
      success: completion.timedOut === false && completion.exitCode === 0,
      timedOut: completion.timedOut,
      output: completion.output,
    };
  }

  /**
   * Polls the run terminal's buffer until the completion sentinel appears or the timeout elapses,
   * returning the parsed exit code and the captured output.
   * @param terminalId The run terminal's session id.
   * @param markerPrefix The unique sentinel prefix for this run.
   * @param timeoutMs How long to wait before giving up.
   * @returns Returns the exit code (null when it could not be determined), the captured output, and
   * whether the run timed out.
   */
  private async awaitRunCompletion(
    terminalId: string,
    markerPrefix: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
    const deadline: number = Date.now() + timeoutMs;
    for (;;) {
      const text: string | null = this.terminals.readText(terminalId);
      if (text !== null) {
        const parsed: RunOutputParse = parseRunOutput(text, markerPrefix, RUN_MAX_OUTPUT_LINES);
        if (parsed.found) {
          return { exitCode: parsed.exitCode, output: parsed.output, timedOut: false };
        }
      }
      if (Date.now() >= deadline) {
        const last: string | null = this.terminals.readText(terminalId);
        const output: string =
          last === null ? '' : parseRunOutput(last, markerPrefix, RUN_MAX_OUTPUT_LINES).output;
        return { exitCode: null, output, timedOut: true };
      }
      await this.delay(RUN_POLL_INTERVAL_MS);
    }
  }

  /**
   * Resolves the run timeout (ms) from the capability input's optional `timeoutSeconds`, defaulting to
   * 60 seconds and clamping to `[1, 300]` seconds so a hung program cannot block the run indefinitely.
   * @param input The capability input.
   * @returns Returns the timeout in milliseconds.
   */
  private resolveRunTimeoutMs(input: unknown): number {
    const raw: unknown =
      input !== null && typeof input === 'object'
        ? (input as Record<string, unknown>)['timeoutSeconds']
        : undefined;
    const seconds: number = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 60;
    return Math.min(300, Math.max(1, seconds)) * 1000;
  }

  /**
   * Resolves after a delay.
   * @param ms The delay in milliseconds.
   * @returns Returns a promise that resolves once the delay elapses.
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Stages an editor mutation as a pending preview instead of applying it: the prospective text is
   * resolved against the target's current source, a diff opens in the document well for code targets
   * (markdown has no diff editor), and the outcome is held until committed or cancelled.
   * @param input The capability input: the operation (`edit`/`insert`/`replace`) with its fields,
   * plus the owning `tabId`.
   * @returns Returns the {@link PreviewResult}.
   */
  private previewEdit(input: unknown): PreviewResult {
    const resolve: ((source: string) => EditOutcome) | null = this.resolverFor(input);
    if (resolve === null) {
      return { available: false, detail: 'The edit input was malformed.' };
    }
    const target: EditTarget | null = this.resolveTarget(this.extractTabId(input));
    if (target === null) {
      return { available: false, detail: 'No active document is open in the editor.' };
    }
    const outcome: EditOutcome = resolve(target.source);
    if (!outcome.ok) {
      return { available: false, detail: outcome.detail };
    }
    this.previewCounter += 1;
    const previewId: string = `preview-${this.previewCounter}`;
    const diffShown: boolean = target.kind === 'code';
    if (diffShown) {
      this.preview.open('Agent edit', 'plaintext', target.source, outcome.text);
    }
    this.pendingPreviews.set(previewId, {
      apply: (): boolean => target.apply(outcome),
      diffShown,
    });
    this.log.info('agent.editor-capabilities', 'Staged edit preview', {
      previewId,
      kind: target.kind,
      diffShown,
    });
    return {
      available: true,
      previewId,
      name: target.kind === 'markdown' ? 'the markdown document' : 'the active document',
      summary: this.summarizeChange(target.source, outcome.text),
      diffShown,
    };
  }

  /**
   * Applies a staged preview to its document and closes its diff.
   * @param input The capability input carrying the `previewId`.
   * @returns Returns the {@link EditResult}.
   */
  private commitPreview(input: unknown): EditResult {
    const pending: PendingPreview | null = this.takePreview(input);
    if (pending === null) {
      this.log.warn('agent.editor-capabilities', 'Commit preview: staged edit no longer available');
      return { ok: false, detail: 'The staged edit is no longer available.' };
    }
    const applied: boolean = pending.apply();
    this.log.info('agent.editor-capabilities', 'Committed staged edit preview', { applied });
    return applied
      ? { ok: true, detail: 'The edit was applied.' }
      : { ok: false, detail: 'The editor is no longer available.' };
  }

  /**
   * Discards a staged preview and closes its diff.
   * @param input The capability input carrying the `previewId`.
   */
  private cancelPreview(input: unknown): void {
    this.log.info('agent.editor-capabilities', 'Cancelled staged edit preview');
    this.takePreview(input);
  }

  /**
   * Removes a staged preview from the pending map and closes its diff, returning it for the caller
   * to apply (commit) or drop (cancel).
   * @param input The capability input carrying the `previewId`.
   * @returns Returns the pending preview, or null when unknown.
   */
  private takePreview(input: unknown): PendingPreview | null {
    const previewId: string | null = this.extractString(input, 'previewId');
    const pending: PendingPreview | undefined =
      previewId === null ? undefined : this.pendingPreviews.get(previewId);
    if (previewId === null || pending === undefined) {
      return null;
    }
    this.pendingPreviews.delete(previewId);
    if (pending.diffShown) {
      this.preview.close();
    }
    return pending;
  }

  /**
   * Builds the outcome resolver for a preview input's operation, or null when the input is
   * malformed.
   * @param input The capability input.
   * @returns Returns the resolver, or null.
   */
  private resolverFor(input: unknown): ((source: string) => EditOutcome) | null {
    const operation: string | null = this.extractString(input, 'operation');
    if (operation === 'replace') {
      const text: string | null = this.extractString(input, 'text');
      return text === null
        ? null
        : (): EditOutcome => ({ ok: true, text, detail: 'The active document was updated.' });
    }
    if (operation === 'edit') {
      const oldString: string | null = this.extractString(input, 'oldString');
      const newString: string | null = this.extractString(input, 'newString');
      const replaceAll: boolean = this.extractBoolean(input, 'replaceAll');
      return oldString === null || newString === null
        ? null
        : (source: string): EditOutcome => resolveEdit(source, oldString, newString, replaceAll);
    }
    if (operation === 'insert') {
      const text: string | null = this.extractString(input, 'text');
      const placement: string | null = this.extractString(input, 'placement');
      const anchor: string | null = this.extractString(input, 'anchor');
      return text === null || !this.isPlacement(placement)
        ? null
        : (source: string): EditOutcome =>
            resolveInsert(source, text, placement, anchor ?? undefined);
    }
    return null;
  }

  /**
   * Summarises a staged change for the decision card: the line delta between the current and
   * prospective text.
   * @param source The current text.
   * @param modified The prospective text.
   * @returns Returns a one-line summary (for example, `+3 / −1 lines`).
   */
  private summarizeChange(source: string, modified: string): string {
    const before: number = source.split('\n').length;
    const after: number = modified.split('\n').length;
    const delta: number = after - before;
    const lines: string =
      delta > 0 ? `+${delta} lines` : delta < 0 ? `−${-delta} lines` : 'same line count';
    const characters: number = modified.length - source.length;
    const chars: string =
      characters >= 0 ? `+${characters} characters` : `−${-characters} characters`;
    return `${lines}, ${chars}`;
  }

  /**
   * Applies a string-anchored edit from an `{ oldString, newString, replaceAll, tabId }` input to the
   * targeted editor's document.
   * @param input The capability input.
   * @returns Returns the {@link EditResult}.
   */
  private editActive(input: unknown): EditResult {
    const oldString: string | null = this.extractString(input, 'oldString');
    const newString: string | null = this.extractString(input, 'newString');
    if (oldString === null || newString === null) {
      return { ok: false, detail: 'The edit input was malformed.' };
    }
    const replaceAll: boolean = this.extractBoolean(input, 'replaceAll');
    return this.applyToTarget(
      input,
      (source: string): EditOutcome => resolveEdit(source, oldString, newString, replaceAll),
    );
  }

  /**
   * Applies an insert from a `{ text, placement, anchor, tabId }` input to the targeted editor's
   * document.
   * @param input The capability input.
   * @returns Returns the {@link EditResult}.
   */
  private insertActive(input: unknown): EditResult {
    const text: string | null = this.extractString(input, 'text');
    const placement: string | null = this.extractString(input, 'placement');
    if (text === null || !this.isPlacement(placement)) {
      return { ok: false, detail: 'The insert input was malformed.' };
    }
    const anchor: string | null = this.extractString(input, 'anchor');
    return this.applyToTarget(
      input,
      (source: string): EditOutcome => resolveInsert(source, text, placement, anchor ?? undefined),
    );
  }

  /**
   * Resolves the targeted editing surface (the owning tab's markdown or code editor, or the focused
   * one for an unscoped run), runs the resolver against its source, and applies a successful outcome.
   * @param input The capability input, carrying the owning `tabId` when scoped.
   * @param resolve Resolves the operation against the document source.
   * @returns Returns the {@link EditResult}.
   */
  private applyToTarget(input: unknown, resolve: (source: string) => EditOutcome): EditResult {
    const target: EditTarget | null = this.resolveTarget(this.extractTabId(input));
    if (target === null) {
      return { ok: false, detail: 'No active document is open in the editor.' };
    }
    const outcome: EditOutcome = resolve(target.source);
    if (!outcome.ok) {
      this.log.warn('agent.editor-capabilities', 'Edit did not resolve', {
        kind: target.kind,
        detail: outcome.detail,
      });
      return { ok: false, detail: outcome.detail };
    }
    const applied: boolean = target.apply(outcome);
    this.log.info('agent.editor-capabilities', 'Applied edit to active document', {
      kind: target.kind,
      applied,
    });
    return applied
      ? { ok: true, detail: outcome.detail }
      : { ok: false, detail: 'The editor is no longer available.' };
  }

  /**
   * Resolves the editing surface for a run: the owning tab's markdown editor first (its live source,
   * re-parsed on apply), then that tab's code editor (applied as a granular range edit); an unscoped
   * run falls back to the focused markdown editor, then the focused code editor.
   * @param tabId The owning tab id, or null for an unscoped run.
   * @returns Returns the {@link EditTarget}, or null when no editor is available.
   */
  private resolveTarget(tabId: string | null): EditTarget | null {
    if (tabId !== null) {
      const markdown: string | null = this.markdownCommands.readDocument(tabId);
      if (markdown !== null) {
        return {
          source: markdown,
          kind: 'markdown',
          apply: (outcome: EditOutcome): boolean =>
            this.markdownCommands.replaceDocument(tabId, outcome.text),
        };
      }
      const code: string | null = this.editorCommands.readText(tabId);
      if (code !== null) {
        return {
          source: code,
          kind: 'code',
          apply: (outcome: EditOutcome): boolean =>
            outcome.range !== undefined
              ? this.editorCommands.replaceRange(
                  tabId,
                  outcome.range.start,
                  outcome.range.length,
                  outcome.range.insert,
                )
              : this.editorCommands.replaceText(tabId, outcome.text),
        };
      }
      return null;
    }
    const markdown: string | null = this.markdownCommands.readActiveDocument();
    if (markdown !== null) {
      return {
        source: markdown,
        kind: 'markdown',
        apply: (outcome: EditOutcome): boolean =>
          this.markdownCommands.replaceActiveDocument(outcome.text),
      };
    }
    const code: string | null = this.editorCommands.readActiveText();
    if (code !== null) {
      return {
        source: code,
        kind: 'code',
        apply: (outcome: EditOutcome): boolean =>
          outcome.range !== undefined
            ? this.editorCommands.replaceActiveRange(
                outcome.range.start,
                outcome.range.length,
                outcome.range.insert,
              )
            : this.editorCommands.replaceActiveText(outcome.text),
      };
    }
    return null;
  }

  /**
   * Narrows a value to an {@link InsertPlacement}.
   * @param value The value to test.
   * @returns Returns true when the value is a known placement.
   */
  private isPlacement(value: string | null): value is InsertPlacement {
    return value === 'before' || value === 'after' || value === 'start' || value === 'end';
  }

  /**
   * Extracts a boolean field from a capability input, defaulting to false.
   * @param input The capability input.
   * @param key The field to read.
   * @returns Returns the boolean value, or false when absent or malformed.
   */
  private extractBoolean(input: unknown, key: string): boolean {
    if (input === null || typeof input !== 'object') {
      return false;
    }
    return (input as Record<string, unknown>)[key] === true;
  }

  /**
   * Reads the editor's text. When the run carries an owning tab id, reads that tab's editor (markdown
   * or code); otherwise (the standalone agent) falls back to the active markdown editor's live source,
   * then the active code editor.
   * @param input The capability input, carrying the owning `tabId`.
   * @returns Returns the {@link ReadResult}.
   */
  private readActive(input: unknown): ReadResult {
    this.log.trace('agent.editor-capabilities', 'Read active document invoked');
    const tabId: string | null = this.extractTabId(input);
    if (tabId !== null) {
      const markdown: string | null = this.markdownCommands.readDocument(tabId);
      if (markdown !== null) {
        return { available: true, text: markdown };
      }
      const code: string | null = this.editorCommands.readText(tabId);
      return code === null ? { available: false, text: '' } : { available: true, text: code };
    }
    const markdown: string | null = this.markdownCommands.readActiveDocument();
    if (markdown !== null) {
      return { available: true, text: markdown };
    }
    const text: string | null = this.editorCommands.readActiveText();
    return text === null ? { available: false, text: '' } : { available: true, text };
  }

  /**
   * Replaces the editor's text from a `{ text, tabId }` input. When the run carries an owning tab id,
   * replaces that tab's editor (markdown text is parsed as markdown); otherwise (the standalone agent)
   * falls back to the active markdown editor, then the active code editor.
   * @param input The capability input.
   * @returns Returns the {@link ReplaceResult}.
   */
  private replaceActive(input: unknown): ReplaceResult {
    this.log.info('agent.editor-capabilities', 'Replace active document invoked');
    const text: string | null = this.extractText(input);
    if (text === null) {
      return { ok: false };
    }
    const tabId: string | null = this.extractTabId(input);
    if (tabId !== null) {
      if (this.markdownCommands.replaceDocument(tabId, text)) {
        return { ok: true };
      }
      return { ok: this.editorCommands.replaceText(tabId, text) };
    }
    if (this.markdownCommands.replaceActiveDocument(text)) {
      return { ok: true };
    }
    return { ok: this.editorCommands.replaceActiveText(text) };
  }

  /**
   * Extracts the `text` string from a capability input.
   * @param input The capability input.
   * @returns Returns the text, or null when the input is malformed.
   */
  private extractText(input: unknown): string | null {
    return this.extractString(input, 'text');
  }

  /**
   * Extracts the owning `tabId` from a capability input, or null when absent (an unscoped run).
   * @param input The capability input.
   * @returns Returns the tab id, or null.
   */
  private extractTabId(input: unknown): string | null {
    return this.extractString(input, 'tabId');
  }

  /**
   * Extracts a string field from a capability input.
   * @param input The capability input.
   * @param key The field to read.
   * @returns Returns the string value, or null when absent or malformed.
   */
  private extractString(input: unknown, key: string): string | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const value: unknown = (input as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }
}
