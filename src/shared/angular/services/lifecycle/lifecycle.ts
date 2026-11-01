import { inject, Service } from '@angular/core';
import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { SaveDialogChoice } from '@shared/api/file-channels';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { Dormancy } from '@shared/angular/services/dormancy/dormancy';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { RunningWork } from '@shared/angular/services/running-work/running-work';
import { Settings } from '@shared/angular/services/settings/settings';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';

/**
 * Answers the main process's request to close the window. It first asks whether to quit at all, as
 * Confirm Before Quitting says (always, or only while agents, runs, builds or debugging are going).
 * When the window is closing, it walks the
 * documents with unsaved changes and prompts to save, discard, or cancel each one (reusing the native
 * confirm-save dialog), saves any agent conversation still holding back a change, then tells the main
 * process whether to proceed. Cancelling any prompt — or a
 * cancelled save-as — keeps the window open. Outside Electron the bridge is absent and the service is
 * inert.
 */
@Service()
export class Lifecycle {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the registry of unsaved-work sources (the static text/binary documents plus any view-scoped
   * workspace document wells), walked at close time.
   */
  private readonly unsavedWork: UnsavedWorkRegistry = inject(UnsavedWorkRegistry);

  /**
   * Holds the file-system service used to prompt for saving.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the conversation store client, whose held-back saves are made before the window closes.
   */
  private readonly conversations: AgentConversations = inject(AgentConversations);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, read for Confirm Before Quitting.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the live agents, counted as running work.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds every workspace's runs and builds, counted as running work.
   */
  private readonly runningWork: RunningWork = inject(RunningWork);

  /**
   * Holds the debugger, whose session counts as running work.
   */
  private readonly debugger: Debugger = inject(Debugger);

  /**
   * Holds the open tabs, closed when the window closes while Studio keeps running.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds whether Studio is dormant, set when its window closes while it keeps running.
   */
  private readonly dormancy: Dormancy = inject(Dormancy);

  /**
   * Initializes a new instance of the {@link Lifecycle} class, subscribing to close, park and wake
   * requests.
   */
  public constructor() {
    this.bridge?.on(AppChannel.RequestClose, (): void => {
      void this.onRequestClose();
    });
    this.bridge?.on(AppChannel.RequestPark, (): void => {
      void this.onRequestPark();
    });
    this.bridge?.on(AppChannel.Wake, (): void => this.dormancy.wake());
  }

  /**
   * Handles the window closing on macOS while Studio keeps running in the Dock. The window's work goes
   * with it, as when quitting — running work is confirmed, unsaved changes are resolved — then every
   * tab closes and Studio goes dormant, showing nothing until the Dock icon wakes it to the welcome
   * screen.
   * @returns Returns a promise that resolves once the decision has been sent.
   */
  private async onRequestPark(): Promise<void> {
    this.log.info('Lifecycle', 'Window close requested; Studio keeps running');
    const proceed: boolean =
      (await this.confirmQuit('close')) && (await this.confirmUnsavedChanges());
    if (proceed) {
      await this.conversations.savePending();
      this.closeEveryTab();
      this.dormancy.sleep();
    }
    this.log.info('Lifecycle', `Window close ${proceed ? 'confirmed' : 'cancelled'}`);
    this.bridge?.send(AppChannel.ConfirmPark, proceed);
  }

  /**
   * Closes every tab once its unsaved changes have been resolved: stops the agents working in them,
   * lets every document store release what each held, and removes the tabs.
   */
  private closeEveryTab(): void {
    for (const host of this.agentHosts.hosts()) {
      if (host.agent.isRunning()) {
        host.agent.stop();
      }
    }
    for (const tab of [...this.tabs.tabs()] as readonly Tab[]) {
      for (const source of this.unsavedWork.sources()) {
        source.release(tab.id);
      }
      this.tabs.close(tab.id);
    }
  }

  /**
   * Handles a close request: resolves any unsaved work, then answers the main process.
   * @returns Returns a promise that resolves once the decision has been sent.
   */
  private async onRequestClose(): Promise<void> {
    this.log.info('Lifecycle', 'Window close requested');
    const proceed: boolean =
      (await this.confirmQuit('quit')) && (await this.confirmUnsavedChanges());
    if (proceed) {
      await this.conversations.savePending();
    }
    this.log.info('Lifecycle', `Window close ${proceed ? 'confirmed' : 'cancelled'}`);
    this.bridge?.send(AppChannel.ConfirmClose, proceed);
  }

  /**
   * Asks whether to quit, or to close the window while Studio keeps running, as Confirm Before
   * Quitting says: always, only while work is running, or never. Running work is live agents, every
   * workspace's runs and builds, and a debug session. Closing the window while Studio keeps running
   * follows the same rule: its tabs close with it.
   * @param ending Whether Studio is quitting or only its window is closing.
   * @returns Returns true when Studio may go on.
   */
  private async confirmQuit(ending: 'quit' | 'close'): Promise<boolean> {
    const mode: string = this.settings.get('application.confirmBeforeQuitting');
    if (mode === 'never') {
      return true;
    }
    const running: readonly string[] = this.runningWorkSummary();
    if (mode === 'when-working' && running.length === 0) {
      return true;
    }
    this.log.info('Lifecycle', `Confirming ${ending}`, running);
    if (ending === 'close') {
      return this.fileSystem.confirmDestructive({
        title: 'Close Window',
        message:
          running.length === 0 ? 'Close the window?' : 'Close the window while work is running?',
        detail:
          running.length === 0
            ? 'Its tabs close, and Studio keeps running in the Dock.'
            : `Still running: ${joinList(running)}. Closing the window stops it.`,
        confirmLabel: 'Close Window',
      });
    }
    return this.fileSystem.confirmDestructive({
      title: 'Quit Studio',
      message: running.length === 0 ? 'Quit Studio?' : 'Quit Studio while work is running?',
      detail:
        running.length === 0
          ? 'You can turn this question off in Settings › Application › General.'
          : `Still running: ${joinList(running)}. Quitting stops it.`,
      confirmLabel: 'Quit',
    });
  }

  /**
   * Describes the work running now, one phrase per kind (for example "2 agents").
   * @returns Returns the phrases, empty when nothing is running.
   */
  private runningWorkSummary(): readonly string[] {
    const phrases: string[] = [];
    const agents: number = this.agentHosts.runningCount();
    if (agents > 0) {
      phrases.push(agents === 1 ? '1 agent' : `${agents} agents`);
    }
    const runs: number = this.runningWork.count();
    if (runs > 0) {
      phrases.push(runs === 1 ? '1 run or build' : `${runs} runs and builds`);
    }
    if (this.debugger.running()) {
      phrases.push('a debug session');
    }
    return phrases;
  }

  /**
   * Prompts for each document with unsaved changes in turn, saving or discarding per the user's
   * choice. Prompts are shown one at a time because each is a modal dialog.
   * @returns Returns true when the window may close, or false when the user cancelled.
   */
  private async confirmUnsavedChanges(): Promise<boolean> {
    // Prompts are awaited one at a time: each is a modal dialog, and the save follows its own prompt.
    for (const source of this.unsavedWork.sources()) {
      for (const unsaved of source.dirtyDocuments()) {
        this.log.info('Lifecycle', `Prompting for unsaved document '${unsaved.name}'`);
        const choice: SaveDialogChoice = await this.fileSystem.confirmSave(unsaved.name);
        if (choice === 'cancel') {
          return false;
        }
        if (choice === 'save' && !(await source.save(unsaved.id))) {
          // The user cancelled the save-as dialog; abort the close so the work is not lost.
          return false;
        }
      }
    }
    return true;
  }
}

/**
 * Joins phrases into an English list: "a", "a and b", "a, b and c".
 * @param phrases The phrases to join.
 * @returns Returns the joined list.
 */
function joinList(phrases: readonly string[]): string {
  if (phrases.length <= 1) {
    return phrases[0] ?? '';
  }
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}
