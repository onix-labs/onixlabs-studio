import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindRequest, FindScope } from '@shared/angular/components/find-panel/find-request';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { ReplaceFailure, ReplaceResponse } from '@shared/api/search-channels';
import { SearchAdapter, SearchReplaceOutcome } from './search-adapter';
import { SearchResultsTree } from './search-results-tree';

/**
 * Labels each scope as the scope dropdown offers it (#1007).
 */
export const FIND_SCOPE_LABELS: Readonly<Record<FindScope, string>> = {
  workspace: 'Whole Workspace',
  project: 'Current Project',
  'open-files': 'Open Files',
  file: 'Current File',
  selection: 'Current Selection',
};

/**
 * The scope a request falls back to when the one it asks for has nothing to search: Current Selection
 * without a selection is Current File, Current File without a file is Open Files, and Current Project
 * without a project is the Whole Workspace.
 */
const SCOPE_FALLBACK: Readonly<Partial<Record<FindScope, FindScope>>> = {
  selection: 'file',
  file: 'open-files',
  project: 'workspace',
};

/**
 * Resolves no paths: what a surface with no files on disk says is unsaved.
 * @returns Returns an empty set.
 */
const NO_UNSAVED_PATHS: () => ReadonlySet<string> = (): ReadonlySet<string> => new Set<string>();

/**
 * Names the view's two forms, chosen by the strip's toggles.
 */
export type SearchViewMode = 'find' | 'replace';

/**
 * Studio's Find & Replace, as one view wherever it is asked for (#1007): the workspace's Search panel,
 * and a code tab, a binary tab's disassembly or an API Explorer request outside a workspace. The host
 * supplies the {@link SearchAdapter} that searches, the scopes it offers, and each find request; the
 * view holds the query, the options and the form, and draws the results.
 *
 * Its tool strip (#882) holds two toggles — Find and Replace — in the Terminal strip's style; each
 * shows its own form beneath the strip, and the rest of the view is the results. The two forms share
 * one query and one set of options, so moving from finding to replacing keeps what was found. A host
 * whose editor cannot be changed offers no Replace.
 *
 * ⛔ A search runs when asked — the Find button, or Enter in a field — never on each keystroke: a
 * workspace search crawls every file under the root. Changing a match option or the scope re-runs the
 * search last asked for, since it refines it.
 *
 * Choosing a match takes the editor to it: the adapter opens or brings forward its editor, selects the
 * match, centres it and gives the editor focus. The replace form previews what it would do, row by row:
 * Replace changes the selected match and moves to the next, Replace All changes every match listed. ⛔
 * A file on disk open with unsaved edits is never replaced under the user — it is skipped and named, so
 * their edits are neither overwritten nor met with a conflict they did not cause.
 */
@Component({
  selector: 'app-search-view',
  imports: [
    AppIcon,
    Button,
    ButtonRow,
    Checkbox,
    Dropdown,
    PanelToolbar,
    SearchResultsTree,
    TextField,
  ],
  templateUrl: './search-view.html',
  styleUrl: './search-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchView implements OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the adapter the view drives, searching whichever scope is chosen.
   */
  public readonly adapter: InputSignal<SearchAdapter> = input.required<SearchAdapter>();

  /**
   * Gets the scopes the dropdown offers, in the order it lists them.
   */
  public readonly scopes: InputSignal<readonly FindScope[]> =
    input.required<readonly FindScope[]>();

  /**
   * Gets the offered scopes with nothing to search, which the dropdown shows but will not choose.
   */
  public readonly disabledScopes: InputSignal<ReadonlySet<FindScope>> = input<
    ReadonlySet<FindScope>
  >(new Set<FindScope>());

  /**
   * Gets the latest find request — from ⌘F / ⌘⌥F, a strip or a menu — or null before any. Each new
   * request object is answered once: it chooses the form and scope, seeds the query, searches when
   * there is a query, and puts the cursor in the find field.
   */
  public readonly request: InputSignal<FindRequest | null> = input<FindRequest | null>(null);

  /**
   * Gets whether the host's text can be replaced; false hides the Replace toggle and keeps the view
   * to finding (a read-only editor).
   */
  public readonly replaceable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the Find toggle's label.
   */
  public readonly findLabel: InputSignal<string> = input<string>('Find');

  /**
   * Gets the Replace toggle's label.
   */
  public readonly replaceLabel: InputSignal<string> = input<string>('Replace');

  /**
   * Gets the resolver of the absolute paths of files open with unsaved edits, which a replace on disk
   * leaves alone. Read when a replace runs.
   */
  public readonly unsavedPaths: InputSignal<() => ReadonlySet<string>> =
    input<() => ReadonlySet<string>>(NO_UNSAVED_PATHS);

  /**
   * Holds the notification centre a replace reports its outcome to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger, which records why a replace failed.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the chosen scope.
   */
  protected readonly scope: Signal<FindScope> = computed((): FindScope => this.adapter().scope());

  /**
   * Gets the dropdown's options, those with nothing to search disabled.
   */
  protected readonly scopeOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const disabled: ReadonlySet<FindScope> = this.disabledScopes();
      return this.scopes().map((scope: FindScope): DropdownOption => ({
        value: scope,
        label: FIND_SCOPE_LABELS[scope],
        ...(disabled.has(scope) ? { disabled: true } : {}),
      }));
    },
  );

  /**
   * Holds which form the strip's toggles have chosen. Find, until the user asks to replace.
   */
  private readonly requestedMode: WritableSignal<SearchViewMode> = signal<SearchViewMode>('find');

  /**
   * Gets the form shown: the one chosen, or Find where nothing can be replaced.
   */
  protected readonly mode: Signal<SearchViewMode> = computed((): SearchViewMode =>
    this.replaceable() ? this.requestedMode() : 'find',
  );

  /**
   * Holds the find text in the field, which is not a search until it is asked for.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the replacement text in the replace form's field.
   */
  protected readonly replacement: WritableSignal<string> = signal<string>('');

  /**
   * Holds the text last searched for, or null before any search — what an option change re-runs.
   */
  private readonly searched: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the search is case-sensitive.
   */
  protected readonly caseSensitive: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the search matches whole words only.
   */
  protected readonly wholeWord: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the text is a regular expression.
   */
  protected readonly regexp: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the matches for the last search.
   */
  protected readonly matches: Signal<readonly FindResultItem[]> = computed(
    (): readonly FindResultItem[] => this.adapter().matches(),
  );

  /**
   * Gets whether the results preview their replacement: in the replace form.
   */
  protected readonly previewsReplacement: Signal<boolean> = computed(
    (): boolean => this.mode() === 'replace',
  );

  /**
   * Holds whether a replace is under way, during which neither replace button runs another.
   */
  private readonly replacing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether Replace can run: a match is selected, it can be changed, and no replace is under way.
   */
  protected readonly canReplace: Signal<boolean> = computed(
    (): boolean =>
      this.adapter().activeIndex() >= 0 && !this.replacing() && this.adapter().activeReplaceable(),
  );

  /**
   * Gets whether Replace All can run: there are changeable results and no replace is under way.
   */
  protected readonly canReplaceAll: Signal<boolean> = computed(
    (): boolean =>
      this.matches().length > 0 && !this.replacing() && this.adapter().hasReplaceable(),
  );

  /**
   * Gets the summary beside the form's buttons, or empty before anything has been searched for.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const searched: string | null = this.searched();
    if (searched === null || searched.length === 0) {
      return '';
    }
    const count: number = this.matches().length;
    if (count === 0) {
      return 'No results';
    }
    const files: number = new Set<string | undefined>(
      this.matches().map((item: FindResultItem): string | undefined => item.file),
    ).size;
    return `${count} ${count === 1 ? 'result' : 'results'} in ${files} ${files === 1 ? 'file' : 'files'}`;
  });

  /**
   * Gets whether there are results to fold, which is what the strip's Expand and Collapse All act on.
   */
  protected readonly hasResults: Signal<boolean> = computed(
    (): boolean => this.matches().length > 0,
  );

  /**
   * Holds the find field's host element, focused when the view opens or a form is chosen.
   */
  private readonly findField: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('findField');

  /**
   * Holds the results tree, which the strip's Expand and Collapse All fold and a new search opens.
   */
  private readonly resultsTree: Signal<SearchResultsTree | undefined> =
    viewChild<SearchResultsTree>(SearchResultsTree);

  /**
   * Initializes a new instance of the {@link SearchView} class, focusing the find field once rendered
   * (the view is opened to be typed into) and answering each find request as it arrives.
   */
  public constructor() {
    afterNextRender((): void => this.focusFind());

    effect((): void => {
      const request: FindRequest | null = this.request();
      if (request !== null) {
        untracked((): void => this.answer(request));
      }
    });
  }

  /**
   * Chooses where to search from the dropdown, and searches there again.
   * @param value The chosen scope.
   */
  protected chooseScope(value: string): void {
    this.adapter().setScope(value as FindScope);
    this.optionChanged();
  }

  /**
   * Shows one of the two forms, keeping the query and options the other was using.
   * @param mode The form to show.
   */
  protected show(mode: SearchViewMode): void {
    this.requestedMode.set(mode);
    queueMicrotask((): void => this.focusFind());
  }

  /**
   * Runs the search for the text in the find field, with the current options.
   */
  protected find(): void {
    this.searched.set(this.draft());
    // A new search starts with every file open: a fold made in the last one says nothing about this.
    this.resultsTree()?.expandAll();
    this.run();
  }

  /**
   * Re-runs the last search after a match option or the scope changed.
   */
  protected optionChanged(): void {
    if (this.searched() !== null) {
      this.run();
    }
  }

  /**
   * Opens every file in the results, showing all their matches.
   */
  protected expandAll(): void {
    this.resultsTree()?.expandAll();
  }

  /**
   * Folds every file in the results, leaving one row per file.
   */
  protected collapseAll(): void {
    this.resultsTree()?.collapseAll();
  }

  /**
   * Replaces the selected match and moves to the next — unless its file is on disk with unsaved edits.
   */
  protected async replaceSelected(): Promise<void> {
    const adapter: SearchAdapter = this.adapter();
    const path: string | null = adapter.activePath();
    if (path === null || !this.canReplace()) {
      return;
    }
    if (adapter.onDisk() && this.unsavedPaths()().has(path)) {
      this.notifications.notify({
        severity: 'warning',
        title: `Save “${baseName(path)}” first`,
        detail: 'It has unsaved edits, so the match was not replaced.',
      });
      return;
    }
    await this.replaceWith(
      (): SearchReplaceOutcome | Promise<SearchReplaceOutcome> =>
        adapter.replaceMatch(this.replacement()),
      [],
    );
  }

  /**
   * Replaces every match listed, but for files on disk with unsaved edits.
   */
  protected async replaceEvery(): Promise<void> {
    if (!this.canReplaceAll()) {
      return;
    }
    const adapter: SearchAdapter = this.adapter();
    // Only a disk replace skips unsaved files: in the editors, the replace joins their unsaved edits.
    const unsaved: ReadonlySet<string> = adapter.onDisk()
      ? this.unsavedPaths()()
      : new Set<string>();
    const skipped: readonly string[] = adapter
      .paths()
      .filter((path: string): boolean => unsaved.has(path));
    await this.replaceWith(
      (): SearchReplaceOutcome | Promise<SearchReplaceOutcome> =>
        adapter.replaceFiles(this.replacement(), new Set<string>(skipped)),
      skipped,
    );
  }

  /**
   * Clears the results when the view goes, so nothing stays highlighted behind it.
   */
  public ngOnDestroy(): void {
    this.adapter().clear();
  }

  /**
   * Hands the last searched-for text and the current options to the adapter.
   */
  private run(): void {
    const query: FindQuery = {
      text: this.searched() ?? '',
      caseSensitive: this.caseSensitive(),
      wholeWord: this.wholeWord(),
      regexp: this.regexp(),
    };
    this.adapter().setQuery(query);
  }

  /**
   * Runs a replace, holding the buttons off while it runs, and reports what it did.
   * @param replace Runs the replace.
   * @param skipped The files left alone for their unsaved edits.
   */
  private async replaceWith(
    replace: () => SearchReplaceOutcome | Promise<SearchReplaceOutcome>,
    skipped: readonly string[],
  ): Promise<void> {
    this.replacing.set(true);
    try {
      const response: SearchReplaceOutcome = await replace();
      this.report(response ?? { replaced: 0, files: 0, failed: [] }, skipped);
    } catch (error: unknown) {
      this.log.error('SearchView', 'Replace failed', error);
      this.notifications.notify({
        severity: 'error',
        title: 'Could not replace',
        detail: 'The files could not be reached.',
      });
    } finally {
      this.replacing.set(false);
    }
  }

  /**
   * Reports a replace's outcome: what changed, and every file that was left alone and why.
   * @param response What the replace did.
   * @param skipped The files left alone for their unsaved edits.
   */
  private report(response: ReplaceResponse, skipped: readonly string[]): void {
    const notes: string[] = [
      ...skipped.map((path: string): string => `${baseName(path)} has unsaved edits.`),
      ...response.failed.map(
        (failure: ReplaceFailure): string => `${baseName(failure.path)}: ${failure.reason}`,
      ),
    ];
    const replaced: number = response.replaced;
    const title: string =
      replaced === 0
        ? 'Nothing was replaced'
        : `Replaced ${replaced} ${replaced === 1 ? 'match' : 'matches'} in ${response.files} ${response.files === 1 ? 'file' : 'files'}`;
    this.notifications.notify({
      severity: notes.length > 0 ? 'warning' : 'success',
      title,
      ...(notes.length > 0 ? { detail: notes.join(' ') } : {}),
    });
  }

  /**
   * Answers a find request (#1007): chooses its form and scope, seeds the query, searches when there is
   * a query, and puts the cursor in the find field.
   * @param request The request.
   */
  private answer(request: FindRequest): void {
    this.log.debug('SearchView', 'Find requested', request.mode, request.scope);
    this.requestedMode.set(request.mode);
    this.adapter().setScope(this.available(request.scope));
    if (request.seed !== undefined) {
      this.draft.set(request.seed);
    }
    if (this.draft().length > 0) {
      this.find();
    }
    queueMicrotask((): void => this.focusFind());
  }

  /**
   * Narrows a requested scope to one offered with something to search, following
   * {@link SCOPE_FALLBACK}, else the first such scope offered.
   * @param scope The requested scope.
   * @returns Returns the scope to search.
   */
  private available(scope: FindScope): FindScope {
    const usable: (candidate: FindScope) => boolean = (candidate: FindScope): boolean =>
      this.scopes().includes(candidate) && !this.disabledScopes().has(candidate);
    for (
      let candidate: FindScope | undefined = scope;
      candidate !== undefined;
      candidate = SCOPE_FALLBACK[candidate]
    ) {
      if (usable(candidate)) {
        return candidate;
      }
    }
    return this.scopes().find(usable) ?? scope;
  }

  /**
   * Puts the cursor in the find field, its text selected so typing replaces it.
   */
  private focusFind(): void {
    const field: HTMLInputElement | null | undefined =
      this.findField()?.nativeElement.querySelector('input');
    field?.focus();
    field?.select();
  }
}

/**
 * Gets the last segment of a path, its file name.
 * @param path The path.
 * @returns Returns the file name.
 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
