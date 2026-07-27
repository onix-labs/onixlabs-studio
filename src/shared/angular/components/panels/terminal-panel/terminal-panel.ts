import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import {
  TerminalSession,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';

/**
 * Hosts one or more interactive terminals as a dockable IDE panel for a workspace or repository tab. It
 * embeds the shared {@link Terminal} pane once per session — all mounted at once, only the active one
 * visible — so switching between terminals never tears a PTY down. A tab strip switches, closes, and
 * renames terminals, and a New Terminal button adds one; the shells are rooted at the tab's folder (or
 * repository root), so a tab with no folder open shows a prompt instead.
 *
 * The panel is a view over the owning tab's {@link TerminalSessions} (provided at the view level, not
 * here): tool stacks destroy an inactive panel when another activates, so the sessions and their PTYs
 * live with the tab, and the panes it embeds are persistent — re-mounting the panel re-attaches each
 * pane to its session, replaying the output produced while the panel was away.
 */
@Component({
  selector: 'app-terminal-panel',
  imports: [Terminal, AppIcon, PanelToolbar, PanelStatus],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; the panel reads its
   * tab context from {@link DockTabContext} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets a value indicating whether the panel belongs to the active dock tab, so the visible terminal
   * refits and focuses when the panel is shown.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the owning tab's context (its id and rooted folder).
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Holds this panel's terminal sessions.
   */
  private readonly terminals: TerminalSessions = inject(TerminalSessions);

  /**
   * Gets the absolute path the terminals' shells start in, or null when no folder is open.
   */
  protected readonly root: Signal<string | null> = this.context.root;

  /**
   * Gets the terminal sessions in tab order.
   */
  protected readonly sessions: Signal<readonly TerminalSession[]> = this.terminals.sessions;

  /**
   * Gets the active session's identifier, or null when there are none.
   */
  protected readonly activeId: Signal<string | null> = this.terminals.activeId;

  /**
   * Gets the active session, for the status strip.
   */
  protected readonly activeSession: Signal<TerminalSession | null> = this.terminals.activeSession;

  /**
   * Holds the session currently being renamed inline, or null when none.
   */
  protected readonly editingId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the inline rename box, focused when a rename begins (the `autofocus` attribute is unreliable
   * on dynamically-inserted content and flagged for accessibility).
   */
  private readonly renameInput: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /**
   * Initializes the panel, asking the session store for a shell once a folder is known. The store's
   * root is announced by the owning view (not here), so a command session launched before this panel
   * ever mounts is never disturbed by the mount. It also focuses the rename box whenever an inline
   * rename begins, so the name can be typed straight away.
   */
  public constructor() {
    effect((): void => {
      if (this.root() !== null) {
        untracked((): void => this.terminals.ensureShell());
      }
    });

    effect((): void => {
      if (this.editingId() !== null) {
        const input: HTMLInputElement | undefined = this.renameInput()?.nativeElement;
        if (input !== undefined) {
          setTimeout((): void => input.focus(), 0);
        }
      }
    });
  }

  /**
   * Adds a new terminal and makes it active.
   */
  protected create(): void {
    this.terminals.create();
  }

  /**
   * Activates a terminal.
   * @param id The session identifier.
   */
  protected activate(id: string): void {
    this.terminals.activate(id);
  }

  /**
   * Closes a terminal without activating it first.
   * @param id The session identifier.
   * @param event The originating click, whose propagation to the tab is stopped.
   */
  protected close(id: string, event: Event): void {
    event.stopPropagation();
    this.terminals.close(id);
  }

  /**
   * Begins renaming a terminal inline.
   * @param session The session to rename.
   */
  protected startRename(session: TerminalSession): void {
    this.editingId.set(session.id);
  }

  /**
   * Commits an inline rename, unless it was already cancelled (so the blur that follows an Escape does
   * not overwrite the name).
   * @param id The session identifier.
   * @param event The input event carrying the new name.
   */
  protected commitRename(id: string, event: Event): void {
    if (this.editingId() !== id) {
      return;
    }
    this.terminals.rename(id, (event.target as HTMLInputElement).value);
    this.editingId.set(null);
  }

  /**
   * Cancels an inline rename, discarding the edit.
   */
  protected cancelRename(): void {
    this.editingId.set(null);
  }

  /**
   * Records the shell a terminal spawned, so the status strip can show it.
   * @param id The session identifier.
   * @param shell The spawned shell executable path.
   */
  protected onShell(id: string, shell: string): void {
    this.terminals.setShell(id, shell);
  }

  /**
   * Reduces a shell executable path to its base name for display (for example `/bin/zsh` → `zsh`).
   * @param shell The shell executable path, or undefined.
   * @returns Returns the base name, or a neutral label when unknown.
   */
  protected shellName(shell: string | undefined): string {
    if (shell === undefined || shell.length === 0) {
      return 'shell';
    }
    return shell.split(/[\\/]/).pop() ?? shell;
  }
}
