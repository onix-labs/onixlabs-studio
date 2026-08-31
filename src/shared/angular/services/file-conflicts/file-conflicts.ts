import {
  computed,
  effect,
  inject,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Describes a document whose file changed on disk while it had unsaved edits, awaiting the user's
 * keep-or-reload decision.
 */
export interface FileConflict {
  /**
   * Gets the identifier of the conflicted document.
   */
  readonly documentId: string;

  /**
   * Gets the top-level tab the conflict is surfaced on (the document's own tab, or the workspace tab
   * that hosts it).
   */
  readonly tabId: string;

  /**
   * Gets the document's display file name.
   */
  readonly name: string;
}

/**
 * The keep/reload handlers a conflict's owner supplies, run when the user decides.
 */
interface ConflictHandlers {
  /**
   * Keeps the user's in-editor version, leaving the on-disk change ignored.
   */
  readonly keep: () => void;

  /**
   * Replaces the document with the on-disk version.
   */
  readonly reload: () => void;
}

/**
 * Tracks file-on-disk-changed-while-dirty conflicts and surfaces them per tab. A conflict on the
 * active tab is shown immediately (a tab-scoped modal reads {@link activeConflict}); a conflict on an
 * inactive tab lights that tab's attention dot (via `Tab.attention`) until the user switches to it.
 * Owner-agnostic: the document service supplies the keep/reload behaviour.
 */
@Service()
export class FileConflicts {
  /**
   * Holds the tabs registry, used to resolve the active tab and flag tabs awaiting a decision.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the pending conflicts.
   */
  private readonly conflictList: WritableSignal<readonly FileConflict[]> = signal<
    readonly FileConflict[]
  >([]);

  /**
   * Holds the keep/reload handlers, keyed by document id.
   */
  private readonly handlers: Map<string, ConflictHandlers> = new Map<string, ConflictHandlers>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the conflict to prompt for on the active tab, or null when the active tab has none.
   */
  public readonly activeConflict: Signal<FileConflict | null> = computed(
    (): FileConflict | null => {
      const active: string | undefined = this.tabs.activeTabId();
      return (
        this.conflictList().find((conflict: FileConflict): boolean => conflict.tabId === active) ??
        null
      );
    },
  );

  /**
   * Initializes a new instance of the {@link FileConflicts} class, keeping the attention dot of each
   * document tab in sync with its pending conflicts.
   */
  public constructor() {
    effect((): void => {
      const active: string | undefined = this.tabs.activeTabId();
      const waiting: ReadonlySet<string> = new Set<string>(
        this.conflictList().map((conflict: FileConflict): string => conflict.tabId),
      );
      untracked((): void => {
        // Swept across every tab, and safely so: the claim is scoped to this service's own reason, so
        // clearing a tab that has no conflict cannot put out a dot the agent bridge lit on it.
        for (const tab of this.tabs.tabs()) {
          this.tabs.setAttention(tab.id, 'conflict', waiting.has(tab.id) && tab.id !== active);
        }
      });
    });
  }

  /**
   * Raises (or refreshes) a conflict for a document, replacing any prior pending conflict for it.
   * @param conflict The conflict descriptor.
   * @param handlers The keep/reload behaviour to run on the user's decision.
   */
  public raise(conflict: FileConflict, handlers: ConflictHandlers): void {
    this.handlers.set(conflict.documentId, handlers);
    this.log.info('FileConflicts', `Conflict raised for '${conflict.name}'`, conflict.documentId);
    this.conflictList.update((list: readonly FileConflict[]): readonly FileConflict[] => [
      ...list.filter(
        (existing: FileConflict): boolean => existing.documentId !== conflict.documentId,
      ),
      conflict,
    ]);
  }

  /**
   * Resolves a conflict by keeping the user's in-editor version.
   * @param documentId The conflicted document's id.
   */
  public keep(documentId: string): void {
    this.handlers.get(documentId)?.keep();
    this.dismiss(documentId);
    this.log.info('FileConflicts', 'Conflict resolved: kept editor version', documentId);
  }

  /**
   * Resolves a conflict by reloading the document from disk.
   * @param documentId The conflicted document's id.
   */
  public reload(documentId: string): void {
    this.handlers.get(documentId)?.reload();
    this.dismiss(documentId);
    this.log.info('FileConflicts', 'Conflict resolved: reloaded from disk', documentId);
  }

  /**
   * Drops a document's pending conflict, for example when the document closes.
   * @param documentId The document's id.
   */
  public clear(documentId: string): void {
    this.dismiss(documentId);
  }

  /**
   * Removes a conflict and its handlers.
   * @param documentId The document's id.
   */
  private dismiss(documentId: string): void {
    this.handlers.delete(documentId);
    this.conflictList.update((list: readonly FileConflict[]): readonly FileConflict[] =>
      list.filter((conflict: FileConflict): boolean => conflict.documentId !== documentId),
    );
  }
}
