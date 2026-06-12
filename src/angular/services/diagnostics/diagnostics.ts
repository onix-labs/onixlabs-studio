import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Monaco } from '../monaco/monaco';
import { MonacoDiagnosticsProvider } from './monaco-diagnostics-provider';

/**
 * Identifies the severity of a diagnostic, from most to least serious.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Describes a single, provider-agnostic diagnostic: a problem reported against a file at a position.
 */
export interface Diagnostic {
  /**
   * Gets the display name of the file the diagnostic is reported against.
   */
  readonly file: string;

  /**
   * Gets the human-readable problem message.
   */
  readonly message: string;

  /**
   * Gets the severity of the diagnostic.
   */
  readonly severity: DiagnosticSeverity;

  /**
   * Gets the 1-based line the diagnostic starts on.
   */
  readonly line: number;

  /**
   * Gets the 1-based column the diagnostic starts on.
   */
  readonly column: number;

  /**
   * Gets the producing source (for example, `typescript`), or an empty string when unknown.
   */
  readonly source: string;
}

/**
 * Describes a source of diagnostics. A provider connects once and pushes its full current set
 * whenever it changes; the service merges every provider's set. This is the seam future language
 * back-ends (LSP clients, compilers) plug into alongside the built-in Monaco-markers provider.
 */
export interface DiagnosticsProvider {
  /**
   * Gets the unique identifier of the provider, used to key its contribution.
   */
  readonly id: string;

  /**
   * Connects the provider, supplying a callback it invokes with its full current diagnostic set
   * whenever that set changes.
   * @param onChange Receives the provider's current diagnostics.
   * @returns Returns a function that disconnects the provider.
   */
  connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void;
}

/**
 * Specifies the sort weight of each severity, so errors sort ahead of warnings and so on.
 */
const SEVERITY_ORDER: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/**
 * Represents the application's provider-agnostic diagnostics aggregate. Providers register their
 * current diagnostics here; the service merges, sorts (severity, then file, then line), and exposes
 * them as signals for the Problems panel. The built-in Monaco-markers provider is registered on
 * construction; additional providers (LSP, compilers) can be added later through {@link register}.
 */
@Service()
export class Diagnostics {
  /**
   * Holds the Monaco service backing the built-in markers provider.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds each provider's current diagnostics, keyed by provider id.
   */
  private readonly bySource: Map<string, readonly Diagnostic[]> = new Map<
    string,
    readonly Diagnostic[]
  >();

  /**
   * Holds the merged, sorted diagnostics across all providers.
   */
  private readonly merged: WritableSignal<readonly Diagnostic[]> = signal<readonly Diagnostic[]>(
    [],
  );

  /**
   * Gets the merged, sorted diagnostics across all registered providers.
   */
  public readonly all: Signal<readonly Diagnostic[]> = this.merged.asReadonly();

  /**
   * Gets the number of error-severity diagnostics.
   */
  public readonly errorCount: Signal<number> = computed(
    (): number =>
      this.all().filter((diagnostic: Diagnostic): boolean => diagnostic.severity === 'error')
        .length,
  );

  /**
   * Gets the number of warning-severity diagnostics.
   */
  public readonly warningCount: Signal<number> = computed(
    (): number =>
      this.all().filter((diagnostic: Diagnostic): boolean => diagnostic.severity === 'warning')
        .length,
  );

  /**
   * Initializes a new instance of the {@link Diagnostics} class, registering the built-in
   * Monaco-markers provider.
   */
  public constructor() {
    this.register(new MonacoDiagnosticsProvider(this.monaco));
  }

  /**
   * Registers a diagnostics provider, merging its contributions into the aggregate as they change.
   * @param provider The provider to register.
   * @returns Returns a function that unregisters the provider and drops its diagnostics.
   */
  public register(provider: DiagnosticsProvider): () => void {
    const disconnect: () => void = provider.connect((diagnostics: readonly Diagnostic[]): void => {
      this.bySource.set(provider.id, diagnostics);
      this.recompute();
    });
    return (): void => {
      this.bySource.delete(provider.id);
      this.recompute();
      disconnect();
    };
  }

  /**
   * Rebuilds the merged, sorted diagnostics signal from every provider's contribution.
   */
  private recompute(): void {
    const merged: Diagnostic[] = [];
    for (const diagnostics of this.bySource.values()) {
      merged.push(...diagnostics);
    }
    merged.sort(
      (a: Diagnostic, b: Diagnostic): number =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column,
    );
    this.merged.set(merged);
  }
}
