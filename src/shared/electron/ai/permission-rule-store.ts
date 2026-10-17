import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '@shared/electron/logger';

/**
 * The file (under userData) the remembered permission rules live in.
 */
const STORE_FILE: string = 'agent-permission-rules.json';

/**
 * The tools that run whatever command they are given: the Claude harness's shell, Studio's terminal
 * tools, the document runner and a container run (#979). A grant for one of them is remembered for the
 * exact command the prompt showed, never for the tool, because "Always" on one harmless `ls` must not
 * become a prompt-free shell for every later command in every workspace.
 */
const COMMAND_TOOLS: ReadonlySet<string> = new Set<string>([
  'Bash',
  'write_terminal_input',
  'open_terminal',
  'run_active_document',
  'run_container',
]);

/**
 * The longest command summary that can still be the whole command. Summaries are clamped to 120
 * characters with a trailing ellipsis (`tool-format.ts`), and a clamped one names only the start of a
 * command, so it cannot key an exact-command rule.
 */
const MAX_WHOLE_COMMAND_CHARS: number = 117;

/**
 * Separates a command tool's name from its command in a rule key. A NUL never appears in either, so a
 * key cannot be forged by a tool name or a command that contains the separator.
 */
const COMMAND_SEPARATOR: string = '\u0000';

/**
 * How long a grant for a tool can be remembered: `tool` for any use of it, `command` for the exact
 * command it was asked to run, or `session` when only the session can remember it — a command tool
 * whose summary is empty or clamped, so the prompt cannot name the whole command.
 */
export type PermissionRuleScope = 'tool' | 'command' | 'session';

/**
 * Determines how a grant for a tool's use can be remembered (#979).
 * @param tool The tool's display name.
 * @param detail The one-line summary the prompt showed.
 * @returns Returns the scope a remembered grant takes.
 */
export function permissionRuleScope(tool: string, detail: string): PermissionRuleScope {
  if (!COMMAND_TOOLS.has(tool)) {
    return 'tool';
  }
  const clamped: boolean = detail.length > MAX_WHOLE_COMMAND_CHARS && detail.endsWith('...');
  return detail.length === 0 || clamped ? 'session' : 'command';
}

/**
 * Gets the key a remembered grant is stored and looked up by: the tool's name, or for a command tool
 * its name and the exact command.
 * @param tool The tool's display name.
 * @param detail The one-line summary the prompt showed.
 * @returns Returns the rule key, or null when the grant cannot be remembered beyond the session.
 */
export function permissionRuleKey(tool: string, detail: string): string | null {
  switch (permissionRuleScope(tool, detail)) {
    case 'tool':
      return tool;
    case 'command':
      return `${tool}${COMMAND_SEPARATOR}${detail}`;
    default:
      return null;
  }
}

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
 * in-memory set and die with the app. Rules key on {@link permissionRuleKey}: the tool's display name
 * (the name the permission prompt showed, which both the Claude and AI-SDK paths pass identically),
 * or for a command tool its name and the exact command (#979). Reads and writes are
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
   * Determines whether a rule is remembered as allowed for a run.
   * @param tool The rule key ({@link permissionRuleKey}).
   * @param workspaceRoot The run's workspace root, or null for none.
   * @returns Returns true when a global or matching workspace rule allows the tool.
   */
  public isAllowed(tool: string, workspaceRoot: string | null): boolean {
    this.ensureLoaded();
    if (this.always.has(tool)) {
      logger.debug('PermissionRuleStore', `Rule allows '${tool}' (always)`);
      return true;
    }
    const workspaceAllows: boolean =
      workspaceRoot !== null && (this.workspaces.get(workspaceRoot)?.has(tool) ?? false);
    logger.trace(
      'PermissionRuleStore',
      `Rule lookup for '${tool}' (workspace=${workspaceRoot ?? 'none'}): ${workspaceAllows ? 'allowed' : 'no rule'}`,
    );
    return workspaceAllows;
  }

  /**
   * Records a remembered grant and persists it.
   * @param tool The rule key ({@link permissionRuleKey}).
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
        logger.warn(
          'PermissionRuleStore',
          `Ignoring workspace grant for '${tool}': no workspace root to key it on`,
        );
        return;
      }
      const tools: Set<string> = this.workspaces.get(workspaceRoot) ?? new Set<string>();
      tools.add(tool);
      this.workspaces.set(workspaceRoot, tools);
    }
    logger.info(
      'PermissionRuleStore',
      `Remembered permission grant for '${tool}' (scope=${scope}${scope === 'workspace' ? `, root=${workspaceRoot}` : ''})`,
    );
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
        logger.warn('PermissionRuleStore', 'Ignoring malformed permission rule store');
        return;
      }
      this.always = this.withoutCommandTools(parsed.always);
      this.workspaces = new Map<string, Set<string>>(
        Object.entries(parsed.workspaces).map(
          ([root, tools]: [string, readonly string[]]): [string, Set<string>] => [
            root,
            this.withoutCommandTools(tools),
          ],
        ),
      );
      const stored: number = [parsed.always, ...Object.values(parsed.workspaces)].reduce(
        (sum: number, keys: readonly string[]): number => sum + new Set<string>(keys).size,
        0,
      );
      const kept: number = [this.always, ...this.workspaces.values()].reduce(
        (sum: number, keys: Set<string>): number => sum + keys.size,
        0,
      );
      const dropped: number = stored - kept;
      if (dropped > 0) {
        // A grant saved before #979 allowed a command tool outright. It is forgotten, so the next use
        // asks again and can be remembered for its exact command instead.
        logger.warn(
          'PermissionRuleStore',
          `Forgot ${dropped} remembered grant(s) that allowed a command tool for any command`,
        );
        this.persist();
      }
      logger.debug(
        'PermissionRuleStore',
        `Loaded permission rules: ${this.always.size} always, ${this.workspaces.size} workspace(s)`,
      );
    } catch {
      // A missing or unreadable store simply means no remembered rules.
      logger.trace('PermissionRuleStore', 'No permission rule store to load');
    }
  }

  /**
   * Gets a set of rule keys without any that allow a command tool for any command.
   * @param keys The stored rule keys.
   * @returns Returns the keys that remain valid.
   */
  private withoutCommandTools(keys: readonly string[]): Set<string> {
    return new Set<string>(keys.filter((key: string): boolean => !COMMAND_TOOLS.has(key)));
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
      logger.debug('PermissionRuleStore', `Saved permission rules to ${this.file()}`);
    } catch (error: unknown) {
      // Persistence is best-effort; the grant still applies for this session.
      logger.error('PermissionRuleStore', 'Failed to persist permission rules', error);
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
