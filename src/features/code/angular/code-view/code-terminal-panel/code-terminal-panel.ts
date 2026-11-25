import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import {
  EDITOR_TERMINAL_PANEL_ID,
  editorTerminalId,
  EditorTerminals,
} from '@shared/angular/services/editor-terminals/editor-terminals';
import { layoutAfterDrop } from '@shared/angular/services/dock-layout/dock-drop';
import {
  DockNode,
  DockSide,
  isStackNode,
  StackNode,
} from '@shared/angular/services/dock-layout/dock-node';
import { DockRoom } from '@shared/angular/services/dock-layout/dock-room';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * Where the terminal would move.
 */
interface TerminalMove {
  /**
   * Gets the identifier of the editor's group.
   */
  readonly stackId: string;

  /**
   * Gets the side of the editor's group.
   */
  readonly side: DockSide;
}

/**
 * Represents the docked run terminal for a code tab: a tool strip over an embedded terminal whose
 * session is keyed by the owning tab and lives as long as it does, whatever becomes of this panel. Queued run commands are written once the terminal is ready.
 */
@Component({
  selector: 'app-code-terminal-panel',
  imports: [Button, PanelToolbar, Terminal],
  templateUrl: './code-terminal-panel.html',
  styleUrl: './code-terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeTerminalPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the docked-terminal panel state.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

  /**
   * Holds the structured logger for the docked run terminal's user actions.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the dock's layout, which the layout button moves the terminal in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds where there is room in the dock.
   */
  private readonly room: DockRoom = inject(DockRoom);

  /**
   * Holds the embedded terminal pane this panel drives, or undefined before the view initialises.
   */
  private readonly pane: Signal<Terminal | undefined> = viewChild<Terminal>(Terminal);

  /**
   * Gets the identifier of the owning code tab. Always supplied by the host; the empty default lets
   * the panel be constructed before its input binding is applied.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets a value indicating whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the identifier of the run terminal's session, derived from the tab id.
   */
  protected readonly runTerminalId: Signal<string> = computed((): string =>
    editorTerminalId(this.tabId()),
  );

  /**
   * Holds a value indicating whether the embedded terminal is ready to receive input.
   */
  private readonly ready: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Initialises the panel, writing any queued run command once the terminal becomes ready.
   */
  public constructor() {
    effect((): void => {
      const tabId: string = this.tabId();
      if (tabId === '') {
        return;
      }
      const pending: string | null = this.editorTerminals.pending(tabId);
      if (this.ready() && pending !== null) {
        // Clear and write outside the reactive context to avoid writing signals during the effect.
        queueMicrotask((): void => this.flushPending());
      }
    });
  }

  /**
   * Records that the embedded terminal is ready.
   */
  protected onReady(): void {
    this.ready.set(true);
  }

  /**
   * Gets whether there is room where {@link onLayout} would move the terminal.
   */
  protected readonly canMove: Signal<boolean> = computed((): boolean => {
    const move: TerminalMove | null = this.move();
    return (
      move !== null &&
      this.room.admits(
        layoutAfterDrop(this.dockState.layout(), EDITOR_TERMINAL_PANEL_ID, 'tool', {
          kind: 'split',
          ...move,
        }),
        [EDITOR_TERMINAL_PANEL_ID],
      )
    );
  });

  /**
   * Moves the terminal between beneath the editor and beside it — a one-click shortcut for the same move
   * dragging its title bar performs.
   */
  protected onLayout(): void {
    const move: TerminalMove | null = this.move();
    if (move === null) {
      return;
    }
    this.log.debug('code.view', 'Move run terminal', move.side);
    this.dockState.movePanelBeside(EDITOR_TERMINAL_PANEL_ID, move.stackId, move.side);
  }

  /**
   * Works out where the terminal would move.
   * @returns Returns the editor's group and the side of it, or null when either is not in the layout.
   */
  private move(): TerminalMove | null {
    const layout: DockNode = this.dockState.layout();
    const editor: StackNode | null = firstStackOfRole(layout, 'main');
    const terminal: StackNode | null = findStackOfPanel(layout, EDITOR_TERMINAL_PANEL_ID);
    if (editor === null || terminal === null) {
      return null;
    }
    return {
      stackId: editor.id,
      side: isBeneath(layout, editor.id, terminal.id) ? 'right' : 'bottom',
    };
  }

  /**
   * Cuts the terminal buffer to the clipboard.
   */
  protected onCut(): void {
    this.pane()?.cut();
  }

  /**
   * Copies the terminal selection to the clipboard.
   */
  protected onCopy(): void {
    this.pane()?.copy();
  }

  /**
   * Clears the terminal screen.
   */
  protected onClear(): void {
    this.pane()?.clear();
  }

  /**
   * Writes the tab's pending run command to the terminal, then clears it.
   */
  private flushPending(): void {
    const command: string | null = this.editorTerminals.takePending(this.tabId());
    if (command !== null) {
      this.pane()?.runCommand(command);
    }
  }
}

/**
 * Determines whether one group is directly beneath another: both held by one split stacking its children.
 * @param node The layout.
 * @param aboveId The identifier of the group above.
 * @param belowId The identifier of the group beneath.
 * @returns Returns true when it is.
 */
function isBeneath(node: DockNode, aboveId: string, belowId: string): boolean {
  if (isStackNode(node)) {
    return false;
  }
  const ids: readonly string[] = node.children.map((child: DockNode): string => child.id);
  return (
    (node.dir === 'col' && ids.includes(aboveId) && ids.indexOf(belowId) > ids.indexOf(aboveId)) ||
    node.children.some((child: DockNode): boolean => isBeneath(child, aboveId, belowId))
  );
}
