import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  SkillExportResult,
  SkillImportChannel,
  SkillImportCommit,
  SkillImportPlan,
  SkillImportResult,
} from '@shared/api/skill-import-channels';
import { Log } from '@shared/angular/services/log/log';
import { Persona } from '@shared/angular/services/persona/persona';
import { Skills } from './skills';

/**
 * The renderer's side of importing into and exporting out of the AI libraries (#1263): it asks the
 * main process to scan a folder the user picks, sends back what the user accepted, and re-reads both
 * libraries once something was written. Outside Electron there is nothing to scan or write, and every
 * call resolves as if the dialog were cancelled.
 */
@Service()
export class SkillTransfer {
  /**
   * Holds the bridge, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the skill library, re-read after an import.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Holds the persona, re-read after an import that carried entries for it.
   */
  private readonly persona: Persona = inject(Persona);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether import and export are possible here at all.
   */
  public readonly isAvailable: boolean = this.bridge !== undefined;

  /**
   * Asks the user for a folder or file to import from, and scans it.
   * @returns Returns the plan, or null when the dialog was cancelled.
   */
  public async choose(): Promise<SkillImportPlan | null> {
    return (await this.bridge?.invoke<SkillImportPlan | null>(SkillImportChannel.Choose)) ?? null;
  }

  /**
   * Asks the user for Markdown files, a folder of them or an export to import into the persona,
   * and scans them.
   * @returns Returns the plan, holding persona entries only, or null when the dialog was cancelled.
   */
  public async choosePersona(): Promise<SkillImportPlan | null> {
    return (
      (await this.bridge?.invoke<SkillImportPlan | null>(SkillImportChannel.ChoosePersona)) ?? null
    );
  }

  /**
   * Writes what the user accepted, then re-reads the libraries.
   * @param commit What was accepted.
   * @returns Returns the outcome.
   */
  public async commit(commit: SkillImportCommit): Promise<SkillImportResult> {
    const result: SkillImportResult = (await this.bridge?.invoke<SkillImportResult>(
      SkillImportChannel.Commit,
      commit,
    )) ?? {
      skills: 0,
      persona: 0,
      linksRewritten: 0,
      error: 'Importing is only available in the desktop app.',
    };
    if (result.error === null) {
      this.log.info(
        'SkillTransfer',
        `Imported ${result.skills} skill(s), ${result.persona} persona entries`,
      );
      await this.skills.reload();
      if (result.persona > 0) {
        await this.persona.reload();
      }
    } else {
      this.log.warn('SkillTransfer', `Import refused: ${result.error}`);
    }
    return result;
  }

  /**
   * Forgets a plan the user cancelled.
   * @param planId The plan's id.
   * @returns Resolves once the main process has let it go.
   */
  public async discard(planId: string): Promise<void> {
    await this.bridge?.invoke<void>(SkillImportChannel.Discard, planId);
  }

  /**
   * Asks the user where to export to, and exports the skills and the persona there.
   * @returns Returns the outcome, or null when the dialog was cancelled.
   */
  public async export(): Promise<SkillExportResult | null> {
    const result: SkillExportResult | null =
      (await this.bridge?.invoke<SkillExportResult | null>(SkillImportChannel.Export)) ?? null;
    if (result !== null) {
      this.log.info('SkillTransfer', result.error ?? `Exported to ${result.folder ?? ''}`);
    }
    return result;
  }
}
