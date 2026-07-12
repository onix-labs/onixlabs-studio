import { inject, Service } from '@angular/core';
import {
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  InsertPlacement,
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
} from '@shared/api/ai-types';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { EditOutcome, resolveEdit, resolveInsert } from './document-edit';

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
   * Applies a resolved outcome to the document.
   * @param outcome The successful outcome to apply.
   * @returns Returns true when the document accepted the change.
   */
  apply(outcome: EditOutcome): boolean;
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
   * Holds the code-editor command seam the capabilities act through.
   */
  private readonly editorCommands: EditorCommands = inject(EditorCommands);

  /**
   * Holds the markdown-editor command seam, consulted first so the agent reads the live markdown
   * document (including unsaved edits) when a markdown editor is active.
   */
  private readonly markdownCommands: MarkdownCommands = inject(MarkdownCommands);

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
    return this.applyToTarget(input, (source: string): EditOutcome =>
      resolveEdit(source, oldString, newString, replaceAll),
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
    return this.applyToTarget(input, (source: string): EditOutcome =>
      resolveInsert(source, text, placement, anchor ?? undefined),
    );
  }

  /**
   * Resolves the targeted editing surface (the owning tab's markdown or code editor, or the focused
   * one for an unscoped run), runs the resolver against its source, and applies a successful outcome.
   * @param input The capability input, carrying the owning `tabId` when scoped.
   * @param resolve Resolves the operation against the document source.
   * @returns Returns the {@link EditResult}.
   */
  private applyToTarget(
    input: unknown,
    resolve: (source: string) => EditOutcome,
  ): EditResult {
    const target: EditTarget | null = this.resolveTarget(this.extractTabId(input));
    if (target === null) {
      return { ok: false, detail: 'No active document is open in the editor.' };
    }
    const outcome: EditOutcome = resolve(target.source);
    if (!outcome.ok) {
      return { ok: false, detail: outcome.detail };
    }
    return target.apply(outcome)
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
          apply: (outcome: EditOutcome): boolean =>
            this.markdownCommands.replaceDocument(tabId, outcome.text),
        };
      }
      const code: string | null = this.editorCommands.readText(tabId);
      if (code !== null) {
        return {
          source: code,
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
        apply: (outcome: EditOutcome): boolean =>
          this.markdownCommands.replaceActiveDocument(outcome.text),
      };
    }
    const code: string | null = this.editorCommands.readActiveText();
    if (code !== null) {
      return {
        source: code,
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
