import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Button } from '@shared/angular/components/forms/button/button';
import {
  ConflictLens,
  ConflictLensLabels,
} from '@shared/angular/components/conflict-lens/conflict-lens';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Log } from '@shared/angular/services/log/log';
import { MergeToolReveal, MergeTools } from '@shared/angular/services/merge-tool/merge-tools';
import {
  CONFLICT_CONTEXT,
  ConflictContext,
} from '@shared/angular/services/repository/conflict-context';
import {
  ConflictLineSpan,
  ConflictPane,
  ConflictRegion,
  ConflictSides,
  conflictVersions,
  ConflictVersions,
  keepSideLabel,
  mapConflictLine,
} from '@shared/angular/services/repository/conflict-resolution';

/**
 * Names the panes beside the file: the user's side, the common ancestor, and the other side.
 */
type SidePane = Exclude<ConflictPane, 'result'>;

/**
 * Holds the options every side pane is drawn with: read-only, and without the chrome that only an
 * editable file needs.
 */
const SIDE_OPTIONS: MonacoApi.editor.IEditorOptions = {
  readOnly: true,
  minimap: { enabled: false },
  glyphMargin: false,
  folding: false,
  renderLineHighlight: 'none',
  contextmenu: false,
  // A pane a third of the well wide has no room for the scope lines stuck over its top, and they would
  // hide the very lines being lined up with the file below.
  stickyScroll: { enabled: false },
};

/**
 * Holds each side pane's highlight, the same tints the code editor gives each side's section.
 */
const SIDE_CLASSES: Readonly<Record<SidePane, string>> = {
  yours: 'conflict-lens__yours',
  theirs: 'conflict-lens__theirs',
  base: 'conflict-lens__base',
};

/**
 * Shows a conflicted file in the merge tool (#1321): the user's side and the other side next to each
 * other — with the common ancestor between them where git wrote diff3 base sections — above the file
 * itself, where each conflict is settled with Keep Yours, Keep Theirs or Keep Both, or edited by hand.
 *
 * The sides are read from the file's own markers, so they follow it as it is edited: a conflict
 * settled below leaves the panes above with it. Every line outside the conflicts is the same in each
 * pane, which is what lets them scroll together, conflict for conflict.
 *
 * The file below is the file's own document — the same one its code tab edits — so saving either saves
 * the file. The tool strip moves between conflicts and marks the file resolved once none is left,
 * refusing while any is, with Mark Resolved Anyway for a file whose marker-like text is meant.
 *
 * Drawn by Studio: the panes are Studio's text editor and the rows above each conflict the code
 * editor's own lens, not Monaco's merge editor (#946).
 */
@Component({
  selector: 'app-merge-tool-panel',
  imports: [Button, PanelToolbar, TextEditor],
  templateUrl: './merge-tool-panel.html',
  styleUrl: './merge-tool-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MergeToolPanel implements OnDestroy {
  /**
   * Gets the dock panel descriptor this panel was projected for.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the options the side panes are drawn with.
   */
  protected readonly sideOptions: MonacoApi.editor.IEditorOptions = SIDE_OPTIONS;

  /**
   * Holds what each merge tool shows.
   */
  private readonly mergeTools: MergeTools = inject(MergeTools);

  /**
   * Holds the document model the file's document is found in.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the repository's view of the operation in flight: what the sides are called, which way round
   * git wrote them, and Mark Resolved. Null outside a repository.
   */
  private readonly conflictContext: ConflictContext | null = inject(CONFLICT_CONTEXT, {
    optional: true,
  });

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the user's side's pane.
   */
  private readonly yoursPane: Signal<TextEditor | undefined> = viewChild<TextEditor>('yours');

  /**
   * Gets the common ancestor's pane, while it is shown.
   */
  private readonly basePane: Signal<TextEditor | undefined> = viewChild<TextEditor>('base');

  /**
   * Gets the other side's pane.
   */
  private readonly theirsPane: Signal<TextEditor | undefined> = viewChild<TextEditor>('theirs');

  /**
   * Gets the file's pane.
   */
  private readonly resultPane: Signal<TextEditor | undefined> = viewChild<TextEditor>('result');

  /**
   * Holds which panes' editors are ready, so their highlights are drawn once they can be.
   */
  private readonly readyPanes: WritableSignal<ReadonlySet<ConflictPane>> = signal<
    ReadonlySet<ConflictPane>
  >(new Set<ConflictPane>());

  /**
   * Holds the lens drawing the file's conflicts and their rows, once the file's pane is ready.
   */
  private lens: ConflictLens | null = null;

  /**
   * Holds each side pane's highlights, created as the pane becomes ready.
   */
  private readonly highlights: Map<SidePane, MonacoApi.editor.IEditorDecorationsCollection> =
    new Map<SidePane, MonacoApi.editor.IEditorDecorationsCollection>();

  /**
   * Holds the subscriptions to the panes' scrolling.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Holds whether the panes are being scrolled to follow one another, so a pane moved to follow does
   * not in turn move the one it followed.
   */
  private following: boolean = false;

  /**
   * Holds the reveal request last acted on, so each is acted on once.
   */
  private revealed: number = 0;

  /**
   * Gets whether the common ancestor's pane is wanted, when the file has one.
   */
  protected readonly baseWanted: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets whether the last Mark Resolved was refused for the conflicts left in the file, so the strip
   * offers Mark Resolved Anyway.
   */
  protected readonly refused: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether a Mark Resolved is on its way.
   */
  protected readonly marking: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the file's absolute path, or null for a panel no merge tool was opened for.
   */
  protected readonly path: Signal<string | null> = computed((): string | null =>
    this.mergeTools.pathOf(this.panel().id),
  );

  /**
   * Gets the file's document, or undefined once its tab has been closed.
   */
  protected readonly document: Signal<CodeDocument | undefined> = computed(
    (): CodeDocument | undefined => {
      const path: string | null = this.path();
      return path === null
        ? undefined
        : this.documents.list().find((candidate: CodeDocument): boolean => {
            return candidate.filePath() === path;
          });
    },
  );

  /**
   * Gets whether git wrote the user's own work below the divider (a rebase).
   */
  private readonly swapped: Signal<boolean> = computed(
    (): boolean => this.conflictContext?.conflictMarkersSwapped() ?? false,
  );

  /**
   * Gets the names of the two sides.
   */
  private readonly sides: Signal<ConflictSides> = computed(
    (): ConflictSides => this.conflictContext?.conflictSides() ?? { yours: null, theirs: null },
  );

  /**
   * Gets the side panes' text and where each conflict sits in each, read from the file as it stands.
   */
  protected readonly versions: Signal<ConflictVersions> = computed(
    (): ConflictVersions => conflictVersions(this.document()?.content() ?? '', this.swapped()),
    {
      // The panes rebuild only when what they show changes, not on every keystroke outside a conflict.
      equal: (left: ConflictVersions, right: ConflictVersions): boolean =>
        left.yours === right.yours &&
        left.theirs === right.theirs &&
        left.base === right.base &&
        left.regions.length === right.regions.length &&
        left.regions.every(
          (region: ConflictRegion, index: number): boolean =>
            region.result.start === right.regions[index].result.start &&
            region.result.count === right.regions[index].result.count,
        ),
    },
  );

  /**
   * Gets how many conflicts the file still holds.
   */
  protected readonly conflictCount: Signal<number> = computed(
    (): number => this.versions().regions.length,
  );

  /**
   * Gets whether the file has a common ancestor to show: git wrote diff3 base sections for every
   * conflict.
   */
  protected readonly hasBase: Signal<boolean> = computed(
    (): boolean => this.versions().base !== null,
  );

  /**
   * Gets whether the common ancestor's pane is shown.
   */
  protected readonly showingBase: Signal<boolean> = computed(
    (): boolean => this.hasBase() && this.baseWanted(),
  );

  /**
   * Gets the user's side's heading: the branch by name, with its role.
   */
  protected readonly yoursTitle: Signal<string> = computed((): string => {
    const name: string | null = this.sides().yours;
    return name === null
      ? $localize`:Heading of the merge tool's pane showing the user's own side:Yours`
      : $localize`:Heading of the merge tool's pane showing the user's own side; the placeholder is a branch:${name}:branch: (Yours)`;
  });

  /**
   * Gets the other side's heading: the branch by name, with its role.
   */
  protected readonly theirsTitle: Signal<string> = computed((): string => {
    const name: string | null = this.sides().theirs;
    return name === null
      ? $localize`:Heading of the merge tool's pane showing the other side:Theirs`
      : $localize`:Heading of the merge tool's pane showing the other side; the placeholder is a branch:${name}:branch: (Theirs)`;
  });

  /**
   * Gets the common ancestor's heading.
   */
  protected readonly baseTitle: string = $localize`:Heading of the merge tool's pane showing the version both sides started from:Common Ancestor`;

  /**
   * Gets the file's heading.
   */
  protected readonly resultTitle: Signal<string> = computed((): string => {
    const name: string = this.document()?.fileName() ?? '';
    return $localize`:Heading of the merge tool's editable pane; the placeholder is the file's name:Result — ${name}:name:`;
  });

  /**
   * Gets what the strip says about the conflicts left.
   */
  protected readonly countText: Signal<string> = computed((): string => {
    const count: number = this.conflictCount();
    if (count === 0) {
      return $localize`:The merge tool's strip once the file has no conflicts left:No conflicts left`;
    }
    return count === 1
      ? $localize`:The merge tool's strip while the file has one conflict:1 conflict left`
      : $localize`:The merge tool's strip while the file has several conflicts:${count}:count: conflicts left`;
  });

  /**
   * Gets whether Mark Resolved is on offer: the file is one git left conflicted.
   */
  protected readonly canMarkResolved: Signal<boolean> = computed((): boolean => {
    const path: string | null = this.path();
    return path !== null && (this.conflictContext?.isConflicted(path) ?? false);
  });

  /**
   * Gets the tooltips the strip's buttons carry.
   */
  protected readonly tooltips: {
    readonly previous: string;
    readonly next: string;
    readonly base: string;
    readonly markResolved: string;
    readonly anyway: string;
  } = {
    previous: $localize`:Tooltip of the merge tool's Previous Conflict button:Previous conflict`,
    next: $localize`:Tooltip of the merge tool's Next Conflict button:Next conflict`,
    base: $localize`:Tooltip of the merge tool's button showing or hiding the common ancestor:Show the version both sides started from`,
    markResolved: $localize`:Tooltip of the merge tool's Mark Resolved button:Save the file and mark it resolved — refused while conflicts are left`,
    anyway: $localize`:Tooltip of the merge tool's Mark Resolved Anyway button:Stage the file as it is, conflict markers and all`,
  };

  /**
   * Initializes a new instance of the {@link MergeToolPanel} class, keeping the side panes' highlights
   * on their conflicts and acting on requests to bring a conflict into view.
   */
  public constructor() {
    effect((): void => {
      const versions: ConflictVersions = this.versions();
      const ready: ReadonlySet<ConflictPane> = this.readyPanes();
      untracked((): void => this.highlightSides(versions, ready));
    });
    effect((): void => {
      const request: MergeToolReveal | null = this.mergeTools.reveal();
      const ready: boolean = this.readyPanes().has('result');
      if (request === null || !ready || request.panelId !== this.panel().id) {
        return;
      }
      if (request.sequence !== this.revealed) {
        this.revealed = request.sequence;
        untracked((): void => this.revealConflict(request.index));
      }
    });
    // Redraw the rows when what they say changes: the sides' names, or whether the file is conflicted.
    effect((): void => {
      this.sides();
      this.swapped();
      this.canMarkResolved();
      untracked((): void => this.lens?.refresh());
    });
    inject(DestroyRef).onDestroy((): void => this.dispose());
  }

  /**
   * Releases the lens, the highlights and the scroll subscriptions.
   */
  public ngOnDestroy(): void {
    this.dispose();
  }

  /**
   * Moves to the next or previous conflict in the file, the panes beside it following.
   * @param direction Which way to go.
   */
  protected goTo(direction: 'next' | 'previous'): void {
    this.lens?.goTo(direction);
  }

  /**
   * Shows or hides the common ancestor's pane.
   */
  protected toggleBase(): void {
    this.baseWanted.update((wanted: boolean): boolean => !wanted);
  }

  /**
   * Carries an edit of the file into its document.
   * @param text The file's new content.
   */
  protected onResultChange(text: string): void {
    const document: CodeDocument | undefined = this.document();
    if (document !== undefined) {
      this.documents.setContent(document.id, text);
      this.refused.set(false);
    }
  }

  /**
   * Hears that a pane's editor is ready: the file's gets the lens, and every pane follows the others'
   * scrolling.
   * @param pane The pane.
   */
  protected onPaneReady(pane: ConflictPane): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf(pane);
    if (editor === null) {
      return;
    }
    if (pane !== 'result') {
      // A pane shown again (the common ancestor's) is a new editor; its old highlights went with the
      // old one.
      this.highlights.delete(pane);
    } else {
      this.lens?.dispose();
      this.lens = new ConflictLens(editor, {
        labels: (): ConflictLensLabels =>
          untracked((): ConflictLensLabels => ({
            yours: keepSideLabel('yours', this.sides()),
            theirs: keepSideLabel('theirs', this.sides()),
            swapped: this.swapped(),
          })),
        // The strip above offers Mark Resolved here, so the file's top does not repeat it.
        canMarkResolved: (): boolean => false,
        markResolved: (): void => undefined,
        countChanged: (): void => undefined,
      });
    }
    this.subscriptions.push(
      editor.onDidScrollChange((event: MonacoApi.IScrollEvent): void => {
        if (event.scrollTopChanged) {
          this.follow(pane);
        }
      }),
    );
    this.readyPanes.update((ready: ReadonlySet<ConflictPane>): ReadonlySet<ConflictPane> =>
      new Set<ConflictPane>(ready).add(pane),
    );
  }

  /**
   * Saves the file and marks it resolved, refusing while it still holds conflicts unless told the
   * markers are meant.
   * @param anyway Whether to mark it resolved whatever it still holds.
   */
  protected async markResolved(anyway: boolean): Promise<void> {
    const path: string | null = this.path();
    const document: CodeDocument | undefined = this.document();
    const context: ConflictContext | null = this.conflictContext;
    if (path === null || document === undefined || context === null) {
      return;
    }
    if (!anyway && this.conflictCount() > 0) {
      // Refused before anything is saved or staged, the same refusal the Commit panel makes.
      this.refused.set(true);
      return;
    }
    this.marking.set(true);
    try {
      // Git stages what is on disk, so what is in the editor is written first.
      if (document.dirty() && !(await this.documents.save(document.id))) {
        return;
      }
      const result: { readonly success: boolean; readonly error?: string } =
        await context.markResolved([path], anyway);
      this.refused.set(!result.success && !anyway);
      if (!result.success) {
        this.log.warn('MergeToolPanel', 'Mark resolved was refused', path, result.error);
      }
    } finally {
      this.marking.set(false);
    }
  }

  /**
   * Gets a pane's Monaco editor, once it is ready.
   * @param pane The pane.
   * @returns Returns the editor, or null.
   */
  private editorOf(pane: ConflictPane): MonacoApi.editor.IStandaloneCodeEditor | null {
    const panes: Readonly<Record<ConflictPane, Signal<TextEditor | undefined>>> = {
      yours: this.yoursPane,
      base: this.basePane,
      theirs: this.theirsPane,
      result: this.resultPane,
    };
    return panes[pane]()?.getEditor() ?? null;
  }

  /**
   * Tints each conflict's section in the side panes, as the code editor tints it in the file.
   * @param versions The side panes' text and the conflicts' places.
   * @param ready The panes whose editors are ready.
   */
  private highlightSides(versions: ConflictVersions, ready: ReadonlySet<ConflictPane>): void {
    for (const pane of ['yours', 'base', 'theirs'] as const) {
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = ready.has(pane)
        ? this.editorOf(pane)
        : null;
      if (editor === null) {
        continue;
      }
      let collection: MonacoApi.editor.IEditorDecorationsCollection | undefined =
        this.highlights.get(pane);
      if (collection === undefined) {
        collection = editor.createDecorationsCollection([]);
        this.highlights.set(pane, collection);
      }
      collection.set(
        versions.regions
          .map((region: ConflictRegion): ConflictLineSpan | null => region[pane])
          .filter(
            (span: ConflictLineSpan | null): span is ConflictLineSpan =>
              span !== null && span.count > 0,
          )
          .map((span: ConflictLineSpan): MonacoApi.editor.IModelDeltaDecoration => ({
            range: {
              startLineNumber: span.start,
              startColumn: 1,
              endLineNumber: span.start + span.count - 1,
              endColumn: 1,
            },
            options: { isWholeLine: true, className: SIDE_CLASSES[pane] },
          })),
      );
    }
  }

  /**
   * Scrolls every other pane to the lines beside the ones a pane now shows at its top.
   * @param source The pane that scrolled.
   */
  private follow(source: ConflictPane): void {
    if (this.following) {
      return;
    }
    const from: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf(source);
    const top: number | undefined = from?.getVisibleRanges()[0]?.startLineNumber;
    if (from === null || top === undefined) {
      return;
    }
    const regions: readonly ConflictRegion[] = this.versions().regions;
    this.following = true;
    try {
      for (const pane of ['yours', 'base', 'theirs', 'result'] as const) {
        const editor: MonacoApi.editor.IStandaloneCodeEditor | null =
          pane === source ? null : this.editorOf(pane);
        if (editor !== null) {
          editor.setScrollTop(
            editor.getTopForLineNumber(mapConflictLine(top, regions, source, pane)),
          );
        }
      }
    } finally {
      this.following = false;
    }
  }

  /**
   * Brings a conflict into view in the file, the panes beside it following.
   * @param index The conflict's position, counting from 0.
   */
  private revealConflict(index: number): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editorOf('result');
    const region: ConflictRegion | undefined = this.versions().regions[index];
    if (editor === null || region === undefined) {
      return;
    }
    editor.setPosition({ lineNumber: region.result.start, column: 1 });
    editor.revealLineNearTop(region.result.start);
    editor.focus();
    this.follow('result');
  }

  /**
   * Releases the lens, the highlights and the scroll subscriptions. Safe to call twice.
   */
  private dispose(): void {
    this.lens?.dispose();
    this.lens = null;
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
    for (const collection of this.highlights.values()) {
      collection.clear();
    }
    this.highlights.clear();
  }
}
