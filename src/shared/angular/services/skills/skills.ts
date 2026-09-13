import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  Skill,
  SkillChannel,
  SkillClient,
  SkillDraft,
  SkillSaveResult,
} from '@shared/api/skill-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * The renderer's view of the skill library (#301): the list as last read from disk, and the edits
 * that go back through the bridge. Every mutation re-reads the list afterwards rather than patching
 * it locally, because the library is on disk where the user may also be editing it, and the disk is
 * the truth.
 *
 * Outside Electron there is no bridge and therefore no library; the list stays empty and every edit
 * reports that it could not be made.
 */
@Service()
export class Skills implements SkillClient {
  /**
   * Holds the bridge, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the skills as last listed.
   */
  private readonly skillsState: WritableSignal<readonly Skill[]> = signal<readonly Skill[]>([]);

  /**
   * Holds whether a read of the library is in flight.
   */
  private readonly loadingState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the skills, sorted by name.
   */
  public readonly skills: Signal<readonly Skill[]> = this.skillsState.asReadonly();

  /**
   * Gets whether the library is being read.
   */
  public readonly loading: Signal<boolean> = this.loadingState.asReadonly();

  /**
   * Initializes the service, reading the library once.
   */
  public constructor() {
    void this.reload();
  }

  /**
   * Re-reads the library from disk.
   * @returns Resolves once the list is current.
   */
  public async reload(): Promise<void> {
    this.loadingState.set(true);
    try {
      this.skillsState.set(await this.list());
    } finally {
      this.loadingState.set(false);
    }
  }

  /**
   * Lists every skill in the library.
   * @returns Returns the skills.
   */
  public async list(): Promise<readonly Skill[]> {
    return (await this.bridge?.invoke<readonly Skill[]>(SkillChannel.List)) ?? [];
  }

  /**
   * Creates or updates a skill, then re-reads the library.
   * @param draft The draft to store.
   * @returns Returns the outcome.
   */
  public async save(draft: SkillDraft): Promise<SkillSaveResult> {
    const result: SkillSaveResult = (await this.bridge?.invoke<SkillSaveResult>(
      SkillChannel.Save,
      draft,
    )) ?? { skill: null, error: 'The skill library is only available in the desktop app.' };
    if (result.error === null) {
      this.log.info('Skills', `Skill saved '${draft.name}'`);
    } else {
      this.log.warn('Skills', `Skill '${draft.name}' refused: ${result.error}`);
    }
    await this.reload();
    return result;
  }

  /**
   * Deletes a skill, then re-reads the library.
   * @param name The skill's name.
   * @returns Resolves once the folder is gone.
   */
  public async delete(name: string): Promise<void> {
    await this.bridge?.invoke<void>(SkillChannel.Delete, name);
    this.log.info('Skills', `Skill deleted '${name}'`);
    await this.reload();
  }

  /**
   * Reveals a skill's folder in the file manager.
   * @param name The skill's name.
   * @returns Resolves once the request is issued.
   */
  public async reveal(name: string): Promise<void> {
    await this.bridge?.invoke<void>(SkillChannel.Reveal, name);
  }

  /**
   * Opens the library folder in the file manager.
   * @returns Resolves once the request is issued.
   */
  public async openLibrary(): Promise<void> {
    await this.bridge?.invoke<void>(SkillChannel.OpenLibrary);
  }

  /**
   * Imports a skill chosen through the platform dialog, then re-reads the library.
   * @returns Returns the outcome, or null when the dialog was cancelled.
   */
  public async import(): Promise<SkillSaveResult | null> {
    const result: SkillSaveResult | null =
      (await this.bridge?.invoke<SkillSaveResult | null>(SkillChannel.Import)) ?? null;
    if (result !== null) {
      await this.reload();
    }
    return result;
  }
}
