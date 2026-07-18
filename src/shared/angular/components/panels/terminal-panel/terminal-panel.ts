import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { TerminalSession, TerminalSessions } from './terminal-sessions';

/**
 * Hosts one or more interactive terminals as a dockable IDE panel for a workspace or repository tab. It
 * embeds the shared {@link Terminal} pane once per session — all mounted at once, only the active one
 * visible — so switching between terminals (or hiding the panel on a tab switch) never tears a PTY down.
 * A tab strip switches, closes, and renames terminals, and a New Terminal button adds one; the shells
 * are rooted at the tab's folder (or repository root), so a tab with no folder open shows a prompt
 * instead. The per-panel {@link TerminalSessions} owns the list, so each dock's terminal panel is
 * independent.
 */
@Component({
  selector: 'app-terminal-panel',
  imports: [Terminal, AppIcon],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TerminalSessions],
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
   * Initializes the panel, opening one terminal once a folder is known.
   */
  public constructor() {
    // Open with a terminal as soon as a folder is available; never spawn a shell before the root is
    // known (its working directory would be wrong).
    effect((): void => {
      if (this.root() !== null) {
        untracked((): void => this.terminals.ensureOne());
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
