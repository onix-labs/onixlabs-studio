import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type {
  PersonaChange,
  PersonaRebuildJob,
  PersonaSnapshot,
} from '@shared/api/persona-learning-protocol';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { PersonaLearning } from '@shared/angular/services/persona/persona-learning';
import { Settings } from '@shared/angular/services/settings/settings';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { PersonaRebuild } from '../persona-rebuild/persona-rebuild';

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
 * One kept copy of the persona as the panel lists it.
 */
interface SnapshotRow {
  readonly id: string;
  readonly when: string;
  readonly entries: number;
}

/**
 * The learning side of the Persona page (#1516): whether it is learning and on what, what it changed lately
 * (each change undoable), and the topics it must never learn about. Shown under the persona's overview.
 */
@Component({
  selector: 'app-persona-activity',
  imports: [Button, PersonaRebuild, TextField],
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
   * Holds persona learning.
   */
  protected readonly learning: PersonaLearning = inject(PersonaLearning);

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
   * Holds whether the rebuild dialog is open (#1518).
   */
  protected readonly rebuildOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the kept copies of the persona.
   */
  private readonly snapshotList: WritableSignal<readonly PersonaSnapshot[]> = signal<
    readonly PersonaSnapshot[]
  >([]);

  /**
   * Gets the rebuild under way, or null.
   */
  protected readonly rebuild: Signal<PersonaRebuildJob | null> = computed(
    (): PersonaRebuildJob | null => this.learning.state().rebuild,
  );

  /**
   * Gets the kept copies of the persona, newest first.
   */
  protected readonly snapshots: Signal<readonly SnapshotRow[]> = computed(
    (): readonly SnapshotRow[] =>
      this.snapshotList().map((copy: PersonaSnapshot): SnapshotRow => ({
        id: copy.id,
        when: copy.takenAt === 0 ? copy.id : new Date(copy.takenAt).toLocaleString(),
        entries: copy.entries,
      })),
  );

  /**
   * Lists the kept copies, again whenever the learning records change (a rebuild started fresh keeps one).
   */
  public constructor() {
    effect((): void => {
      this.learning.state();
      void this.loadSnapshots();
    });
  }

  /**
   * Gets what persona learning is doing, in a sentence.
   */
  protected readonly status: Signal<string> = computed((): string => {
    const connection: string = this.settings.value('persona.learningConnectionId')();
    if (connection.length === 0) {
      return 'Persona learning is off. Choose a connection to start learning from your conversations.';
    }
    if (this.settings.value('persona.learningPaused')()) {
      return 'Persona learning is paused.';
    }
    if (this.learning.running()) {
      return 'Reading your conversations…';
    }
    const last: number = this.learning.state().lastRun;
    return last === 0
      ? 'Persona learning is on. It has not finished a run yet.'
      : `Persona learning is on. Last run ${describeWhen(last)}.`;
  });

  /**
   * Gets whether persona learning may be asked to look now: it is on and not already reading.
   */
  protected readonly canRun: Signal<boolean> = computed(
    (): boolean =>
      this.settings.value('persona.learningConnectionId')().length > 0 &&
      !this.settings.value('persona.learningPaused')() &&
      !this.learning.running(),
  );

  /**
   * Gets the recent changes, newest first.
   */
  protected readonly recent: Signal<readonly ChangeRow[]> = computed((): readonly ChangeRow[] =>
    this.learning
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
   * Gets how many changes wait for review.
   */
  protected readonly pending: Signal<number> = computed(
    (): number => this.learning.state().pending.length,
  );

  /**
   * Gets the ruled-out topics.
   */
  protected readonly ruledOut: Signal<readonly string[]> = computed(
    (): readonly string[] => this.learning.state().ruledOut,
  );

  /**
   * Opens the learning settings.
   */
  protected openSettings(): void {
    this.settingsNavigation.open('ai-manager-persona');
  }

  /**
   * Has persona learning look for conversations to read now, rather than at its next tick.
   */
  protected runNow(): void {
    void this.learning.tick();
  }

  /**
   * Undoes a change.
   * @param changeId The change.
   * @returns Resolves once undone.
   */
  protected async undo(changeId: string): Promise<void> {
    const undone: boolean = await this.learning.undo(changeId);
    this.log.info(
      'aiManager.persona',
      undone ? 'Undid a learned change' : 'Change to undo was gone',
    );
  }

  /**
   * Cancels the rebuild under way. What it already learned stays.
   * @returns Resolves once cancelled.
   */
  protected async cancelRebuild(): Promise<void> {
    await this.learning.cancelRebuild();
    this.log.info('aiManager.persona', 'Persona rebuild cancelled');
  }

  /**
   * Puts a kept copy of the persona back. What stood before is kept as a copy of its own.
   * @param id The copy.
   * @returns Resolves once restored.
   */
  protected async restore(id: string): Promise<void> {
    const restored: boolean = await this.learning.restoreSnapshot(id);
    this.log.info(
      'aiManager.persona',
      restored ? `Restored the copy ${id}` : `Copy ${id} was gone`,
    );
    await this.loadSnapshots();
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
    await this.learning.ruleOut([...this.ruledOut(), topic]);
  }

  /**
   * Lets persona learning learn about a topic again.
   * @param topic The topic.
   * @returns Resolves once recorded.
   */
  protected async removeTopic(topic: string): Promise<void> {
    await this.learning.ruleOut(
      this.ruledOut().filter((candidate: string): boolean => candidate !== topic),
    );
  }

  /**
   * Reads the kept copies.
   * @returns Resolves once listed.
   */
  private async loadSnapshots(): Promise<void> {
    this.snapshotList.set(await this.learning.snapshots());
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
