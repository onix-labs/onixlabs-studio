import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiEnvironment, ApiFolder, ApiRequest } from '@shared/api/api-client-types';
import { ApiPrompts } from '../../api-prompts/api-prompts';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../../api-workspace/api-workspace';

/**
 * The commands offered by the toolbar's more-actions menu.
 */
const ACTION_NEW_COLLECTION: string = 'new-collection';
const ACTION_NEW_ENVIRONMENT: string = 'new-environment';
const ACTION_NEW_REQUEST: string = 'new-request';

/**
 * The commands offered by a row's context menu.
 */
const ACTION_RENAME: string = 'rename';
const ACTION_DUPLICATE: string = 'duplicate';
const ACTION_DELETE: string = 'delete';
const ACTION_ACTIVATE: string = 'activate';

/**
 * A row awaiting a rename or a delete, remembered while its dialog is open.
 *
 * The row's kind travels with its id because the three kinds are stored separately — a request, a
 * collection and an environment are different collections in {@link ApiWorkspace}, so an id alone
 * would not say which one to act on.
 */
interface RowTarget {
  /**
   * Gets what the row stands for.
   */
  readonly kind: ApiRowKind;

  /**
   * Gets the row's identifier.
   */
  readonly id: string;

  /**
   * Gets the row's current label, used to name it in the dialog.
   */
  readonly label: string;
}

/**
 * Determines whether a label matches the search query.
 * @param label The row's label.
 * @param query The lower-cased query.
 * @returns Returns true when the label contains the query.
 */
function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query);
}

/**
 * The identifier of the synthetic row that groups the environments. Synthetic because environments
 * are not folders — they are a second kind of thing the tree shows, given one collapsible home rather
 * than a panel of their own.
 */
const ENVIRONMENTS_ROW: string = 'environments';

/**
 * What a tree row stands for, so the projected row template can render each kind and the click
 * handler can act on it.
 */
type ApiRowKind = 'group' | 'environment' | 'collection' | 'request';

/**
 * The payload carried by each {@link TreeRow} in the API Explorer.
 */
interface ApiRow {
  /**
   * Gets what the row stands for.
   */
  readonly kind: ApiRowKind;

  /**
   * Gets the row's display label.
   */
  readonly label: string;

  /**
   * Gets the HTTP method, for a request row.
   */
  readonly method?: string;

  /**
   * Gets whether the row is the active environment.
   */
  readonly active?: boolean;
}

/**
 * The API Explorer's tree: the environments and the saved collections of one API Explorer tab. It is
 * the direct analog of the workspace's File Explorer — same {@link ExplorerToolbar}, same
 * {@link TreeView}, same tool-panel role, same "click a leaf to open it in the well" contract — with
 * requests where files would be. Wearing the same strip is the point: search, expand-all,
 * collapse-all and the more-actions menu sit exactly where a user has already learnt to find them in
 * the Solution and File Explorers, and this panel's own commands (new collection, environment and
 * request) hang off that menu rather than crowding the strip with three labelled buttons.
 *
 * Environments live in this tree rather than in a panel of their own because the user reaches for them
 * in the same breath as the request they are about to send. Activating one here is what every
 * subsequent send resolves its `{{variables}}` against.
 */
@Component({
  selector: 'app-api-explorer-panel',
  imports: [AppIcon, ExplorerToolbar, TreeView, Modal, ModalContent, Button, TextField],
  templateUrl: './api-explorer-panel.html',
  styleUrl: './api-explorer-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiExplorerPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the API workspace the tree presents.
   */
  protected readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the opener that puts a request into the API well.
   */
  private readonly opener: ApiRequestOpener = inject(ApiRequestOpener);

  /**
   * Holds the naming dialogs the more-actions menu raises. They are the view's, not this panel's, so
   * the ribbon's New group raises exactly the same ones.
   */
  private readonly prompts: ApiPrompts = inject(ApiPrompts);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the ids of the expanded rows. Collections and the environments group start expanded, so the
   * tree opens showing what is in it rather than needing to be unfolded first.
   */
  private readonly expanded: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>([ENVIRONMENTS_ROW]),
  );

  /**
   * Holds the id of the selected row.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the collections this panel has already seen, seeded with those present when it mounts, so
   * that only genuinely new ones are unfolded.
   */
  private readonly seenCollections: Set<string> = new Set<string>();

  /**
   * Unfolds and selects a collection the moment it appears, wherever it was added from — this panel's
   * menu, the ribbon's New group, or the agent. The alternative is a collection that arrives folded
   * shut, which reads as nothing having happened.
   */
  public constructor() {
    effect((): void => {
      const roots: readonly ApiFolder[] = this.workspace
        .folders()
        .filter((folder: ApiFolder): boolean => folder.parentId === null);
      untracked((): void => {
        for (const root of roots) {
          if (this.seenCollections.has(root.id)) {
            continue;
          }
          this.seenCollections.add(root.id);
          this.expanded.update(
            (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, root.id]),
          );
          this.selectedId.set(root.id);
        }
      });
    });
  }

  /**
   * Gets whether there is a collection for a new request to go into.
   */
  protected readonly canAddRequest: Signal<boolean> = computed((): boolean =>
    this.workspace.folders().some((folder: ApiFolder): boolean => folder.parentId === null),
  );

  /**
   * Holds the search query the tree is filtered by, bound to the toolbar's search box.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the commands offered by the toolbar's more-actions menu. A request needs somewhere to go, so
   * its item is offered but disabled until a collection exists — rather than being hidden, which would
   * leave a user wondering where requests are added.
   */
  protected readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    { id: ACTION_NEW_COLLECTION, label: 'New Collection', icon: Icon.API_COLLECTION },
    { id: ACTION_NEW_ENVIRONMENT, label: 'New Environment', icon: Icon.API_ENVIRONMENT },
    {
      id: ACTION_NEW_REQUEST,
      label: 'New Request',
      icon: Icon.API_REQUEST,
      disabled: !this.canAddRequest(),
    },
  ]);

  /**
   * Gets the flattened rows of the tree: the environments group first, then each collection with its
   * requests beneath it.
   *
   * While a search is running the tree filters to what matches and shows every branch open, so a hit
   * three collections down is visible without unfolding anything; a collection that matches by name
   * brings its requests with it, since the match is the collection itself.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const query: string = this.query().trim().toLowerCase();
    const filtering: boolean = query !== '';
    const expanded: ReadonlySet<string> = this.expanded();
    const environments: readonly ApiEnvironment[] = this.workspace.environments();
    const activeId: string | null = this.workspace.activeEnvironmentId();
    const rows: TreeRow[] = [];

    const matchedEnvironments: readonly ApiEnvironment[] = filtering
      ? environments.filter((environment: ApiEnvironment): boolean =>
          matches(environment.name, query),
        )
      : environments;
    if (!filtering || matchedEnvironments.length > 0) {
      rows.push({
        id: ENVIRONMENTS_ROW,
        depth: 0,
        expandable: true,
        expanded: filtering || expanded.has(ENVIRONMENTS_ROW),
        data: { kind: 'group', label: 'Environments' } satisfies ApiRow,
      });
      if (filtering || expanded.has(ENVIRONMENTS_ROW)) {
        for (const environment of matchedEnvironments) {
          rows.push({
            id: environment.id,
            depth: 1,
            expandable: false,
            expanded: false,
            data: {
              kind: 'environment',
              label: environment.name,
              active: environment.id === activeId,
            } satisfies ApiRow,
          });
        }
      }
    }

    for (const collection of this.workspace
      .folders()
      .filter((folder: ApiFolder): boolean => folder.parentId === null)) {
      const held: readonly ApiRequest[] = this.workspace
        .requests()
        .filter((candidate: ApiRequest): boolean => candidate.parentId === collection.id);
      const collectionMatches: boolean = filtering && matches(collection.name, query);
      const matched: readonly ApiRequest[] =
        !filtering || collectionMatches
          ? held
          : held.filter((request: ApiRequest): boolean => matches(request.name, query));
      if (filtering && !collectionMatches && matched.length === 0) {
        continue;
      }

      rows.push({
        id: collection.id,
        depth: 0,
        expandable: true,
        expanded: filtering || expanded.has(collection.id),
        data: { kind: 'collection', label: collection.name } satisfies ApiRow,
      });
      if (!filtering && !expanded.has(collection.id)) {
        continue;
      }
      for (const request of matched) {
        rows.push({
          id: request.id,
          depth: 1,
          expandable: false,
          expanded: false,
          data: {
            kind: 'request',
            label: request.name,
            method: request.method,
          } satisfies ApiRow,
        });
      }
    }
    return rows;
  });

  /**
   * Holds the row being renamed, or null when the rename dialog is closed.
   */
  public readonly renameTarget: WritableSignal<RowTarget | null> = signal<RowTarget | null>(null);

  /**
   * Holds the name being typed into the rename dialog.
   */
  public readonly renameName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the row awaiting a delete confirmation, or null when none is pending.
   */
  public readonly deleteTarget: WritableSignal<RowTarget | null> = signal<RowTarget | null>(null);

  /**
   * Gets whether the rename dialog has a name worth applying.
   */
  protected readonly canRename: Signal<boolean> = computed(
    (): boolean => this.renameName().trim().length > 0,
  );

  /**
   * Gets what a delete would take with it, for the confirmation's supporting line.
   *
   * A collection carries its requests down with it, which is the one case where the consequence is
   * bigger than the row the user right-clicked — so it is stated, with the count, rather than left to
   * be discovered.
   */
  protected readonly deleteConsequence: Signal<string> = computed((): string => {
    const target: RowTarget | null = this.deleteTarget();
    if (target === null) {
      return '';
    }
    if (target.kind !== 'collection') {
      return 'This cannot be undone.';
    }
    const held: number = this.workspace
      .requests()
      .filter((request: ApiRequest): boolean => request.parentId === target.id).length;
    return held === 0
      ? 'This cannot be undone.'
      : `Its ${held} request${held === 1 ? '' : 's'} go with it. This cannot be undone.`;
  });

  /**
   * Builds a row's context-menu items.
   *
   * Bound as a value rather than a method, because the tree calls it as its item factory when a menu
   * opens — `this` must stay this component. The synthetic "Environments" header stands for nothing
   * that can be acted on, so it returns nothing and opens no menu at all.
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const data: ApiRow = treeRow.data as ApiRow;
    switch (data.kind) {
      case 'request':
        return [
          { id: ACTION_RENAME, label: 'Rename…', icon: Icon.PENCIL },
          { id: ACTION_DUPLICATE, label: 'Duplicate', icon: Icon.COPY },
          { id: 'api-menu.sep', label: '', separator: true },
          { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH, tone: 'danger' },
        ];
      case 'collection':
        return [
          { id: ACTION_NEW_REQUEST, label: 'New Request', icon: Icon.API_REQUEST },
          { id: ACTION_RENAME, label: 'Rename…', icon: Icon.PENCIL },
          { id: 'api-menu.sep', label: '', separator: true },
          { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH, tone: 'danger' },
        ];
      case 'environment':
        return [
          // Omitted rather than disabled on the active environment: activating what is already active
          // is not a command, and a permanently greyed row on the one environment the user reaches for
          // most reads as something broken.
          ...(data.active === true
            ? []
            : [{ id: ACTION_ACTIVATE, label: 'Set as Active', icon: Icon.API_ENVIRONMENT }]),
          { id: ACTION_RENAME, label: 'Rename…', icon: Icon.PENCIL },
          { id: ACTION_DUPLICATE, label: 'Duplicate', icon: Icon.COPY },
          { id: 'api-menu.sep', label: '', separator: true },
          { id: ACTION_DELETE, label: 'Delete', icon: Icon.TRASH, tone: 'danger' },
        ];
      default:
        return [];
    }
  };

  /**
   * Runs the command chosen from a row's context menu.
   * @param selection The chosen item and the row it was chosen for.
   */
  public onContextAction(selection: TreeMenuSelection): void {
    const data: ApiRow = selection.row.data as ApiRow;
    const target: RowTarget = { kind: data.kind, id: selection.row.id, label: data.label };
    switch (selection.itemId) {
      case ACTION_NEW_REQUEST:
        this.addRequestTo(selection.row.id);
        return;
      case ACTION_ACTIVATE:
        this.workspace.activateEnvironment(selection.row.id);
        return;
      case ACTION_RENAME:
        this.renameName.set(data.label);
        this.renameTarget.set(target);
        return;
      case ACTION_DUPLICATE:
        this.duplicate(target);
        return;
      case ACTION_DELETE:
        this.deleteTarget.set(target);
        return;
      default:
        return;
    }
  }

  /**
   * Duplicates a request or an environment, selecting the copy so it is where the user's attention
   * already is. A duplicated request also opens, since a copy is made in order to change it.
   * @param target The row to duplicate.
   */
  private duplicate(target: RowTarget): void {
    if (target.kind === 'request') {
      const copy: ApiRequest | null = this.workspace.duplicateRequest(target.id);
      if (copy !== null) {
        this.selectedId.set(copy.id);
        this.opener.open(copy.id);
      }
      return;
    }
    const copy: ApiEnvironment | null = this.workspace.duplicateEnvironment(target.id);
    if (copy !== null) {
      this.selectedId.set(copy.id);
    }
  }

  /**
   * Closes the rename dialog without applying it.
   */
  public cancelRename(): void {
    this.renameTarget.set(null);
  }

  /**
   * Applies the rename dialog's name to its row.
   */
  public confirmRename(): void {
    const target: RowTarget | null = this.renameTarget();
    const name: string = this.renameName().trim();
    if (target === null || name.length === 0) {
      return;
    }
    this.renameTarget.set(null);
    switch (target.kind) {
      case 'request':
        this.workspace.updateRequest(target.id, { name });
        return;
      case 'collection':
        this.workspace.renameFolder(target.id, name);
        return;
      case 'environment':
        this.workspace.renameEnvironment(target.id, name);
        return;
      default:
        return;
    }
  }

  /**
   * Closes the delete confirmation without deleting anything.
   */
  public cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Deletes the confirmed row.
   */
  public confirmDelete(): void {
    const target: RowTarget | null = this.deleteTarget();
    if (target === null) {
      return;
    }
    this.deleteTarget.set(null);
    switch (target.kind) {
      case 'request':
        this.workspace.removeRequest(target.id);
        return;
      case 'collection':
        this.workspace.removeFolder(target.id);
        return;
      case 'environment':
        this.workspace.removeEnvironment(target.id);
        return;
      default:
        return;
    }
  }

  /**
   * Opens every collection and the environments group.
   */
  protected expandAll(): void {
    const ids: string[] = this.workspace
      .folders()
      .filter((folder: ApiFolder): boolean => folder.parentId === null)
      .map((folder: ApiFolder): string => folder.id);
    this.expanded.set(new Set<string>([ENVIRONMENTS_ROW, ...ids]));
  }

  /**
   * Folds every branch of the tree.
   */
  protected collapseAll(): void {
    this.expanded.set(new Set<string>());
  }

  /**
   * Runs the command chosen from the toolbar's more-actions menu.
   * @param id The chosen command's identifier.
   */
  protected onMoreAction(id: string): void {
    switch (id) {
      case ACTION_NEW_COLLECTION:
        this.promptCollection();
        return;
      case ACTION_NEW_ENVIRONMENT:
        this.promptEnvironment();
        return;
      case ACTION_NEW_REQUEST:
        this.addRequest();
        return;
    }
  }

  /**
   * Handles a row click: folds a group, activates an environment, or opens a request in the well.
   * @param row The clicked row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: ApiRow = row.data as ApiRow;
    this.selectedId.set(row.id);
    if (row.expandable) {
      this.toggle(row.id);
      return;
    }
    if (data.kind === 'environment') {
      this.workspace.activateEnvironment(row.id);
      return;
    }
    if (data.kind === 'request') {
      this.opener.open(row.id);
    }
  }

  /**
   * Opens the dialog that names a new collection. The dialog is the view's, so this and the ribbon's
   * New group raise the same one.
   */
  protected promptCollection(): void {
    this.prompts.promptCollection();
  }

  /**
   * Opens the dialog that names a new environment and gives it a root address.
   */
  protected promptEnvironment(): void {
    this.prompts.promptEnvironment();
  }

  /**
   * Adds a request to the selected (or first) collection and opens it in the well, so the new request
   * is immediately editable rather than merely listed.
   */
  protected addRequest(): void {
    const collections: readonly ApiFolder[] = this.workspace
      .folders()
      .filter((folder: ApiFolder): boolean => folder.parentId === null);
    if (collections.length === 0) {
      return;
    }
    const selected: string | null = this.selectedId();
    const target: ApiFolder =
      collections.find((collection: ApiFolder): boolean => collection.id === selected) ??
      collections[0];
    this.addRequestTo(target.id);
  }

  /**
   * Adds a request to a named collection, expands it so the new row is visible, and opens the request
   * in the well.
   *
   * Split out from {@link addRequest} because the toolbar has to guess which collection was meant
   * while a row menu already knows: right-clicking a collection says exactly where the request goes.
   * @param collectionId The identifier of the collection to add to.
   */
  private addRequestTo(collectionId: string): void {
    const request: ApiRequest = this.workspace.addRequest(collectionId, { url: '{{base_url}}/' });
    this.expanded.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, collectionId]),
    );
    this.selectedId.set(request.id);
    this.opener.open(request.id);
  }

  /**
   * Toggles a row's expansion.
   * @param id The row identifier.
   */
  private toggle(id: string): void {
    this.expanded.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }
}
