import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiEnvironment, ApiFolder, ApiRequest } from '@shared/api/api-client-types';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace, newField } from '../../api-workspace/api-workspace';

/**
 * The variable an environment's root address is stored as. Requests are written against it, so a new
 * environment with an address is usable by every request that already exists.
 */
const BASE_URL_VARIABLE: string = 'base_url';

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
 * the direct analog of the workspace's File Explorer — same {@link TreeView}, same tool-panel role,
 * same "click a leaf to open it in the well" contract — with requests where files would be.
 *
 * Environments live in this tree rather than in a panel of their own because the user reaches for them
 * in the same breath as the request they are about to send. Activating one here is what every
 * subsequent send resolves its `{{variables}}` against.
 */
@Component({
  selector: 'app-api-explorer-panel',
  imports: [AppIcon, Button, Modal, ModalContent, PanelToolbar, TextField, TreeView],
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
   * Holds whether the new-collection dialog is open, and the name being typed into it.
   */
  protected readonly collectionOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name typed into the new-collection dialog.
   */
  protected readonly collectionName: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the new-environment dialog is open.
   */
  protected readonly environmentOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name typed into the new-environment dialog.
   */
  protected readonly environmentName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the root address typed into the new-environment dialog, stored as the environment's
   * `base_url` variable.
   */
  protected readonly environmentRootUrl: WritableSignal<string> = signal<string>('');

  /**
   * Gets the variable syntax shown in the new-environment dialog, written out rather than interpolated
   * so the braces survive the template.
   */
  protected readonly variableSyntax: string = '{{base_url}}';

  /**
   * Gets whether there is a collection for a new request to go into.
   */
  protected readonly canAddRequest: Signal<boolean> = computed((): boolean =>
    this.workspace.folders().some((folder: ApiFolder): boolean => folder.parentId === null),
  );

  /**
   * Gets the flattened rows of the tree: the environments group first, then each collection with its
   * requests beneath it.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<string> = this.expanded();
    const environments: readonly ApiEnvironment[] = this.workspace.environments();
    const activeId: string | null = this.workspace.activeEnvironmentId();
    const rows: TreeRow[] = [];

    rows.push({
      id: ENVIRONMENTS_ROW,
      depth: 0,
      expandable: true,
      expanded: expanded.has(ENVIRONMENTS_ROW),
      data: { kind: 'group', label: 'Environments' } satisfies ApiRow,
    });
    if (expanded.has(ENVIRONMENTS_ROW)) {
      for (const environment of environments) {
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

    for (const collection of this.workspace
      .folders()
      .filter((folder: ApiFolder): boolean => folder.parentId === null)) {
      rows.push({
        id: collection.id,
        depth: 0,
        expandable: true,
        expanded: expanded.has(collection.id),
        data: { kind: 'collection', label: collection.name } satisfies ApiRow,
      });
      if (!expanded.has(collection.id)) {
        continue;
      }
      for (const request of this.workspace
        .requests()
        .filter((candidate: ApiRequest): boolean => candidate.parentId === collection.id)) {
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
   * Opens the dialog that names a new collection.
   */
  protected promptCollection(): void {
    this.collectionName.set('');
    this.collectionOpen.set(true);
  }

  /**
   * Closes the new-collection dialog without adding anything.
   */
  protected cancelCollection(): void {
    this.collectionOpen.set(false);
  }

  /**
   * Adds the named collection and expands it, ready for its first request.
   */
  protected confirmCollection(): void {
    const name: string = this.collectionName().trim();
    if (name === '') {
      return;
    }
    const collection: ApiFolder = this.workspace.addCollection(name);
    this.collectionOpen.set(false);
    this.selectedId.set(collection.id);
    this.toggle(collection.id);
  }

  /**
   * Opens the dialog that names a new environment and gives it a root address.
   */
  protected promptEnvironment(): void {
    this.environmentName.set('');
    this.environmentRootUrl.set('');
    this.environmentOpen.set(true);
  }

  /**
   * Closes the new-environment dialog without adding anything.
   */
  protected cancelEnvironment(): void {
    this.environmentOpen.set(false);
  }

  /**
   * Adds the named environment, seeding it with the root address as its `base_url` variable — the
   * variable every seeded request is written against, so a new environment is immediately usable.
   */
  protected confirmEnvironment(): void {
    const name: string = this.environmentName().trim();
    if (name === '') {
      return;
    }
    const rootUrl: string = this.environmentRootUrl().trim();
    this.workspace.addEnvironment(
      name,
      rootUrl === '' ? [] : [newField(BASE_URL_VARIABLE, rootUrl)],
    );
    this.environmentOpen.set(false);
    this.expanded.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> =>
        new Set<string>([...ids, ENVIRONMENTS_ROW]),
    );
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
    const request: ApiRequest = this.workspace.addRequest(target.id, { url: '{{base_url}}/' });
    this.expanded.update(
      (ids: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...ids, target.id]),
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
