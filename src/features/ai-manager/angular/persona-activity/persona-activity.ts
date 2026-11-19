import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type { PersonaChange } from '@shared/api/pete-protocol';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { Pete } from '@shared/angular/services/persona/pete';
import { Settings } from '@shared/angular/services/settings/settings';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';

/**
 * How many recent changes the panel lists.
 */
const RECENT_SHOWN: number = 10;

/**
 * One recent change as the panel lists it.
 */
interface ChangeRow {
  readonly id: string;
  readonly verb: string;
  readonly name: string;
  readonly when: string;
}

/**
 * Pete's side of the Persona page (#1516): whether he is learning and on what, what he changed lately
 * (each change undoable), and the topics he must never learn about. Shown under the persona's overview.
 */
@Component({
  selector: 'app-persona-activity',
  imports: [Button, TextField],
  templateUrl: './persona-activity.html',
  styleUrl: './persona-activity.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaActivity {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds Pete.
   */
  protected readonly pete: Pete = inject(Pete);

  /**
   * Holds the settings.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the deep link into Settings.
   */
  private readonly settingsNavigation: SettingsNavigation = inject(SettingsNavigation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the topic being typed.
   */
  protected readonly topicDraft: WritableSignal<string> = signal<string>('');

  /**
   * Gets what Pete is doing, in a sentence.
   */
  protected readonly status: Signal<string> = computed((): string => {
    const connection: string = this.settings.value('persona.peteConnectionId')();
    if (connection.length === 0) {
      return 'Pete is off. Choose a connection for him to start learning from your conversations.';
    }
    if (this.settings.value('persona.petePaused')()) {
      return 'Pete is paused.';
    }
    if (this.pete.running()) {
      return 'Pete is reading your conversations…';
    }
    const last: number = this.pete.state().lastRun;
    return last === 0
      ? 'Pete is learning. He has not finished a run yet.'
      : `Pete is learning. Last run ${describeWhen(last)}.`;
  });

  /**
   * Gets whether Pete may be asked to look now: he is on and not already reading.
   */
  protected readonly canRun: Signal<boolean> = computed(
    (): boolean =>
      this.settings.value('persona.peteConnectionId')().length > 0 &&
      !this.settings.value('persona.petePaused')() &&
      !this.pete.running(),
  );

  /**
   * Gets the recent changes, newest first.
   */
  protected readonly recent: Signal<readonly ChangeRow[]> = computed((): readonly ChangeRow[] =>
    this.pete
      .state()
      .recent.slice(0, RECENT_SHOWN)
      .map((change: PersonaChange): ChangeRow => ({
        id: change.id,
        verb: change.kind === 'add' ? 'Added' : change.kind === 'remove' ? 'Removed' : 'Changed',
        name: (change.after ?? change.before)?.name ?? change.entryId,
        when: describeWhen(change.at),
      })),
  );

  /**
   * Gets the ruled-out topics.
   */
  protected readonly ruledOut: Signal<readonly string[]> = computed(
    (): readonly string[] => this.pete.state().ruledOut,
  );

  /**
   * Opens Pete's settings.
   */
  protected openSettings(): void {
    this.settingsNavigation.open('ai-manager-persona');
  }

  /**
   * Has Pete look for conversations to read now, rather than at his next tick.
   */
  protected runNow(): void {
    void this.pete.tick();
  }

  /**
   * Undoes a change.
   * @param changeId The change.
   * @returns Resolves once undone.
   */
  protected async undo(changeId: string): Promise<void> {
    const undone: boolean = await this.pete.undo(changeId);
    this.log.info(
      'aiManager.persona',
      undone ? 'Undid a change Pete made' : 'Change to undo was gone',
    );
  }

  /**
   * Rules out the topic being typed.
   * @returns Resolves once recorded.
   */
  protected async addTopic(): Promise<void> {
    const topic: string = this.topicDraft().trim();
    if (topic.length === 0) {
      return;
    }
    this.topicDraft.set('');
    await this.pete.ruleOut([...this.ruledOut(), topic]);
  }

  /**
   * Lets Pete learn about a topic again.
   * @param topic The topic.
   * @returns Resolves once recorded.
   */
  protected async removeTopic(topic: string): Promise<void> {
    await this.pete.ruleOut(
      this.ruledOut().filter((candidate: string): boolean => candidate !== topic),
    );
  }
}

/**
 * Says when something happened, roughly.
 * @param at The moment (epoch milliseconds).
 * @returns Returns the phrase.
 */
export function describeWhen(at: number): string {
  const minutes: number = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours: number = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return new Date(at).toLocaleDateString();
}
