import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { StatusBar } from '../status-bar/status-bar';

/**
 * Holds the status-bar owner identifier for the code editor's contribution.
 */
const STATUS_OWNER: string = 'code';

/**
 * Holds the status-bar priority for the code editor, ordering its segments before the terminal's
 * trailing working-directory segment.
 */
const STATUS_PRIORITY: number = 10;

/**
 * Identifies the end-of-line sequence of the active document.
 */
export type EndOfLine = 'LF' | 'CRLF';

/**
 * Describes the contextual information the active code editor publishes to the status strip.
 */
export interface CodeContext {
  /**
   * Gets the absolute file path, or null when the document is unsaved ("New Document").
   */
  readonly path: string | null;

  /**
   * Gets the one-based line number of the cursor.
   */
  readonly line: number;

  /**
   * Gets the one-based column number of the cursor.
   */
  readonly column: number;

  /**
   * Gets the document's end-of-line sequence.
   */
  readonly eol: EndOfLine;

  /**
   * Gets the document's encoding label (for example "UTF-8" or "UTF-8 with BOM").
   */
  readonly encoding: string;
}

/**
 * Publishes the active code editor's context to the status strip.
 *
 * The active editor pushes its context here; an effect projects the file path as a leading segment
 * ("New Document" when unsaved) and the cursor position, line-ending and encoding as trailing
 * segments, clearing the contribution when no code editor is active (the context is null).
 */
@Service()
export class CodeStatus {
  /**
   * Holds the status bar the context is published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active editor's context and the tab that published it, or null when no code editor is
   * active. The tab is tracked so a deactivating editor only clears the strip when it still owns it —
   * never wiping out the editor that just became active.
   */
  private readonly contextSignal: WritableSignal<{ tabId: string; context: CodeContext } | null> =
    signal<{ tabId: string; context: CodeContext } | null>(null);

  /**
   * Initializes the service, projecting the context as leading and trailing status segments.
   */
  public constructor() {
    effect((): void => {
      const current: { tabId: string; context: CodeContext } | null = this.contextSignal();
      if (current === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      const context: CodeContext = current.context;
      this.statusBar.contribute(
        STATUS_OWNER,
        {
          leading: [
            { id: 'code-path', text: context.path ?? 'New Document' },
          ],
          trailing: [
            { id: 'code-line', text: `Ln ${context.line}` },
            { id: 'code-col', text: `Col ${context.column}` },
            { id: 'code-eol', text: context.eol },
            { id: 'code-encoding', text: context.encoding },
          ],
        },
        STATUS_PRIORITY,
      );
    });
  }

  /**
   * Publishes the given tab's editor context as the active status.
   * @param tabId The identifier of the publishing tab.
   * @param context The editor context.
   */
  public publish(tabId: string, context: CodeContext): void {
    this.contextSignal.set({ tabId, context });
  }

  /**
   * Clears the status, but only when the given tab is the one currently shown, so a deactivating
   * editor never wipes out the editor that just became active.
   * @param tabId The identifier of the deactivating tab.
   */
  public clear(tabId: string): void {
    if (this.contextSignal()?.tabId === tabId) {
      this.contextSignal.set(null);
    }
  }
}
