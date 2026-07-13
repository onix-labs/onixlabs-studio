import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The file (under userData) the remembered permission rules live in.
 */
const STORE_FILE: string = 'agent-permission-rules.json';

/**
 * The persisted shape: tools allowed everywhere, and tools allowed per workspace root. Only grants
 * are ever stored — denials are never remembered, so a mis-click cannot silently brick a tool.
 */
interface StoredRules {
  readonly always: readonly string[];
  readonly workspaces: Readonly<Record<string, readonly string[]>>;
}

/**
 * Owns the user's remembered permission decisions (#241): which tools are always allowed, globally or
 * per workspace. Session-scoped grants are deliberately NOT here — they live in {@link AiManager}'s
 * in-memory set and die with the app. Rules key on the tool's display name (the name the permission
 * prompt showed), which both the Claude and AI-SDK paths pass identically. Reads and writes are
 * best-effort in the store idiom: a corrupt or unwritable file can never crash the app — it just
 * forgets, and the user is prompted again.
 */
export class PermissionRuleStore {
  /**
   * Holds the tools allowed everywhere.
   */
  private always: Set<string> = new Set<string>();

  /**
   * Holds the tools allowed per workspace root.
   */
  private workspaces: Map<string, Set<string>> = new Map<string, Set<string>>();

  /**
   * Tracks whether the persisted rules have been loaded.
   */
  private loaded: boolean = false;

  /**
   * Determines whether a tool is remembered as allowed for a run.
   * @param tool The tool's display name.
   * @param workspaceRoot The run's workspace root, or null for none.
   * @returns Returns true when a global or matching workspace rule allows the tool.
   */
  public isAllowed(tool: string, workspaceRoot: string | null): boolean {
    this.ensureLoaded();
    if (this.always.has(tool)) {
      return true;
    }
    return workspaceRoot !== null && (this.workspaces.get(workspaceRoot)?.has(tool) ?? false);
  }

  /**
   * Records a remembered grant and persists it.
   * @param tool The tool's display name.
   * @param scope Whether the grant applies to one workspace or everywhere.
   * @param workspaceRoot The workspace root a workspace-scoped grant applies to; a workspace grant
   * with no root is ignored (nothing sensible to key it on).
   */
  public remember(tool: string, scope: 'workspace' | 'always', workspaceRoot: string | null): void {
    this.ensureLoaded();
    if (scope === 'always') {
      this.always.add(tool);
    } else {
      if (workspaceRoot === null) {
        return;
      }
      const tools: Set<string> = this.workspaces.get(workspaceRoot) ?? new Set<string>();
      tools.add(tool);
      this.workspaces.set(workspaceRoot, tools);
    }
    this.persist();
  }

  /**
   * Loads the persisted rules once, tolerating a missing or malformed file.
   */
  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file(), 'utf8'));
      if (!this.isStoredRules(parsed)) {
        return;
      }
      this.always = new Set<string>(parsed.always);
      this.workspaces = new Map<string, Set<string>>(
        Object.entries(parsed.workspaces).map(
          ([root, tools]: [string, readonly string[]]): [string, Set<string>] => [
            root,
            new Set<string>(tools),
          ],
        ),
      );
    } catch {
      // A missing or unreadable store simply means no remembered rules.
    }
  }

  /**
   * Persists the rules. Best-effort.
   */
  private persist(): void {
    const value: StoredRules = {
      always: [...this.always],
      workspaces: Object.fromEntries(
        [...this.workspaces.entries()].map(
          ([root, tools]: [string, Set<string>]): [string, readonly string[]] => [root, [...tools]],
        ),
      ),
    };
    try {
      mkdirSync(dirname(this.file()), { recursive: true });
      writeFileSync(this.file(), JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Persistence is best-effort; the grant still applies for this session.
    }
  }

  /**
   * Determines whether a value is a well-formed persisted rule set.
   * @param value The value to test.
   * @returns Returns true when the shape is valid.
   */
  private isStoredRules(value: unknown): value is StoredRules {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const stringList: (candidate: unknown) => boolean = (candidate: unknown): boolean =>
      Array.isArray(candidate) &&
      candidate.every((entry: unknown): boolean => typeof entry === 'string');
    return (
      stringList(record['always']) &&
      typeof record['workspaces'] === 'object' &&
      record['workspaces'] !== null &&
      Object.values(record['workspaces']).every(stringList)
    );
  }

  /**
   * Gets the store file path under userData.
   * @returns Returns the absolute file path.
   */
  private file(): string {
    return join(app.getPath('userData'), STORE_FILE);
  }
}
