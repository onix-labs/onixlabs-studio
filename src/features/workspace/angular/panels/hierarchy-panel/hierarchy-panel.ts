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
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { symbolIcon } from '@shared/angular/services/go-to/go-to-model';
import {
  HIERARCHY_DIRECTIONS,
  HierarchyDirection,
  HierarchyNode,
  HierarchySource,
} from '@shared/angular/services/hierarchy/hierarchy';
import { Log } from '@shared/angular/services/log/log';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { HierarchyPanelState } from './hierarchy-panel-state';

/**
 * Gets the label of each direction, as the panel's switch shows it.
 */
const DIRECTION_LABELS: Readonly<Record<HierarchyDirection, string>> = {
  callers: 'Callers',
  callees: 'Callees',
  supertypes: 'Base Types',
  subtypes: 'Derived Types',
};

/**
 * Gets what the heading says each direction lists, before the root's name.
 */
const DIRECTION_HEADINGS: Readonly<Record<HierarchyDirection, string>> = {
  callers: 'Callers of ',
  callees: 'Calls from ',
  supertypes: 'Base types of ',
  subtypes: 'Types derived from ',
};

/**
 * Holds what is known of a node's children: still being asked for, found, or not found.
 */
type Children = 'loading' | 'failed' | readonly HierarchyNode[];

/**
 * Describes what a hierarchy row shows: a node, or a note under one still loading or that failed.
 */
export type HierarchyRow =
  | { readonly kind: 'node'; readonly node: HierarchyNode }
  | { readonly kind: 'note'; readonly text: string };

/**
 * Shows a workspace tab's call or type hierarchy (#1153): the symbol it was asked for at the top, and
 * a level at a time beneath it — a member's callers or callees, a type's base or derived types — each
 * level asked of the language server only when its row is expanded. Choosing a row opens the symbol
 * and expands or folds it; the switch in the strip walks the other way from the same root.
 */
@Component({
  selector: 'app-hierarchy-panel',
  imports: [AppIcon, ButtonGroup, PanelToolbar, TreeView],
  templateUrl: './hierarchy-panel.html',
  styleUrl: './hierarchy-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HierarchyPanel {
  /**
   * Gets the dock panel this component renders.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the hierarchy shown.
   */
  private readonly state: HierarchyPanelState = inject(HierarchyPanelState);

  /**
   * Holds the navigation that opens a chosen symbol.
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Exposes the icon registry to the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the hierarchy shown.
   */
  protected readonly source: Signal<HierarchySource | null> = this.state.source;

  /**
   * Holds the way the hierarchy is walked.
   */
  protected readonly direction: WritableSignal<HierarchyDirection> =
    signal<HierarchyDirection>('callers');

  /**
   * Holds the rows expanded, by row id: a node's path of indices from its root.
   */
  private readonly expanded: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds what is known of each expanded row's children, by row id.
   */
  private readonly children: WritableSignal<ReadonlyMap<string, Children>> = signal<
    ReadonlyMap<string, Children>
  >(new Map<string, Children>());

  /**
   * Holds the row last chosen.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Counts the walks begun, so an answer for a hierarchy or direction since replaced is dropped.
   */
  private walk: number = 0;

  /**
   * Gets the switch's options: the two ways the shown hierarchy can be walked.
   */
  protected readonly directions: Signal<readonly ButtonGroupOption[]> = computed(
    (): readonly ButtonGroupOption[] =>
      HIERARCHY_DIRECTIONS[this.source()?.kind ?? 'calls'].map(
        (direction: HierarchyDirection): ButtonGroupOption => ({
          value: direction,
          label: DIRECTION_LABELS[direction],
        }),
      ),
  );

  /**
   * Gets the strip's heading: what is listed, and of which symbol.
   */
  protected readonly heading: Signal<{ readonly lead: string; readonly symbol: string }> = computed(
    (): { readonly lead: string; readonly symbol: string } => {
      const root: HierarchyNode | undefined = this.source()?.roots[0];
      return root === undefined
        ? { lead: 'Hierarchy', symbol: '' }
        : { lead: DIRECTION_HEADINGS[this.direction()], symbol: root.name };
    },
  );

  /**
   * Gets what the panel says in place of a tree, or null when it shows one.
   */
  protected readonly emptyMessage: Signal<string | null> = computed((): string | null => {
    const source: HierarchySource | null = this.source();
    if (source === null) {
      return 'Show Call Hierarchy (⌃⌥H) or Show Type Hierarchy (⌃⇧H) on a symbol to see it here.';
    }
    return source.roots.length === 0
      ? `There is no ${source.kind === 'calls' ? 'call' : 'type'} hierarchy for the symbol at the caret.`
      : null;
  });

  /**
   * Gets the tree's rows: every root, and beneath each expanded row its children — or a note while
   * they load, or if they could not be found.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const source: HierarchySource | null = this.source();
    if (source === null) {
      return [];
    }
    const expanded: ReadonlySet<string> = this.expanded();
    const children: ReadonlyMap<string, Children> = this.children();
    const rows: TreeRow[] = [];
    const add: (node: HierarchyNode, id: string, depth: number) => void = (
      node: HierarchyNode,
      id: string,
      depth: number,
    ): void => {
      const known: Children | undefined = children.get(id);
      const open: boolean = expanded.has(id);
      rows.push({
        id,
        depth,
        // A node is expandable until it is found to have nothing beneath it.
        expandable: !(Array.isArray(known) && known.length === 0),
        expanded: open,
        hint: node.detail === undefined ? node.name : `${node.detail} — ${node.name}`,
        data: { kind: 'node', node } satisfies HierarchyRow,
      });
      if (!open || known === undefined) {
        return;
      }
      if (known === 'loading' || known === 'failed') {
        rows.push({
          id: `${id}/note`,
          depth: depth + 1,
          expandable: false,
          expanded: false,
          disabled: true,
          data: {
            kind: 'note',
            text: known === 'loading' ? 'Loading…' : 'Could not be found.',
          } satisfies HierarchyRow,
        });
        return;
      }
      known.forEach((child: HierarchyNode, index: number): void =>
        add(child, `${id}/${index}`, depth + 1),
      );
    };
    source.roots.forEach((root: HierarchyNode, index: number): void => add(root, String(index), 0));
    return rows;
  });

  /**
   * Initializes a new instance of the {@link HierarchyPanel} class: a new hierarchy opens walking its
   * first direction, with its roots expanded.
   */
  public constructor() {
    effect((): void => {
      const source: HierarchySource | null = this.source();
      untracked((): void => {
        if (source !== null) {
          this.direction.set(HIERARCHY_DIRECTIONS[source.kind][0]);
          this.restart();
        }
      });
    });
  }

  /**
   * Walks the hierarchy the other way from the same roots.
   * @param direction The way to walk.
   */
  protected onDirection(direction: string): void {
    if (direction === this.direction()) {
      return;
    }
    this.direction.set(direction as HierarchyDirection);
    this.restart();
  }

  /**
   * Handles a chosen row: opens its symbol, and expands it — asking for its children the first time —
   * or folds it.
   * @param treeRow The row.
   */
  protected onRowClick(treeRow: TreeRow): void {
    const row: HierarchyRow = this.rowOf(treeRow);
    if (row.kind === 'note') {
      return;
    }
    this.selectedId.set(treeRow.id);
    this.log.debug('hierarchy', 'Go to hierarchy node', row.node.location.path);
    void this.navigation.goTo(null, row.node.location, true);
    if (!treeRow.expandable) {
      return;
    }
    if (treeRow.expanded) {
      this.expanded.update((current: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(current);
        next.delete(treeRow.id);
        return next;
      });
      return;
    }
    this.expand(treeRow.id, row.node);
  }

  /**
   * Unwraps a row's payload.
   * @param treeRow The tree row.
   * @returns Returns the hierarchy row.
   */
  protected rowOf(treeRow: TreeRow): HierarchyRow {
    return treeRow.data as HierarchyRow;
  }

  /**
   * Gets a node's icon.
   * @param node The node.
   * @returns Returns the icon of its symbol's kind.
   */
  protected iconOf(node: HierarchyNode): Icon {
    return symbolIcon(node.kind);
  }

  /**
   * Forgets every expansion and expands the roots afresh, for a new hierarchy or direction.
   */
  private restart(): void {
    this.walk++;
    this.expanded.set(new Set<string>());
    this.children.set(new Map<string, Children>());
    this.selectedId.set(null);
    this.source()?.roots.forEach((root: HierarchyNode, index: number): void =>
      this.expand(String(index), root),
    );
  }

  /**
   * Expands a row, asking for its children the first time.
   * @param id The row's id.
   * @param node The row's node.
   */
  private expand(id: string, node: HierarchyNode): void {
    this.expanded.update(
      (current: ReadonlySet<string>): ReadonlySet<string> => new Set<string>([...current, id]),
    );
    const known: Children | undefined = this.children().get(id);
    if (known !== undefined && known !== 'failed') {
      return;
    }
    const source: HierarchySource | null = this.source();
    if (source === null) {
      return;
    }
    const walk: number = this.walk;
    this.setChildren(id, 'loading');
    void source
      .children(node, this.direction())
      .then((found: readonly HierarchyNode[] | null): void => {
        if (walk === this.walk) {
          this.setChildren(id, found ?? 'failed');
        }
      });
  }

  /**
   * Records what is known of a row's children.
   * @param id The row's id.
   * @param children What is known.
   */
  private setChildren(id: string, children: Children): void {
    this.children.update(
      (current: ReadonlyMap<string, Children>): ReadonlyMap<string, Children> =>
        new Map<string, Children>([...current, [id, children]]),
    );
  }
}
