import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MirrorSession, MirrorState } from '@shared/api/terminal-mirror-channels';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { Icon } from '@shared/angular/icons/icon';
import { TerminalMirrorBridge } from '@shared/angular/services/terminal-mirror/terminal-mirror-bridge';

/**
 * Renders the popped-out terminal panel: the workspace window's session strip, mirrored. The
 * workspace window OWNS the sessions — this panel renders the mirrored metadata, hosts persistent
 * panes attached by session id (which replay their buffers and receive the live stream via the
 * per-session routing), and round-trips every strip action back to the owner. Nothing here ever
 * disposes a PTY: the panes are viewers, and closing this window returns the panel to the dock.
 */
@Component({
  selector: 'app-terminal-popout-panel',
  imports: [Terminal, AppIcon, PanelToolbar, PanelStatus],
  templateUrl: './terminal-popout-panel.html',
  styleUrl: './terminal-popout-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPopoutPanel implements OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the mirror client this panel receives state from and sends actions through.
   */
  private readonly mirror: TerminalMirrorBridge = inject(TerminalMirrorBridge);

  /**
   * Gets the mirrored state: the strip in tab order, the active session, and the root.
   */
  protected readonly state: WritableSignal<MirrorState> = signal<MirrorState>({
    sessions: [],
    activeId: null,
    root: null,
  });

  /**
   * Gets the active mirrored session, for the status strip.
   */
  protected readonly activeSession: Signal<MirrorSession | null> = computed(
    (): MirrorSession | null =>
      this.state().sessions.find(
        (session: MirrorSession): boolean => session.id === this.state().activeId,
      ) ?? null,
  );

  /**
   * Holds the session currently being renamed inline, or null when none.
   */
  protected readonly editingId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the disposer for the state subscription.
   */
  private readonly unsubscribe: () => void;

  /**
   * Initializes a new instance of the {@link TerminalPopoutPanel} class, subscribing to the owner's
   * state and announcing readiness so the owner publishes it.
   */
  public constructor() {
    this.unsubscribe = this.mirror.onState((state: MirrorState): void => this.state.set(state));
    this.mirror.ready();
  }

  /**
   * Activates a session in the owning store.
   * @param id The session identifier.
   */
  protected activate(id: string): void {
    this.mirror.sendAction({ kind: 'activate', id });
  }

  /**
   * Closes a session in the owning store (disposing its process) without activating it first.
   * @param id The session identifier.
   * @param event The originating click, whose propagation to the tab is stopped.
   */
  protected close(id: string, event: Event): void {
    event.stopPropagation();
    this.mirror.sendAction({ kind: 'close', id });
  }

  /**
   * Asks the owning store for a new shell session.
   */
  protected create(): void {
    this.mirror.sendAction({ kind: 'new-shell' });
  }

  /**
   * Begins renaming a session inline.
   * @param session The session to rename.
   */
  protected startRename(session: MirrorSession): void {
    this.editingId.set(session.id);
  }

  /**
   * Commits an inline rename to the owning store, unless it was already cancelled.
   * @param id The session identifier.
   * @param event The input event carrying the new name.
   */
  protected commitRename(id: string, event: Event): void {
    if (this.editingId() !== id) {
      return;
    }
    this.mirror.sendAction({ kind: 'rename', id, name: (event.target as HTMLInputElement).value });
    this.editingId.set(null);
  }

  /**
   * Cancels an inline rename, discarding the edit.
   */
  protected cancelRename(): void {
    this.editingId.set(null);
  }

  /**
   * Reduces a shell executable path to its base name for display.
   * @param shell The shell executable path, or undefined.
   * @returns Returns the base name, or a neutral label when unknown.
   */
  protected shellName(shell: string | undefined): string {
    if (shell === undefined || shell.length === 0) {
      return 'shell';
    }
    return shell.split(/[\\/]/).pop() ?? shell;
  }

  /**
   * Stops mirroring when the panel goes away.
   */
  public ngOnDestroy(): void {
    this.unsubscribe();
  }
}
