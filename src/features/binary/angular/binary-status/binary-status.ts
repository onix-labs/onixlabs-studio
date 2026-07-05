import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';

/**
 * Holds the status-bar owner identifier for the binary editor's contribution.
 */
const STATUS_OWNER: string = 'binary';

/**
 * Holds the status-bar priority for the binary editor, matching the code editor so its segments sit
 * ahead of the terminal's trailing working-directory segment.
 */
const STATUS_PRIORITY: number = 10;

/**
 * Describes the contextual information the active binary editor publishes to the status strip.
 */
export interface BinaryContext {
  /**
   * Gets the absolute file path.
   */
  readonly path: string;

  /**
   * Gets the cursor's byte offset, or null when there is no cursor.
   */
  readonly offset: number | null;

  /**
   * Gets the number of selected bytes (zero when nothing is selected).
   */
  readonly selectionLength: number;

  /**
   * Gets the total file size in bytes.
   */
  readonly size: number;

  /**
   * Gets the sniffed container-format label (for example "PE · x64" or "Binary").
   */
  readonly format: string;
}

/**
 * Publishes the active binary editor's context to the status strip.
 *
 * The active editor pushes its context here; an effect projects the file path as a leading segment and
 * the cursor offset, selection length and file size as trailing segments, clearing the contribution
 * when no binary editor is active (the context is null). Mirrors {@link CodeStatus}.
 */
@Service()
export class BinaryStatus {
  /**
   * Holds the status bar the context is published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active editor's context and the tab that published it, or null when no binary editor is
   * active. The tab is tracked so a deactivating editor only clears the strip when it still owns it.
   */
  private readonly contextSignal: WritableSignal<{ tabId: string; context: BinaryContext } | null> =
    signal<{ tabId: string; context: BinaryContext } | null>(null);

  /**
   * Initializes the service, projecting the context as leading and trailing status segments.
   */
  public constructor() {
    effect((): void => {
      const current: { tabId: string; context: BinaryContext } | null = this.contextSignal();
      if (current === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      const context: BinaryContext = current.context;
      this.statusBar.contribute(
        STATUS_OWNER,
        {
          leading: [
            { id: 'binary-path', text: context.path },
            { id: 'binary-format', text: context.format },
          ],
          trailing: [
            {
              id: 'binary-offset',
              text: context.offset === null ? 'Offset —' : `Offset ${this.hex(context.offset)}`,
            },
            { id: 'binary-selection', text: `Sel ${context.selectionLength}` },
            { id: 'binary-size', text: `${context.size} bytes` },
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
  public publish(tabId: string, context: BinaryContext): void {
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

  /**
   * Formats a byte offset as an upper-case, `0x`-prefixed hex string.
   * @param offset The byte offset.
   * @returns Returns the formatted offset.
   */
  private hex(offset: number): string {
    return `0x${offset.toString(16).toUpperCase()}`;
  }
}
