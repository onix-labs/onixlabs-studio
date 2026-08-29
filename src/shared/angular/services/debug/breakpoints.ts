import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * The storage key the breakpoints are persisted under.
 */
const BREAKPOINTS_KEY: string = 'debug.breakpoints';

/**
 * Describes a source breakpoint: a line in a file, optionally conditional or a logpoint, that a debug
 * session halts (or logs) at. Keyed by the containing file's absolute path in the {@link Breakpoints}
 * store.
 */
export interface Breakpoint {
  /**
   * Gets the 1-based line the breakpoint sits on.
   */
  readonly line: number;

  /**
   * Gets the expression that must evaluate truthy for the breakpoint to halt, or undefined for an
   * unconditional breakpoint.
   */
  readonly condition?: string;

  /**
   * Gets the message logged (with `{expression}` interpolation) instead of halting, turning the
   * breakpoint into a logpoint, or undefined for an ordinary breakpoint.
   */
  readonly logMessage?: string;

  /**
   * Gets whether the breakpoint is enabled. A disabled breakpoint is kept and shown but not sent to the
   * adapter.
   */
  readonly enabled: boolean;

  /**
   * Gets whether the adapter has verified (bound) the breakpoint in the running session. Transient
   * session state, never persisted; false when no session is running.
   */
  readonly verified: boolean;
}

/**
 * The verification an adapter reports for a file's breakpoints after a `setBreakpoints` request, used
 * to reflect bound (verified) versus pending breakpoints back in the gutter.
 */
export interface BreakpointVerification {
  /**
   * Gets the line the adapter bound the breakpoint to (it may differ from the requested line).
   */
  readonly line: number | undefined;

  /**
   * Gets whether the adapter verified the breakpoint.
   */
  readonly verified: boolean;
}

/**
 * Holds the persisted breakpoints, grouped by absolute file path, with the transient {@link
 * Breakpoint.verified} flag stripped.
 */
type PersistedBreakpoints = Record<string, readonly PersistedBreakpoint[]>;

/**
 * Holds one persisted breakpoint (everything but the transient verification).
 */
interface PersistedBreakpoint {
  readonly line: number;
  readonly condition?: string;
  readonly logMessage?: string;
  readonly enabled: boolean;
}

/**
 * Represents the workspace's breakpoints, keyed by absolute file path. It is the single source of truth
 * the editor gutter draws from and the debug session synchronises to the adapter, and it survives a
 * reload by persisting through {@link SettingsStore} — mirroring how {@link
 * import('../recent-items/recent-items').RecentItems} persists. Breakpoints are per-developer state, so
 * they are kept in local storage rather than the shared, committed `.studio` file. The verification an
 * adapter reports is layered on transiently and never persisted.
 */
@Service()
export class Breakpoints {
  /**
   * Holds the persistence backend.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the breakpoints keyed by absolute file path, seeded from persisted storage.
   */
  private readonly state: WritableSignal<ReadonlyMap<string, readonly Breakpoint[]>> = signal<
    ReadonlyMap<string, readonly Breakpoint[]>
  >(restore(this.store.get<unknown>(BREAKPOINTS_KEY, null)));

  /**
   * Gets the breakpoints keyed by absolute file path.
   */
  public readonly all: Signal<ReadonlyMap<string, readonly Breakpoint[]>> = this.state.asReadonly();

  /**
   * Gets the paths that currently hold at least one breakpoint.
   */
  public readonly paths: Signal<readonly string[]> = computed((): readonly string[] => [
    ...this.state().keys(),
  ]);

  /**
   * Gets the breakpoints for a file, in ascending line order. Reads the reactive state, so callers in a
   * reactive context re-run when the file's breakpoints change.
   * @param path The absolute file path.
   * @returns Returns the file's breakpoints, or an empty list when it has none.
   */
  public forPath(path: string): readonly Breakpoint[] {
    return this.state().get(path) ?? [];
  }

  /**
   * Toggles a breakpoint at a line: adds an enabled breakpoint when none is there, or removes the
   * existing one.
   * @param path The absolute file path.
   * @param line The 1-based line.
   */
  public toggle(path: string, line: number): void {
    if (this.forPath(path).some((breakpoint: Breakpoint): boolean => breakpoint.line === line)) {
      this.remove(path, line);
    } else {
      this.add(path, line);
    }
  }

  /**
   * Adds an enabled breakpoint at a line, or replaces the existing one at that line. Ignores a
   * non-positive line.
   * @param path The absolute file path.
   * @param line The 1-based line.
   * @param options The condition and log message, when creating a conditional breakpoint or logpoint.
   */
  public add(
    path: string,
    line: number,
    options: { condition?: string; logMessage?: string } = {},
  ): void {
    if (line < 1) {
      return;
    }
    const breakpoint: Breakpoint = {
      line,
      condition: emptyToUndefined(options.condition),
      logMessage: emptyToUndefined(options.logMessage),
      enabled: true,
      verified: false,
    };
    this.replace(path, line, breakpoint);
  }

  /**
   * Removes the breakpoint at a line, dropping the file's entry once it has none left.
   * @param path The absolute file path.
   * @param line The 1-based line.
   */
  public remove(path: string, line: number): void {
    const remaining: readonly Breakpoint[] = this.forPath(path).filter(
      (breakpoint: Breakpoint): boolean => breakpoint.line !== line,
    );
    this.commit(path, remaining);
  }

  /**
   * Updates a breakpoint's condition, log message, and enabled flag. Does nothing when no breakpoint is
   * at the line.
   * @param path The absolute file path.
   * @param line The 1-based line.
   * @param patch The fields to change.
   */
  public update(
    path: string,
    line: number,
    patch: { condition?: string; logMessage?: string; enabled?: boolean },
  ): void {
    const existing: Breakpoint | undefined = this.forPath(path).find(
      (breakpoint: Breakpoint): boolean => breakpoint.line === line,
    );
    if (existing === undefined) {
      return;
    }
    this.replace(path, line, {
      ...existing,
      condition:
        patch.condition === undefined ? existing.condition : emptyToUndefined(patch.condition),
      logMessage:
        patch.logMessage === undefined ? existing.logMessage : emptyToUndefined(patch.logMessage),
      enabled: patch.enabled ?? existing.enabled,
      // A changed definition is unverified until the adapter re-binds it.
      verified: false,
    });
  }

  /**
   * Applies an adapter's verification for a file's enabled breakpoints, matching the response entries to
   * the enabled breakpoints by order (the order `setBreakpoints` was sent in). Transient: not persisted.
   * @param path The absolute file path.
   * @param verifications The per-breakpoint verification, in the order the breakpoints were sent.
   */
  public applyVerification(path: string, verifications: readonly BreakpointVerification[]): void {
    const current: readonly Breakpoint[] = this.forPath(path);
    if (current.length === 0) {
      return;
    }
    let index: number = 0;
    const next: Breakpoint[] = current.map((breakpoint: Breakpoint): Breakpoint => {
      if (!breakpoint.enabled) {
        return breakpoint.verified ? { ...breakpoint, verified: false } : breakpoint;
      }
      const verification: BreakpointVerification | undefined = verifications[index++];
      const verified: boolean = verification?.verified ?? false;
      return breakpoint.verified === verified ? breakpoint : { ...breakpoint, verified };
    });
    this.setWithoutPersist(path, next);
  }

  /**
   * Clears all verification, used when a session ends so no breakpoint shows as bound. Transient.
   */
  public clearVerification(): void {
    const next: Map<string, readonly Breakpoint[]> = new Map<string, readonly Breakpoint[]>();
    for (const [path, list] of this.state()) {
      next.set(
        path,
        list.map((breakpoint: Breakpoint): Breakpoint =>
          breakpoint.verified ? { ...breakpoint, verified: false } : breakpoint,
        ),
      );
    }
    this.state.set(next);
  }

  /**
   * Replaces (or inserts) the breakpoint at a line, keeping the file's list in ascending line order.
   * @param path The absolute file path.
   * @param line The 1-based line the breakpoint sits on.
   * @param breakpoint The breakpoint to store.
   */
  private replace(path: string, line: number, breakpoint: Breakpoint): void {
    const others: readonly Breakpoint[] = this.forPath(path).filter(
      (existing: Breakpoint): boolean => existing.line !== line,
    );
    const next: Breakpoint[] = [...others, breakpoint].sort(
      (left: Breakpoint, right: Breakpoint): number => left.line - right.line,
    );
    this.commit(path, next);
  }

  /**
   * Sets a file's breakpoints, dropping the entry when the list is empty, and persists.
   * @param path The absolute file path.
   * @param list The file's breakpoints.
   */
  private commit(path: string, list: readonly Breakpoint[]): void {
    const next: Map<string, readonly Breakpoint[]> = new Map<string, readonly Breakpoint[]>(
      this.state(),
    );
    if (list.length === 0) {
      next.delete(path);
    } else {
      next.set(path, list);
    }
    this.state.set(next);
    this.persist();
  }

  /**
   * Sets a file's breakpoints without persisting, used for transient verification updates.
   * @param path The absolute file path.
   * @param list The file's breakpoints.
   */
  private setWithoutPersist(path: string, list: readonly Breakpoint[]): void {
    const next: Map<string, readonly Breakpoint[]> = new Map<string, readonly Breakpoint[]>(
      this.state(),
    );
    next.set(path, list);
    this.state.set(next);
  }

  /**
   * Persists the current breakpoints, stripping the transient verification.
   */
  private persist(): void {
    const persisted: Record<string, readonly PersistedBreakpoint[]> = {};
    for (const [path, list] of this.state()) {
      persisted[path] = list.map((breakpoint: Breakpoint): PersistedBreakpoint => ({
        line: breakpoint.line,
        condition: breakpoint.condition,
        logMessage: breakpoint.logMessage,
        enabled: breakpoint.enabled,
      }));
    }
    this.store.set<PersistedBreakpoints>(BREAKPOINTS_KEY, persisted);
  }
}

/**
 * Normalises an empty or whitespace-only string to undefined, so a cleared condition or log message is
 * stored as absent rather than an empty string.
 * @param value The value to normalise.
 * @returns Returns the trimmed value, or undefined when empty.
 */
function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed: string | undefined = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Reconstructs the breakpoints map from an untrusted persisted value, dropping any entry that does not
 * match the expected shape rather than throwing.
 * @param raw The value read from storage.
 * @returns Returns the validated map, or an empty map when nothing usable is present.
 */
function restore(raw: unknown): ReadonlyMap<string, readonly Breakpoint[]> {
  const result: Map<string, readonly Breakpoint[]> = new Map<string, readonly Breakpoint[]>();
  if (raw === null || typeof raw !== 'object') {
    return result;
  }
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const list: Breakpoint[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record: Record<string, unknown> = entry as Record<string, unknown>;
      if (typeof record['line'] !== 'number' || record['line'] < 1) {
        continue;
      }
      list.push({
        line: record['line'],
        condition: typeof record['condition'] === 'string' ? record['condition'] : undefined,
        logMessage: typeof record['logMessage'] === 'string' ? record['logMessage'] : undefined,
        enabled: record['enabled'] !== false,
        verified: false,
      });
    }
    if (list.length > 0) {
      result.set(path, list);
    }
  }
  return result;
}
