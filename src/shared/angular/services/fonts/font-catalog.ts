import { computed, DOCUMENT, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import type { ChoiceOption } from '@shared/angular/services/settings/settings-schema';

/**
 * Names the value used by the sans-serif "System Default" option: it maps to no specific family, so
 * the platform's own default UI font is used. It is always offered and never probed.
 */
export const SYSTEM_DEFAULT_FONT: string = 'System Default';

/**
 * Defines a candidate font in the catalog: the {@link family} is both the persisted value and the CSS
 * family name probed for installation; {@link label} is the display name.
 */
interface FontCandidate {
  readonly family: string;
  readonly label: string;
}

/**
 * Holds the monospace candidates offered to the code and Markdown font pickers, in display order. Only
 * those detected as installed are surfaced, plus the always-present default (JetBrains Mono, bundled).
 */
const MONOSPACE_CANDIDATES: readonly FontCandidate[] = [
  { family: 'JetBrains Mono', label: 'JetBrains Mono' },
  { family: 'Consolas', label: 'Consolas' },
  { family: 'SF Mono', label: 'SF Mono' },
  { family: 'Menlo', label: 'Menlo' },
  { family: 'Monaco', label: 'Monaco' },
  { family: 'Cascadia Code', label: 'Cascadia Code' },
  { family: 'Cascadia Mono', label: 'Cascadia Mono' },
  { family: 'Fira Code', label: 'Fira Code' },
  { family: 'Source Code Pro', label: 'Source Code Pro' },
  { family: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { family: 'Roboto Mono', label: 'Roboto Mono' },
  { family: 'Ubuntu Mono', label: 'Ubuntu Mono' },
  { family: 'DejaVu Sans Mono', label: 'DejaVu Sans Mono' },
  { family: 'Courier New', label: 'Courier New' },
];

/**
 * Holds the sans-serif candidates offered to the Markdown body font picker, in display order.
 */
const SANS_CANDIDATES: readonly FontCandidate[] = [
  { family: 'Inter', label: 'Inter' },
  { family: 'Roboto', label: 'Roboto' },
  { family: 'Open Sans', label: 'Open Sans' },
  { family: 'Lato', label: 'Lato' },
  { family: 'Source Sans Pro', label: 'Source Sans Pro' },
  { family: 'Segoe UI', label: 'Segoe UI' },
  { family: 'Helvetica Neue', label: 'Helvetica Neue' },
  { family: 'Arial', label: 'Arial' },
  { family: 'Verdana', label: 'Verdana' },
];

/**
 * Enumerates the monospace and sans-serif fonts actually installed on the machine, so the font
 * settings offer real choices rather than a hardcoded list that might not render.
 *
 * Detection uses the classic canvas width-comparison technique: a probe string is measured in each
 * generic baseline (monospace/sans-serif/serif) and again in `"Candidate", <baseline>`; the candidate
 * is installed when at least one measurement differs from its baseline (the candidate, not the
 * fallback, drew the glyphs). It runs once after `document.fonts.ready` so bundled webfonts (such as
 * JetBrains Mono) are loaded first, and the result is exposed through signals so the pickers update
 * reactively. The known defaults are always included so a picker never renders empty.
 */
@Service()
export class FontCatalog {
  /**
   * Holds the document whose canvas and font set back the detection.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the set of candidate families detected as installed. Seeded empty and filled once detection
   * completes; the derived option signals recompute when it changes.
   */
  private readonly installed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the monospace font options for a font picker: the bundled default plus every detected
   * monospace family, in catalog order.
   */
  public readonly monospaceFonts: Signal<readonly ChoiceOption[]> = this.buildOptions(
    MONOSPACE_CANDIDATES,
    ['JetBrains Mono'],
  );

  /**
   * Gets the sans-serif font options for the Markdown body font picker: the "System Default" option
   * plus every detected sans-serif family, in catalog order.
   */
  public readonly sansFonts: Signal<readonly ChoiceOption[]> = this.buildOptions(SANS_CANDIDATES, [
    SYSTEM_DEFAULT_FONT,
  ]);

  /**
   * Detects the installed candidates once the font set is ready. Guarded so a non-browser or
   * canvas-less environment simply keeps the always-present defaults.
   */
  public constructor() {
    const ready: Promise<unknown> | undefined = this.document.fonts?.ready;
    if (ready !== undefined) {
      void ready.then((): void => this.detect());
    } else {
      this.detect();
    }
  }

  /**
   * Builds a reactive option list: the given always-present families followed by the detected
   * candidates not already present, mapped to {@link ChoiceOption}s (value and label are the family).
   * @param candidates The candidate families to probe.
   * @param always The families offered regardless of detection (defaults and "System Default").
   * @returns Returns a signal of the option list.
   */
  private buildOptions(
    candidates: readonly FontCandidate[],
    always: readonly string[],
  ): Signal<readonly ChoiceOption[]> {
    return computed((): readonly ChoiceOption[] => {
      const installed: ReadonlySet<string> = this.installed();
      const options: ChoiceOption[] = always.map((family: string): ChoiceOption => ({
        value: family,
        label: family,
      }));
      for (const candidate of candidates) {
        if (!always.includes(candidate.family) && installed.has(candidate.family)) {
          options.push({ value: candidate.family, label: candidate.label });
        }
      }
      return options;
    });
  }

  /**
   * Probes every candidate family and publishes the installed set.
   */
  private detect(): void {
    const context: CanvasRenderingContext2D | null = this.document
      .createElement('canvas')
      .getContext('2d');
    if (!context) {
      this.log.warn('FontCatalog', 'Font detection skipped; no 2D canvas context');
      return;
    }
    const probe: string = 'mmmmmmmmmmlliWWWWWWWWWW0123456789';
    const size: string = '72px';
    const baselines: readonly string[] = ['monospace', 'sans-serif', 'serif'];
    const baselineWidths: Map<string, number> = new Map<string, number>();
    for (const baseline of baselines) {
      context.font = `${size} ${baseline}`;
      baselineWidths.set(baseline, context.measureText(probe).width);
    }
    const installed: Set<string> = new Set<string>();
    for (const candidate of [...MONOSPACE_CANDIDATES, ...SANS_CANDIDATES]) {
      const present: boolean = baselines.some((baseline: string): boolean => {
        context.font = `${size} "${candidate.family}", ${baseline}`;
        return context.measureText(probe).width !== baselineWidths.get(baseline);
      });
      if (present) {
        installed.add(candidate.family);
      }
    }
    this.installed.set(installed);
    this.log.debug('FontCatalog', `Detected ${installed.size} installed font families`);
  }
}
