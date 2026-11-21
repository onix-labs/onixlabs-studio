import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GatePluginOutcome, GatePluginResult } from './gate-plugin-result';

/**
 * The install gate's running record: what happened to each plugin, and anything else found on the
 * way. Written to `summary.json` after every change, so a run that dies part-way still leaves what it
 * learned for `scripts/e2e-install.mjs` to print.
 */
export class GateReport {
  /**
   * Holds the plugins, in the order they were offered.
   */
  private readonly plugins: Map<string, GatePluginResult> = new Map<string, GatePluginResult>();

  /**
   * Holds what was found that is not one plugin's outcome.
   */
  private readonly findings: string[] = [];

  /**
   * Holds when the run started.
   */
  private readonly started: number = Date.now();

  /**
   * Holds how long the first launch's setup took, in seconds, once it has finished.
   */
  private setupSeconds: number | undefined = undefined;

  /**
   * Holds facts about the run: the distribution, Studio's version, the toolchains.
   */
  private readonly facts: Map<string, string> = new Map<string, string>();

  /**
   * Creates the report.
   * @param file The summary file.
   */
  public constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.write();
  }

  /**
   * Records a plugin's outcome, replacing any earlier one for it.
   * @param result The outcome.
   */
  public plugin(result: GatePluginResult): void {
    this.plugins.set(result.id, result);
    this.write();
  }

  /**
   * Marks a plugin that passed setup as failed afterwards, keeping the first reason it failed for.
   * @param id The plugin.
   * @param reason Why.
   */
  public fail(id: string, reason: string): void {
    const result: GatePluginResult | undefined = this.plugins.get(id);
    if (result === undefined || result.outcome === 'fail') {
      return;
    }
    this.plugin({ ...result, outcome: 'fail', reason });
  }

  /**
   * Gets the plugins recorded with an outcome.
   * @param outcome The outcome.
   * @returns Returns them.
   */
  public withOutcome(outcome: GatePluginOutcome): readonly GatePluginResult[] {
    return [...this.plugins.values()].filter(
      (result: GatePluginResult): boolean => result.outcome === outcome,
    );
  }

  /**
   * Gets every plugin recorded.
   * @returns Returns them.
   */
  public all(): readonly GatePluginResult[] {
    return [...this.plugins.values()];
  }

  /**
   * Records something found that is not one plugin's outcome.
   * @param finding What.
   */
  public finding(finding: string): void {
    this.findings.push(finding);
    this.write();
  }

  /**
   * Records a fact about the run.
   * @param name The fact.
   * @param value Its value.
   */
  public fact(name: string, value: string): void {
    this.facts.set(name, value);
    this.write();
  }

  /**
   * Records that the first launch's setup has finished.
   */
  public setupFinished(): void {
    this.setupSeconds = Math.round((Date.now() - this.started) / 1000);
    this.write();
  }

  /**
   * Writes the summary.
   */
  public write(): void {
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        {
          facts: Object.fromEntries(this.facts),
          plugins: [...this.plugins.values()],
          findings: this.findings,
          setupSeconds: this.setupSeconds,
          totalSeconds: Math.round((Date.now() - this.started) / 1000),
        },
        null,
        2,
      ),
    );
  }
}
