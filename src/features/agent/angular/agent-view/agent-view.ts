import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
} from '@angular/core';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';

/**
 * Hosts the agent conversation as a top-level tab. The chat shell lives in {@link AgentChat}, which
 * owns this tab's own agent session — the transcript is per-tab, not shared with other agent tabs or
 * the dockable agent panel.
 */
@Component({
  selector: 'app-agent-view',
  imports: [AgentChat],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView implements OnDestroy {
  /**
   * Holds the active agent session registry the accelerators drive: stopping the in-flight run and
   * starting a fresh conversation both act on whichever session is active.
   */
  private readonly sessions: AgentSessions = inject(AgentSessions);

  /**
   * Holds the application keybinding router this view registers its accelerators with while active.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds a value indicating whether this view's accelerators are currently registered, so activation
   * changes register and release them exactly once.
   */
  private registered: boolean = false;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Initializes a new instance of the {@link AgentView} class, wiring the effect that registers or
   * releases the keyboard accelerators as the view's active state changes.
   */
  public constructor() {
    effect((): void => {
      const id: string | undefined = this.tabId();
      if (id === undefined) {
        return;
      }
      if (this.isActive()) {
        if (!this.registered) {
          this.registerKeybindings(id);
          this.registered = true;
        }
      } else if (this.registered) {
        this.keybindings.deactivate(id);
        this.registered = false;
      }
    });
  }

  /**
   * Releases the keyboard accelerators when the view is torn down.
   */
  public ngOnDestroy(): void {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
      this.keybindings.forget(id);
    }
  }

  /**
   * Registers the agent tab's keyboard accelerators: Mod+. stops the in-flight run (the cancel
   * convention) and Mod+Shift+N starts a fresh conversation. Both are non-typing chords, so they do
   * not interfere with the message composer.
   * @param id The owning tab identifier.
   */
  private registerKeybindings(id: string): void {
    this.keybindings.register(id, [
      { chord: 'Mod+.', command: (): void => this.sessions.stop() },
      { chord: 'Mod+Shift+N', command: (): void => this.sessions.newChat() },
    ]);
  }
}
