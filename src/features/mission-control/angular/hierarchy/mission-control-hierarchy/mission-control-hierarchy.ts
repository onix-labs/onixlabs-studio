import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Meter, MeterTone } from '@shared/angular/components/meter/meter';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { ForgeProject } from '@shared/angular/services/forge-projects/forge-projects';
import { Log } from '@shared/angular/services/log/log';
import { Shell } from '@shared/angular/services/shell/shell';
import { MissionControl } from '../../mission-control/mission-control';
import { MissionControlWorkItems, ProjectWorkItems } from '../work-items';
import { WorkItemLevel, WorkItemNode } from '../work-item-tree';

/**
 * A project heading its work-item tree.
 */
export interface ProjectRowData {
  /**
   * Discriminates the row.
   */
  readonly kind: 'project';

  /**
   * Gets the project.
   */
  readonly project: ForgeProject;

  /**
   * Gets how many open work items the project's tree holds.
   */
  readonly count: number;

  /**
   * Gets a value indicating whether a read is in flight.
   */
  readonly loading: boolean;
}

/**
 * A work item in a project's tree.
 */
export interface ItemRowData {
  /**
   * Discriminates the row.
   */
  readonly kind: 'item';

  /**
   * Gets the node.
   */
  readonly node: WorkItemNode;
}

/**
 * A line of status in place of a project's tree: reading, failed, or empty.
 */
export interface StatusRowData {
  /**
   * Discriminates the row.
   */
  readonly kind: 'status';

  /**
   * Gets what to say.
   */
  readonly text: string;

  /**
   * Gets a value indicating whether the status is a failure.
   */
  readonly failed: boolean;
}

/**
 * The payload of one row of the hierarchy.
 */
export type HierarchyRowData = ProjectRowData | ItemRowData | StatusRowData;

/**
 * The glyph of each level.
 */
const LEVEL_ICONS: Readonly<Record<WorkItemLevel, Icon>> = {
  initiative: Icon.WORK_ITEM_INITIATIVE,
  epic: Icon.WORK_ITEM_EPIC,
  feature: Icon.WORK_ITEM_FEATURE,
  task: Icon.WORK_ITEM_TASK,
};

/**
 * The name of each level, as the Level column shows it.
 */
const LEVEL_LABELS: Readonly<Record<WorkItemLevel, string>> = {
  initiative: 'Initiative',
  epic: 'Epic',
  feature: 'Feature',
  task: 'Task',
};

/**
 * Counts the nodes of a tree.
 * @param nodes The nodes.
 * @returns Returns how many nodes there are, at every depth.
 */
function countNodes(nodes: readonly WorkItemNode[]): number {
  return nodes.reduce(
    (sum: number, node: WorkItemNode): number => sum + 1 + countNodes(node.children),
    0,
  );
}

/**
 * Tells whether a root stands alone: no parent to sit under and no children to head.
 * @param node The root.
 * @returns Returns true when it is standalone.
 */
function isStandalone(node: WorkItemNode): boolean {
  return node.children.length === 0 && node.item.children.total === 0;
}

/**
 * Says coarsely how long ago something happened. The column is a recency cue, not a timestamp.
 * @param iso When it happened, as an ISO 8601 timestamp.
 * @param now The current time, as epoch milliseconds.
 * @returns Returns the description, or an empty string when the timestamp is unreadable.
 */
export function ago(iso: string, now: number): string {
  const then: number = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes: number = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days: number = Math.floor(hours / 24);
  return days < 60 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

/**
 * Mission Control's Hierarchy face (epic #788, P1): every open project's work items as one tree —
 * project, then its epics and their features, recursively — with each item's level, derived progress
 * and recency.
 *
 * Read-only for now. A row's progress is derived from its children, never reported by an agent, and
 * an item filed by someone outside the repository carries a mark, because later phases hand these
 * items to agents and an outsider's issue is not instructions.
 */
@Component({
  selector: 'app-mission-control-hierarchy',
  imports: [AppIcon, Meter, TooltipTrigger, TreeView],
  templateUrl: './mission-control-hierarchy.html',
  styleUrl: './mission-control-hierarchy.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlHierarchy {
  /**
   * Holds the open projects' work items.
   */
  private readonly workItems: MissionControlWorkItems = inject(MissionControlWorkItems);

  /**
   * Holds Mission Control's shared view state, for the standalone-issues toggle.
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the shell, which opens an item on the forge.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the ids of the collapsed rows. Collapsed rather than expanded, so a newly read tree opens
   * fully: the point of the face is to see the structure.
   */
  private readonly collapsed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the selected row's id.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Reads the current time, for the Updated column. Overridable in tests.
   */
  protected now: () => number = Date.now;

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the open projects.
   */
  protected readonly projects: Signal<readonly ForgeProject[]> = this.workItems.projects;

  /**
   * Gets the flattened, visible rows.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const collapsed: ReadonlySet<string> = this.collapsed();
    const showStandalone: boolean = this.missionControl.showStandalone();
    const rows: TreeRow[] = [];
    for (const project of this.projects()) {
      const state: ProjectWorkItems = this.workItems.stateFor(project.key);
      const id: string = `project:${project.key}`;
      const expanded: boolean = !collapsed.has(id);
      const data: ProjectRowData = {
        kind: 'project',
        project,
        count: countNodes(state.tree),
        loading: state.loading,
      };
      rows.push({ id, depth: 0, expandable: true, expanded, data });
      if (expanded) {
        this.pushProject(rows, project, state, collapsed, showStandalone);
      }
    }
    return rows;
  });

  /**
   * Narrows a row's payload for the template.
   * @param row The row.
   * @returns Returns its payload.
   */
  protected dataOf(row: TreeRow): HierarchyRowData {
    return row.data as HierarchyRowData;
  }

  /**
   * Gets a level's glyph.
   * @param level The level.
   * @returns Returns the icon.
   */
  protected levelIcon(level: WorkItemLevel): Icon {
    return LEVEL_ICONS[level];
  }

  /**
   * Gets a level's name.
   * @param level The level.
   * @returns Returns the name.
   */
  protected levelLabel(level: WorkItemLevel): string {
    return LEVEL_LABELS[level];
  }

  /**
   * Gets the tone a progress meter wears: done reads as success, anything blocked as a warning.
   * @param node The node.
   * @returns Returns the tone.
   */
  protected toneOf(node: WorkItemNode): MeterTone {
    if (node.item.blockedBy > 0) {
      return 'warning';
    }
    return node.progress >= 1 ? 'success' : 'accent';
  }

  /**
   * Gets a progress as a whole percentage.
   * @param progress The progress, from 0 to 1.
   * @returns Returns the percentage.
   */
  protected percent(progress: number): number {
    return Math.round(progress * 100);
  }

  /**
   * Gets how long ago an item was last touched.
   * @param node The node.
   * @returns Returns the description.
   */
  protected updated(node: WorkItemNode): string {
    return ago(node.item.updatedAt, this.now());
  }

  /**
   * Selects a row, and expands or collapses it when it has anything beneath it.
   * @param row The row clicked.
   */
  protected onRowClick(row: TreeRow): void {
    this.selectedId.set(row.id);
    if (!row.expandable) {
      return;
    }
    this.collapsed.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (row.expanded) {
        next.add(row.id);
      } else {
        next.delete(row.id);
      }
      return next;
    });
  }

  /**
   * Opens a work item on the forge.
   * @param row The row double-clicked.
   */
  protected onRowOpen(row: TreeRow): void {
    const data: HierarchyRowData = this.dataOf(row);
    if (data.kind !== 'item' || data.node.item.url.length === 0) {
      return;
    }
    this.log.info('mission-control', 'Opening work item on the forge', data.node.item.number);
    void this.shell.openExternal(data.node.item.url);
  }

  /**
   * Appends a project's tree — or the status standing in for it — beneath its row.
   * @param rows The rows being built.
   * @param project The project.
   * @param state The project's work-item state.
   * @param collapsed The collapsed row ids.
   * @param showStandalone Whether standalone issues are listed.
   */
  private pushProject(
    rows: TreeRow[],
    project: ForgeProject,
    state: ProjectWorkItems,
    collapsed: ReadonlySet<string>,
    showStandalone: boolean,
  ): void {
    const status: (text: string, failed: boolean) => void = (
      text: string,
      failed: boolean,
    ): void => {
      const data: StatusRowData = { kind: 'status', text, failed };
      rows.push({
        id: `status:${project.key}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data,
      });
    };
    if (!state.loaded) {
      if (state.error !== null) {
        status(state.error, true);
      } else {
        status('Reading work items…', false);
      }
      return;
    }
    const roots: readonly WorkItemNode[] = showStandalone
      ? state.tree
      : state.tree.filter((node: WorkItemNode): boolean => !isStandalone(node));
    if (roots.length === 0) {
      const hidden: number = state.tree.length;
      status(
        hidden === 0
          ? 'No open work items.'
          : `No epics. ${hidden} standalone ${hidden === 1 ? 'issue is' : 'issues are'} hidden.`,
        false,
      );
      return;
    }
    const walk: (nodes: readonly WorkItemNode[], depth: number) => void = (
      nodes: readonly WorkItemNode[],
      depth: number,
    ): void => {
      for (const node of nodes) {
        const id: string = `item:${project.key}#${node.item.number}`;
        const expandable: boolean = node.children.length > 0;
        const expanded: boolean = expandable && !collapsed.has(id);
        const data: ItemRowData = { kind: 'item', node };
        rows.push({ id, depth, expandable, expanded, data });
        if (expanded) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(roots, 1);
  }
}
