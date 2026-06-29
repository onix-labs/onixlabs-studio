import { inject, Service } from '@angular/core';
import { READ_ACTIVE_DOCUMENT, REPLACE_ACTIVE_DOCUMENT } from '../../../shared/ai-types';
import { CodeCommands } from '../code-commands/code-commands';
import { MarkdownCommands } from '../markdown-commands/markdown-commands';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';

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
  private readonly codeCommands: CodeCommands = inject(CodeCommands);

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
    this.runtime.registerCapability(READ_ACTIVE_DOCUMENT, (input: unknown): ReadResult =>
      this.readActive(input),
    );
    this.runtime.registerCapability(REPLACE_ACTIVE_DOCUMENT, (input: unknown): ReplaceResult =>
      this.replaceActive(input),
    );
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
      const code: string | null = this.codeCommands.readText(tabId);
      return code === null ? { available: false, text: '' } : { available: true, text: code };
    }
    const markdown: string | null = this.markdownCommands.readActiveDocument();
    if (markdown !== null) {
      return { available: true, text: markdown };
    }
    const text: string | null = this.codeCommands.readActiveText();
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
      return { ok: this.codeCommands.replaceText(tabId, text) };
    }
    if (this.markdownCommands.replaceActiveDocument(text)) {
      return { ok: true };
    }
    return { ok: this.codeCommands.replaceActiveText(text) };
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
