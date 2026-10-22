import { signal, Signal, WritableSignal } from '@angular/core';
import type { TreeRow } from './tree-view';

/**
 * Names how a gesture changes a multi-row selection (#1048):
 *
 * - `replace`: the row alone — a plain click, an arrow key, Esc.
 * - `toggle`: the row added or taken away, the rest kept — ⌘-click (Ctrl-click off macOS).
 * - `extend`: every row from the anchor to this one — Shift-click, Shift+↑/↓.
 */
export type TreeSelectMode = 'replace' | 'toggle' | 'extend';

/**
 * A selection gesture a multi-select tree reports: the row it landed on, and what it does.
 */
export interface TreeSelectGesture {
  /**
   * Gets the row the gesture landed on.
   */
  readonly row: TreeRow;

  /**
   * Gets how the gesture changes the selection.
   */
  readonly mode: TreeSelectMode;
}

/**
 * Holds which rows of a tree are selected, for a consumer that lets several be (#1048).
 *
 * The tree reports gestures and draws what it is told; the selection belongs here, with the consumer,
 * because what it means — which files a command acts on — is the consumer's. Ids are kept in the order
 * they are shown, so a command acting on a selection acts on it top to bottom, as the user reads it.
 *
 * Two pieces of state beside the ids: the **anchor**, the row a Shift range is measured from (the last
 * row a plain click or ⌘-click landed on), and the **focused** row, the one last acted on — what a
 * single-row surface such as "the selected file" follows.
 */
export class TreeSelection {
  /**
   * Holds the selected ids, in the order the tree shows them.
   */
  private readonly idsSignal: WritableSignal<readonly string[]> = signal<readonly string[]>([]);

  /**
   * Gets the selected ids, in the order the tree shows them.
   */
  public readonly ids: Signal<readonly string[]> = this.idsSignal.asReadonly();

  /**
   * Holds the row last acted on, or null when nothing is selected.
   */
  private readonly focusedSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the row last acted on, or null when nothing is selected.
   */
  public readonly focused: Signal<string | null> = this.focusedSignal.asReadonly();

  /**
   * Holds the row a Shift range is measured from, or null before any row was chosen.
   */
  private anchor: string | null = null;

  /**
   * Applies a gesture.
   * @param id The row the gesture landed on.
   * @param mode How it changes the selection.
   * @param order Every visible row's id, in the order the tree shows them.
   */
  public apply(id: string, mode: TreeSelectMode, order: readonly string[]): void {
    switch (mode) {
      case 'toggle': {
        const current: readonly string[] = this.idsSignal();
        const next: readonly string[] = current.includes(id)
          ? current.filter((candidate: string): boolean => candidate !== id)
          : inOrder([...current, id], order);
        this.idsSignal.set(next);
        this.anchor = id;
        // Taking the focused row away moves the focus to the nearest row still selected.
        this.focusedSignal.set(next.includes(id) ? id : (next.at(-1) ?? null));
        return;
      }
      case 'extend': {
        const from: number = this.anchor === null ? -1 : order.indexOf(this.anchor);
        const to: number = order.indexOf(id);
        if (from < 0 || to < 0) {
          this.replace(id);
          return;
        }
        this.idsSignal.set(order.slice(Math.min(from, to), Math.max(from, to) + 1));
        this.focusedSignal.set(id);
        return;
      }
      default:
        this.replace(id);
    }
  }

  /**
   * Selects one row alone, or nothing.
   * @param id The row, or null to clear the selection.
   */
  public replace(id: string | null): void {
    this.idsSignal.set(id === null ? [] : [id]);
    this.focusedSignal.set(id);
    this.anchor = id;
  }

  /**
   * Selects every visible row, keeping the focused one focused when it is among them.
   * @param order Every visible row's id, in the order the tree shows them.
   */
  public selectAll(order: readonly string[]): void {
    this.idsSignal.set([...order]);
    const focused: string | null = this.focusedSignal();
    this.focusedSignal.set(
      focused !== null && order.includes(focused) ? focused : (order[0] ?? null),
    );
    this.anchor = this.focusedSignal();
  }

  /**
   * Gets the rows a command chosen on a row acts on: the whole selection when the row is part of it,
   * otherwise the row alone — narrowed to the rows still visible, so a folder collapsed since the
   * selection was made hides its rows from the command too.
   * @param id The row the command was chosen on.
   * @param order Every visible row's id, in the order the tree shows them.
   * @returns Returns the ids, in the order the tree shows them.
   */
  public targetsFor(id: string, order: readonly string[]): readonly string[] {
    const ids: readonly string[] = this.idsSignal();
    if (!ids.includes(id)) {
      return [id];
    }
    const visible: readonly string[] = inOrder(ids, order);
    return visible.length === 0 ? [id] : visible;
  }
}

/**
 * Orders ids as the tree shows them, dropping any it no longer shows.
 * @param ids The ids.
 * @param order Every visible row's id, in the order the tree shows them.
 * @returns Returns the visible ids, in order.
 */
function inOrder(ids: readonly string[], order: readonly string[]): readonly string[] {
  const wanted: ReadonlySet<string> = new Set<string>(ids);
  return order.filter((id: string): boolean => wanted.has(id));
}
