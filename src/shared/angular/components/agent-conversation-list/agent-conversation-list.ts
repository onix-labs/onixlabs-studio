import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import {
  AgentConversationAgentType,
  AgentConversationSummary,
} from '@shared/api/agent-conversation-channels';
import { AgentCategory } from '@shared/api/agent-category-channels';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentCategories } from '@shared/angular/services/agent-categories/agent-categories';
import { agentTypeFromContextKind } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { HighlightedText } from '@shared/angular/components/highlighted-text/highlighted-text';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';

/**
 * The identifier of the always-present All Conversations root node.
 */
const ALL_NODE_ID: string = 'all';

/**
 * The localStorage key the tree persists its per-node expand/collapse state under, so the layout
 * survives the list being torn down and rebuilt (it is provided per host and recreated freely).
 */
const EXPANDED_STORAGE_KEY: string = 'agent-history:expanded';

/**
 * The display labels for each agent type, shown on the primary metadata chip and in the filter.
 */
const AGENT_TYPE_LABELS: Readonly<Record<AgentConversationAgentType, string>> = {
  agent: 'Agent',
  code: 'Code',
  workspace: 'Workspace',
  terminal: 'Terminal',
  review: 'Review',
  search: 'Search',
};

/**
 * The order agent types appear in the filter list.
 */
const AGENT_TYPE_ORDER: readonly AgentConversationAgentType[] = [
  'agent',
  'code',
  'workspace',
  'terminal',
  'review',
  'search',
];

/**
 * A conversation prepared for display: its stored summary plus the resolved agent type (falling back to
 * one derived from its context when unrecorded) so the template renders chips without recomputing.
 */
interface HistoryItem {
  /**
   * Gets the underlying stored summary.
   */
  readonly summary: AgentConversationSummary;

  /**
   * Gets the resolved agent type shown as the primary chip.
   */
  readonly agentType: AgentConversationAgentType;
}

/**
 * A node in the history tree: the All Conversations root or a user-created category, carrying the
 * conversations that fall under it (after search and filters) and its resolved expand state.
 */
interface HistoryNode {
  /**
   * Gets the node id (the {@link ALL_NODE_ID} sentinel or a category id).
   */
  readonly id: string;

  /**
   * Gets a value indicating whether this is the All Conversations root (which cannot be renamed,
   * deleted, or used as a drop target).
   */
  readonly isAll: boolean;

  /**
   * Gets the node's display name.
   */
  readonly name: string;

  /**
   * Gets the conversations under this node, after search and filters, newest first.
   */
  readonly items: readonly HistoryItem[];

  /**
   * Gets a value indicating whether the node is expanded.
   */
  readonly expanded: boolean;
}

/**
 * The payload carried by a tree row: either a category/root node or a conversation leaf.
 */
type HistoryRowData =
  | { readonly kind: 'node'; readonly node: HistoryNode }
  | { readonly kind: 'item'; readonly item: HistoryItem; readonly nodeId: string };

/**
 * The history of persisted agent conversations, presented through the shared {@link TreeView}: an
 * always-present All Conversations root that shows every conversation regardless of the agent that
 * created it, plus the user's own categories as collapsible folders a conversation can be filed under.
 * Each conversation leaf carries metadata chips (its agent type and context), an overflow menu (rename,
 * move to a category, duplicate, delete), and a selection checkbox for bulk delete. Search spans the
 * whole tree (auto-expanding categories with matches) and a filter narrows by agent type or to the
 * uncategorized. Conversations can be dragged onto a category to file them. It drives everything through
 * the injected {@link AgentConversation} (the host's live session — clicking a leaf reopens it there)
 * and the shared {@link AgentCategories} registry, so it stays in step with both.
 */
@Component({
  selector: 'app-agent-conversation-list',
  imports: [
    AppIcon,
    Checkbox,
    HighlightedText,
    Modal,
    ModalContent,
    TreeView,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
  ],
  templateUrl: './agent-conversation-list.html',
  styleUrl: './agent-conversation-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentConversationList {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the conversation whose stored history this lists and drives.
   */
  private readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the shared category registry.
   */
  private readonly categoriesService: AgentCategories = inject(AgentCategories);

  /**
   * Gets the id of the conversation currently open, highlighted in the tree (or null). Its All
   * Conversations leaf (whose row id is the plain conversation id) carries the selection.
   */
  protected readonly activeId: Signal<string | null> = this.conversation.currentId;

  /**
   * Gets the user's categories, in order.
   */
  protected readonly categories: Signal<readonly AgentCategory[]> =
    this.categoriesService.categories;

  /**
   * Holds the search query filtering the tree by title.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds the agent types currently enabled in the filter; when a type is absent its conversations are
   * hidden. Initialized to every type (nothing filtered out).
   */
  protected readonly enabledTypes: WritableSignal<ReadonlySet<AgentConversationAgentType>> = signal<
    ReadonlySet<AgentConversationAgentType>
  >(new Set<AgentConversationAgentType>(AGENT_TYPE_ORDER));

  /**
   * Holds whether the filter is restricted to uncategorized conversations.
   */
  protected readonly uncategorizedOnly: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the explicit per-node expand/collapse overrides (true expanded, false collapsed), persisted
   * across rebuilds. A node absent here uses its default: All expanded, categories collapsed.
   */
  private readonly expandedOverrides: WritableSignal<Readonly<Record<string, boolean>>> = signal<
    Readonly<Record<string, boolean>>
  >(this.readExpanded());

  /**
   * Holds the ids the user has checked for bulk delete.
   */
  protected readonly checked: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the conversation the overflow menu currently targets, set as the menu opens.
   */
  protected readonly menuTarget: WritableSignal<AgentConversationSummary | null> =
    signal<AgentConversationSummary | null>(null);

  /**
   * Holds the id of the conversation being dragged, or null when no drag is in progress.
   */
  private readonly draggingId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the id of the category node a drag is currently hovering, for drop highlighting.
   */
  protected readonly dropTargetId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the conversation being renamed, or null when the rename modal is closed.
   */
  protected readonly renameTarget: WritableSignal<AgentConversationSummary | null> =
    signal<AgentConversationSummary | null>(null);

  /**
   * Holds the edited title in the rename modal.
   */
  protected readonly renameValue: WritableSignal<string> = signal<string>('');

  /**
   * Holds the category being edited (id null for a new category), or null when the editor is closed.
   */
  protected readonly categoryEditor: WritableSignal<{ id: string | null; name: string } | null> =
    signal<{ id: string | null; name: string } | null>(null);

  /**
   * Holds the conversation id to file under the category being created, or null. Set when the editor is
   * opened from a conversation's "Move to category ▸ New category…".
   */
  private categoryEditorFileId: string | null = null;

  /**
   * Holds whether the manage-categories modal is open.
   */
  protected readonly manageOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the delete-conversations confirmation modal is open.
   */
  protected readonly confirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the resolved agent-type label lookup, exposed for the template.
   */
  protected readonly agentTypeLabels: Readonly<Record<AgentConversationAgentType, string>> =
    AGENT_TYPE_LABELS;

  /**
   * Gets the agent types in filter order, exposed for the template.
   */
  protected readonly agentTypeOrder: readonly AgentConversationAgentType[] = AGENT_TYPE_ORDER;

  /**
   * Gets every stored conversation, resolved for display (agent type filled in), newest first.
   */
  private readonly items: Signal<readonly HistoryItem[]> = computed((): readonly HistoryItem[] =>
    this.conversation.summaries().map(
      (summary: AgentConversationSummary): HistoryItem => ({
        summary,
        agentType: this.resolveAgentType(summary),
      }),
    ),
  );

  /**
   * Gets the conversations matching the current search and filters, before grouping.
   */
  protected readonly matching: Signal<readonly HistoryItem[]> = computed(
    (): readonly HistoryItem[] => {
      const needle: string = this.query().trim().toLowerCase();
      const types: ReadonlySet<AgentConversationAgentType> = this.enabledTypes();
      const uncategorized: boolean = this.uncategorizedOnly();
      return this.items().filter((item: HistoryItem): boolean => {
        if (needle.length > 0 && !item.summary.title.toLowerCase().includes(needle)) {
          return false;
        }
        if (!types.has(item.agentType)) {
          return false;
        }
        if (uncategorized && item.summary.categoryId != null) {
          return false;
        }
        return true;
      });
    },
  );

  /**
   * Gets the tree nodes: the All Conversations root followed by each category, each carrying its
   * matching conversations and resolved expand state.
   */
  private readonly nodes: Signal<readonly HistoryNode[]> = computed((): readonly HistoryNode[] => {
    const matching: readonly HistoryItem[] = this.matching();
    const searchActive: boolean = this.query().trim().length > 0;
    const all: HistoryNode = {
      id: ALL_NODE_ID,
      isAll: true,
      name: 'All Conversations',
      items: matching,
      expanded: this.isExpanded(ALL_NODE_ID, matching.length > 0, searchActive),
    };
    const categoryNodes: readonly HistoryNode[] = this.categories().map(
      (category: AgentCategory): HistoryNode => {
        const items: readonly HistoryItem[] = matching.filter(
          (item: HistoryItem): boolean => item.summary.categoryId === category.id,
        );
        return {
          id: category.id,
          isAll: false,
          name: category.name,
          items,
          expanded: this.isExpanded(category.id, items.length > 0, searchActive),
        };
      },
    );
    return [all, ...categoryNodes];
  });

  /**
   * Gets the flattened tree rows for the shared {@link TreeView}: each node followed by its
   * conversations when expanded. A conversation's leaf carries a row id unique to its placement — the
   * plain conversation id under All Conversations (so the active conversation's selection matches
   * there), and a category-prefixed id under a category.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const rows: TreeRow[] = [];
    for (const node of this.nodes()) {
      rows.push({
        id: node.id,
        depth: 0,
        expandable: true,
        expanded: node.expanded,
        data: { kind: 'node', node } satisfies HistoryRowData,
      });
      if (node.expanded) {
        for (const item of node.items) {
          rows.push({
            id: node.isAll ? item.summary.id : `${node.id}:${item.summary.id}`,
            depth: 1,
            expandable: false,
            expanded: false,
            data: { kind: 'item', item, nodeId: node.id } satisfies HistoryRowData,
          });
        }
      }
    }
    return rows;
  });

  /**
   * Gets a value indicating whether there are no conversations to show at all (so an empty message
   * replaces the tree body).
   */
  protected readonly isEmpty: Signal<boolean> = computed(
    (): boolean => this.matching().length === 0,
  );

  /**
   * Gets the number of conversations checked for deletion.
   */
  protected readonly checkedCount: Signal<number> = computed((): number => this.checked().size);

  /**
   * Gets a value indicating whether any conversation is checked (so Delete is enabled).
   */
  protected readonly hasChecked: Signal<boolean> = computed((): boolean => this.checkedCount() > 0);

  /**
   * Gets a value indicating whether every matching conversation is checked, flipping the select-all
   * toggle.
   */
  protected readonly allSelected: Signal<boolean> = computed((): boolean => {
    const matching: readonly HistoryItem[] = this.matching();
    if (matching.length === 0) {
      return false;
    }
    const checked: ReadonlySet<string> = this.checked();
    return matching.every((item: HistoryItem): boolean => checked.has(item.summary.id));
  });

  /**
   * Gets a value indicating whether any filter is active (not all types enabled, or uncategorized-only),
   * so the filter trigger can show an active marker.
   */
  protected readonly filterActive: Signal<boolean> = computed(
    (): boolean => this.uncategorizedOnly() || this.enabledTypes().size !== AGENT_TYPE_ORDER.length,
  );

  /**
   * Initializes a new instance of the {@link AgentConversationList} class, pruning checked ids that no
   * longer exist and reloading conversations when categories change (so a category deletion's cleared
   * filings are reflected).
   */
  public constructor() {
    effect((): void => {
      const ids: ReadonlySet<string> = new Set<string>(
        this.conversation
          .summaries()
          .map((summary: AgentConversationSummary): string => summary.id),
      );
      untracked((): void => {
        const checked: ReadonlySet<string> = this.checked();
        const pruned: Set<string> = new Set<string>(
          [...checked].filter((id: string): boolean => ids.has(id)),
        );
        if (pruned.size !== checked.size) {
          this.checked.set(pruned);
        }
      });
    });

    effect((): void => {
      this.categoriesService.categories();
      untracked((): void => void this.conversation.refresh());
    });
  }

  /**
   * Reads a tree row's payload.
   * @param row The tree row.
   * @returns Returns the row data.
   */
  protected dataOf(row: TreeRow): HistoryRowData {
    return row.data as HistoryRowData;
  }

  /**
   * Handles a tree row activation: toggles a node's expansion, or reopens a conversation leaf.
   * @param row The activated row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: HistoryRowData = this.dataOf(row);
    if (data.kind === 'node') {
      this.onToggleExpand(data.node.id, data.node.expanded);
    } else {
      this.onOpen(data.item.summary.id);
    }
  }

  /**
   * Resolves a summary's agent type, using the recorded type or, for older records, one derived from
   * its context.
   * @param summary The conversation summary.
   * @returns Returns the agent type.
   */
  private resolveAgentType(summary: AgentConversationSummary): AgentConversationAgentType {
    return (
      summary.agentType ?? agentTypeFromContextKind(summary.contextId.split(':')[0] ?? 'global')
    );
  }

  /**
   * Gets a node's effective expand state: forced open while searching when it has matches, else the
   * user's explicit override, else the default (All open, categories closed).
   * @param nodeId The node id.
   * @param hasMatches Whether the node has any conversations on show.
   * @param searchActive Whether a search query is present.
   * @returns Returns true when the node should render expanded.
   */
  private isExpanded(nodeId: string, hasMatches: boolean, searchActive: boolean): boolean {
    if (searchActive) {
      return hasMatches;
    }
    return this.expandedOverrides()[nodeId] ?? nodeId === ALL_NODE_ID;
  }

  /**
   * Toggles a node's expand/collapse state, persisting the override.
   * @param nodeId The node id.
   * @param expanded The node's current expand state.
   */
  protected onToggleExpand(nodeId: string, expanded: boolean): void {
    const next: Record<string, boolean> = { ...this.expandedOverrides(), [nodeId]: !expanded };
    this.expandedOverrides.set(next);
    this.writeExpanded(next);
  }

  /**
   * Sets the search query from the search box.
   * @param event The input event from the search box.
   */
  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Gets whether a conversation is checked.
   * @param id The conversation id.
   * @returns Returns true when checked.
   */
  protected isChecked(id: string): boolean {
    return this.checked().has(id);
  }

  /**
   * Toggles a single conversation's checked state.
   * @param id The conversation id.
   * @param checked Whether it is now checked.
   */
  protected onToggle(id: string, checked: boolean): void {
    const next: Set<string> = new Set<string>(this.checked());
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.checked.set(next);
  }

  /**
   * Toggles selection of every conversation under a node (its checkbox), without touching rows outside
   * it. Selecting a node's checkbox selects its direct children only.
   * @param node The node whose conversations to toggle.
   * @param checked Whether they are now checked.
   */
  protected onToggleNode(node: HistoryNode, checked: boolean): void {
    const next: Set<string> = new Set<string>(this.checked());
    for (const item of node.items) {
      if (checked) {
        next.add(item.summary.id);
      } else {
        next.delete(item.summary.id);
      }
    }
    this.checked.set(next);
  }

  /**
   * Gets whether every conversation under a node is checked (so its checkbox reads as checked).
   * @param node The node.
   * @returns Returns true when all the node's conversations are checked.
   */
  protected isNodeChecked(node: HistoryNode): boolean {
    return (
      node.items.length > 0 &&
      node.items.every((item: HistoryItem): boolean => this.checked().has(item.summary.id))
    );
  }

  /**
   * Toggles selection of every matching conversation (the toolbar select-all).
   */
  protected onToggleSelectAll(): void {
    const matching: readonly HistoryItem[] = this.matching();
    const next: Set<string> = new Set<string>(this.checked());
    if (this.allSelected()) {
      for (const item of matching) {
        next.delete(item.summary.id);
      }
    } else {
      for (const item of matching) {
        next.add(item.summary.id);
      }
    }
    this.checked.set(next);
  }

  /**
   * Reopens the clicked conversation into the host's session.
   * @param id The conversation id.
   */
  protected onOpen(id: string): void {
    void this.conversation.open(id);
  }

  /**
   * Toggles an agent type in the filter.
   * @param type The agent type.
   */
  protected onToggleType(type: AgentConversationAgentType): void {
    const next: Set<AgentConversationAgentType> = new Set<AgentConversationAgentType>(
      this.enabledTypes(),
    );
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    this.enabledTypes.set(next);
  }

  /**
   * Gets whether an agent type is enabled in the filter.
   * @param type The agent type.
   * @returns Returns true when enabled (its conversations are shown).
   */
  protected isTypeEnabled(type: AgentConversationAgentType): boolean {
    return this.enabledTypes().has(type);
  }

  /**
   * Toggles the uncategorized-only filter.
   */
  protected onToggleUncategorized(): void {
    this.uncategorizedOnly.update((value: boolean): boolean => !value);
  }

  /**
   * Clears every filter back to showing all conversations.
   */
  protected onClearFilters(): void {
    this.enabledTypes.set(new Set<AgentConversationAgentType>(AGENT_TYPE_ORDER));
    this.uncategorizedOnly.set(false);
  }

  /**
   * Records the conversation an overflow menu targets as it opens.
   * @param summary The conversation.
   */
  protected onOpenMenu(summary: AgentConversationSummary): void {
    this.menuTarget.set(summary);
  }

  /**
   * Gets whether the overflow menu's targeted conversation is filed under a category (so Remove from
   * category is enabled).
   * @returns Returns true when the target has a category.
   */
  protected targetHasCategory(): boolean {
    const id: string | null | undefined = this.menuTarget()?.categoryId;
    return typeof id === 'string' && id.length > 0;
  }

  /**
   * Opens the rename modal for the targeted conversation.
   */
  protected onRename(): void {
    const target: AgentConversationSummary | null = this.menuTarget();
    if (target === null) {
      return;
    }
    this.renameTarget.set(target);
    this.renameValue.set(target.title);
  }

  /**
   * Commits the rename, then closes the modal.
   */
  protected async onConfirmRename(): Promise<void> {
    const target: AgentConversationSummary | null = this.renameTarget();
    const title: string = this.renameValue().trim();
    this.renameTarget.set(null);
    if (target !== null && title.length > 0) {
      await this.conversation.rename(target.id, title);
    }
  }

  /**
   * Closes the rename modal without renaming.
   */
  protected onCancelRename(): void {
    this.renameTarget.set(null);
  }

  /**
   * Files the targeted conversation under a category, or clears it when given null.
   * @param categoryId The category id, or null to remove from its category.
   */
  protected async onMoveTo(categoryId: string | null): Promise<void> {
    const target: AgentConversationSummary | null = this.menuTarget();
    if (target !== null) {
      await this.conversation.setCategory(target.id, categoryId);
    }
  }

  /**
   * Gets whether the targeted conversation is filed under the given category (for the Move submenu
   * check mark).
   * @param categoryId The category id.
   * @returns Returns true when the target is filed under it.
   */
  protected isTargetIn(categoryId: string): boolean {
    return this.menuTarget()?.categoryId === categoryId;
  }

  /**
   * Duplicates the targeted conversation.
   */
  protected async onDuplicate(): Promise<void> {
    const target: AgentConversationSummary | null = this.menuTarget();
    if (target !== null) {
      await this.conversation.duplicate(target.id);
    }
  }

  /**
   * Opens the delete-confirmation modal for the targeted conversation, checking it first so the shared
   * confirm path deletes it.
   */
  protected onDeleteOne(): void {
    const target: AgentConversationSummary | null = this.menuTarget();
    if (target === null) {
      return;
    }
    this.checked.set(new Set<string>([target.id]));
    this.confirmOpen.set(true);
  }

  /**
   * Opens the delete-confirmation modal for the checked conversations.
   */
  protected onRequestDelete(): void {
    if (this.hasChecked()) {
      this.confirmOpen.set(true);
    }
  }

  /**
   * Closes the delete-confirmation modal without deleting.
   */
  protected onCancelDelete(): void {
    this.confirmOpen.set(false);
  }

  /**
   * Deletes the checked conversations, then clears the selection.
   */
  protected async onConfirmDelete(): Promise<void> {
    const ids: readonly string[] = [...this.checked()];
    this.confirmOpen.set(false);
    if (ids.length === 0) {
      return;
    }
    await this.conversation.delete(ids);
    this.checked.set(new Set<string>());
  }

  /**
   * Begins dragging a conversation.
   * @param id The conversation id.
   * @param event The drag event.
   */
  protected onDragStart(id: string, event: DragEvent): void {
    this.draggingId.set(id);
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  /**
   * Ends a conversation drag.
   */
  protected onDragEnd(): void {
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }

  /**
   * Marks a category node as the current drop target while a conversation is dragged over it.
   * @param node The node.
   * @param event The drag event.
   */
  protected onDragOver(node: HistoryNode, event: DragEvent): void {
    if (node.isAll || this.draggingId() === null) {
      return;
    }
    event.preventDefault();
    this.dropTargetId.set(node.id);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  /**
   * Clears the drop-target highlight when a drag leaves a node.
   * @param node The node.
   */
  protected onDragLeave(node: HistoryNode): void {
    if (this.dropTargetId() === node.id) {
      this.dropTargetId.set(null);
    }
  }

  /**
   * Files the dragged conversation under the category it was dropped on.
   * @param node The category node.
   * @param event The drop event.
   */
  protected async onDrop(node: HistoryNode, event: DragEvent): Promise<void> {
    event.preventDefault();
    const id: string = this.draggingId() ?? event.dataTransfer?.getData('text/plain') ?? '';
    this.draggingId.set(null);
    this.dropTargetId.set(null);
    if (id.length > 0 && !node.isAll) {
      await this.conversation.setCategory(id, node.id);
    }
  }

  /**
   * Opens the category editor to create a new category.
   */
  protected onNewCategory(): void {
    this.categoryEditorFileId = null;
    this.categoryEditor.set({ id: null, name: '' });
  }

  /**
   * Opens the category editor to create a category and file the targeted conversation under it (the
   * conversation Move menu's "New category…" entry).
   */
  protected onNewCategoryForTarget(): void {
    this.categoryEditorFileId = this.menuTarget()?.id ?? null;
    this.categoryEditor.set({ id: null, name: '' });
  }

  /**
   * Opens the category editor to rename an existing category.
   * @param category The category to edit.
   */
  protected onEditCategory(category: AgentCategory): void {
    this.categoryEditorFileId = null;
    this.categoryEditor.set({ id: category.id, name: category.name });
  }

  /**
   * Sets the edited category's name.
   * @param event The input event.
   */
  protected onCategoryName(event: Event): void {
    const value: string = (event.target as HTMLInputElement).value;
    this.categoryEditor.update((editor) => (editor === null ? null : { ...editor, name: value }));
  }

  /**
   * Saves the category being edited (creating or renaming it), filing the pending conversation under a
   * newly-created category when one is waiting, then closes the editor.
   */
  protected async onSaveCategory(): Promise<void> {
    const editor: { id: string | null; name: string } | null = this.categoryEditor();
    if (editor === null || editor.name.trim().length === 0) {
      return;
    }
    this.categoryEditor.set(null);
    if (editor.id === null) {
      const created: AgentCategory | null = await this.categoriesService.create(editor.name);
      const fileId: string | null = this.categoryEditorFileId;
      this.categoryEditorFileId = null;
      if (created !== null && fileId !== null) {
        await this.conversation.setCategory(fileId, created.id);
      }
    } else {
      await this.categoriesService.update(editor.id, { name: editor.name });
    }
  }

  /**
   * Closes the category editor without saving.
   */
  protected onCancelCategory(): void {
    this.categoryEditorFileId = null;
    this.categoryEditor.set(null);
  }

  /**
   * Deletes a category (its conversations fall back to uncategorized).
   * @param id The category id.
   */
  protected async onDeleteCategory(id: string): Promise<void> {
    await this.categoriesService.delete(id);
  }

  /**
   * Opens the manage-categories modal.
   */
  protected onManage(): void {
    this.manageOpen.set(true);
  }

  /**
   * Closes the manage-categories modal.
   */
  protected onCloseManage(): void {
    this.manageOpen.set(false);
  }

  /**
   * Formats a timestamp for a conversation's meta line.
   * @param timestamp The epoch-millisecond timestamp.
   * @returns Returns a short local date-time string.
   */
  protected formatWhen(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  /**
   * Reads the persisted per-node expand overrides from localStorage, degrading to empty on any failure.
   * @returns Returns the overrides.
   */
  private readExpanded(): Readonly<Record<string, boolean>> {
    try {
      const raw: string | null = localStorage.getItem(EXPANDED_STORAGE_KEY);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Persists the per-node expand overrides. Best-effort.
   * @param overrides The overrides to persist.
   */
  private writeExpanded(overrides: Readonly<Record<string, boolean>>): void {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // Persistence is best-effort.
    }
  }
}
