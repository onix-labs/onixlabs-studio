import {
  computed,
  effect,
  inject,
  OnDestroy,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { MirrorAction, MirrorSession, MirrorState } from '@shared/api/terminal-mirror-channels';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { findNode, findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { Studio } from '@shared/angular/services/studio/studio';
import { TerminalMirrorBridge } from '@shared/angular/services/terminal-mirror/terminal-mirror-bridge';
import {
  TERMINAL_PANEL_ID,
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';

/**
 * Coordinates popping this view's terminal panel out into its own OS window and back.
 *
 * The view's {@link TerminalSessions} store remains the single OWNER of the sessions throughout —
 * build and run flows keep launching, terminating, and problem-matching against it unchanged. While
 * popped out, this coordinator mirrors the store's metadata to the pop-out window (which renders
 * the strip and hosts persistent panes attached by session id) and applies the strip actions the
 * pop-out sends back. The pop-out never disposes a PTY: its panes are viewers, and closing its
 * window simply returns the panel to the dock — to the stack and tab position it left, when they
 * still exist.
 *
 * Provided per view alongside the dock services and the session store, so each workspace tab pops
 * its own panel independently.
 */
@Service()
export class TerminalPopout implements OnDestroy {
  /**
   * Holds the window-chrome bridge used to open, close, and focus the pop-out window.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the mirror relay client this coordinator publishes through.
   */
  private readonly mirror: TerminalMirrorBridge = inject(TerminalMirrorBridge);

  /**
   * Holds the owning view's terminal sessions — the state being mirrored.
   */
  private readonly sessions: TerminalSessions = inject(TerminalSessions);

  /**
   * Holds the view's dock state, the panel is removed from and restored to.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the reveal helper used to surface the panel after it docks back.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the popped-panels registry reveals consult while the panel is away.
   */
  private readonly popouts: PopoutPanels = inject(PopoutPanels);

  /**
   * Holds the owning tab's context, for the pop-out window's title and mirrored root.
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Holds the pop-out's window identifier, or null while the panel is docked.
   */
  private readonly window: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the dock position the panel left, so docking back restores it: the stack it was in and
   * its tab index there. Null when the panel was not in the layout when popped.
   */
  private origin: { stackId: string; index: number } | null = null;

  /**
   * Holds the subscription disposers.
   */
  private readonly unsubscribes: (() => void)[] = [];

  /**
   * Gets a value indicating whether the terminal panel is popped out.
   */
  public readonly poppedOut: Signal<boolean> = computed((): boolean => this.window() !== null);

  /**
   * Initializes a new instance of the {@link TerminalPopout} class, wiring the mirror protocol and
   * the pop-out lifecycle.
   */
  public constructor() {
    this.unsubscribes.push(
      // The dock group chrome offers pop-out for panels registered here.
      this.popouts.registerPopOut(TERMINAL_PANEL_ID, (): void => {
        void this.popOut();
      }),
      this.mirror.onReady((popoutId: number): void => {
        if (popoutId === this.window()) {
          this.publish();
        }
      }),
      this.mirror.onAction((popoutId: number, action: MirrorAction): void => {
        if (popoutId === this.window()) {
          this.applyAction(action);
        }
      }),
      this.studio.onPopoutClosed((popoutId: number): void => {
        if (popoutId === this.window()) {
          this.handleClosed();
        }
      }),
    );

    // Republish on every owner-side change while popped: the strip, the active session, and the
    // root all render in the pop-out from this state.
    effect((): void => {
      const popoutId: number | null = this.window();
      if (popoutId === null) {
        return;
      }
      this.sessions.sessions();
      this.sessions.activeId();
      this.context.root();
      untracked((): void => this.publish());
    });

    // A popped panel with nothing left to show returns home: the root changed (disposing every
    // session) or the user closed the last tab in the pop-out.
    effect((): void => {
      if (this.window() !== null && this.sessions.sessions().length === 0) {
        untracked((): void => this.dockBack());
      }
    });
  }

  /**
   * Pops the terminal panel out into its own OS window, remembering where in the dock it came from.
   * When it is already popped out, its window is focused instead.
   */
  public async popOut(): Promise<void> {
    const existing: number | null = this.window();
    if (existing !== null) {
      void this.studio.focusPopoutWindow(existing);
      return;
    }

    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), TERMINAL_PANEL_ID);
    this.origin =
      stack === null
        ? null
        : { stackId: stack.id, index: stack.panels.indexOf(TERMINAL_PANEL_ID) };

    const root: string | null = this.context.root();
    const title: string =
      root === null ? 'Terminal' : `Terminal — ${root.split(/[\\/]/).pop() ?? root}`;
    const popoutId: number | null = await this.studio.openPopoutWindow({
      panel: 'terminal',
      title,
    });
    if (popoutId === null) {
      // The window could not open; the panel stays where it is.
      return;
    }

    // Remove the panel only once the window exists, so a failed open never leaves the dock bare.
    // The unmounting panes detach as viewers; the pop-out's panes attach and replay, so the output
    // produced in between is never lost.
    this.dockState.removeFromLayout(TERMINAL_PANEL_ID);
    this.popouts.markPopped(TERMINAL_PANEL_ID, popoutId);
    this.window.set(popoutId);
  }

  /**
   * Returns the panel to the dock by closing its pop-out window (the close notification performs
   * the actual re-docking, so a window closed by its own controls follows the same path).
   */
  public dockBack(): void {
    const popoutId: number | null = this.window();
    if (popoutId !== null) {
      void this.studio.closePopoutWindow(popoutId);
    }
  }

  /**
   * Handles the pop-out window having closed — by the dock-back action, its own close button, or
   * the main process — returning the panel to the dock.
   */
  private handleClosed(): void {
    this.window.set(null);
    this.popouts.clear(TERMINAL_PANEL_ID);
    this.returnPanel();
  }

  /**
   * Restores the terminal panel to the dock: to the stack and tab index it left when they still
   * exist, otherwise docked to the bottom edge; then reveals it.
   */
  private returnPanel(): void {
    const tree: DockNode = this.dockState.layout();
    if (findStackOfPanel(tree, TERMINAL_PANEL_ID) === null) {
      const origin: { stackId: string; index: number } | null = this.origin;
      const originStack: DockNode | null =
        origin === null ? null : findNode(tree, origin.stackId);
      if (origin !== null && originStack !== null && originStack.kind === 'stack') {
        this.dockState.tabInto(origin.stackId, TERMINAL_PANEL_ID);
        const placed: DockNode | null = findNode(this.dockState.layout(), origin.stackId);
        if (placed !== null && placed.kind === 'stack') {
          const from: number = placed.panels.indexOf(TERMINAL_PANEL_ID);
          const to: number = Math.min(origin.index, placed.panels.length - 1);
          if (from !== -1 && from !== to) {
            this.dockState.reorderTab(origin.stackId, from, to);
          }
        }
      } else {
        this.dockState.dockEdge(TERMINAL_PANEL_ID, 'bottom');
      }
    }
    this.origin = null;
    this.dockReveal.reveal(TERMINAL_PANEL_ID);
  }

  /**
   * Applies a strip action the pop-out mirror requested to the owning session store.
   * @param action The requested action.
   */
  private applyAction(action: MirrorAction): void {
    switch (action.kind) {
      case 'activate':
        if (action.id !== undefined) {
          this.sessions.activate(action.id);
        }
        break;
      case 'close':
        if (action.id !== undefined) {
          this.sessions.close(action.id);
        }
        break;
      case 'rename':
        if (action.id !== undefined && action.name !== undefined) {
          this.sessions.rename(action.id, action.name);
        }
        break;
      case 'new-shell':
        this.sessions.create();
        break;
      case 'dock-back':
        this.dockBack();
        break;
    }
  }

  /**
   * Publishes the owner's current state to the pop-out window.
   */
  private publish(): void {
    const popoutId: number | null = this.window();
    if (popoutId === null) {
      return;
    }
    const state: MirrorState = {
      sessions: this.sessions.sessions().map(
        (session: TerminalSession): MirrorSession => ({
          id: session.id,
          name: session.name,
          kind: session.kind,
          generation: session.generation,
          exitCode: session.exitCode,
          ...(session.cwd !== undefined ? { cwd: session.cwd } : {}),
          ...(session.shell !== undefined ? { shell: session.shell } : {}),
        }),
      ),
      activeId: this.sessions.activeId(),
      root: this.context.root(),
    };
    this.mirror.publish(popoutId, state);
  }

  /**
   * Closes the pop-out window when the owning view goes away. The panel is not re-docked — the
   * view's dock is being destroyed with it.
   */
  public ngOnDestroy(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    const popoutId: number | null = this.window();
    if (popoutId !== null) {
      void this.studio.closePopoutWindow(popoutId);
    }
  }
}
