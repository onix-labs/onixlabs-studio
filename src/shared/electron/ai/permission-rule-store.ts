import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AiPermissionGrant } from '@shared/api/ai/ai-bridge-types';
import { RUN_UNSANDBOXED } from '@shared/api/ai/ai-tool-policy';
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
 * command it was asked to run, `session` when only the session can remember it — a command tool
 * whose summary is empty or clamped, so the prompt cannot name the whole command — or `session-command`
 * for the exact command and only the session, which is all a run outside the sandbox can be: the one
 * permanent grant is excluding the command in the workspace's settings (D2, #1158).
 */
export type PermissionRuleScope = 'tool' | 'command' | 'session' | 'session-command';

/**
 * Determines how a grant for a tool's use can be remembered (#979).
 * @param tool The tool's display name.
 * @param detail The one-line summary the prompt showed.
 * @returns Returns the scope a remembered grant takes.
 */
export function permissionRuleScope(tool: string, detail: string): PermissionRuleScope {
  if (tool === RUN_UNSANDBOXED) {
    return 'session-command';
  }
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
 * Gets the key a session grant is held under: the tool's name, which covers every use of it for the
 * session, or the exact command for a grant that must not.
 * @param tool The tool's display name.
 * @param detail The summary the prompt showed.
 * @returns Returns the key.
 */
export function permissionSessionKey(tool: string, detail: string): string {
  return permissionRuleScope(tool, detail) === 'session-command'
    ? `${tool}${COMMAND_SEPARATOR}${detail}`
    : tool;
}

/**
 * Gets the tool a rule key names.
 * @param key The rule key ({@link permissionRuleKey}).
 * @returns Returns the tool's display name.
 */
export function permissionRuleTool(key: string): string {
  return key.split(COMMAND_SEPARATOR, 1)[0];
}

/**
 * The persisted shape: tools allowed everywhere, and tools allowed per workspace root. Only grants
 * are ever stored — denials are never remembered, so a mis-click cannot silently brick a tool.
 *
 * The other two fields are optional, and only ever read defensively, because a file from before them
 * must keep its grants: `grantedAt` is when each grant was made, by {@link grantId}, and `narrowed` is
 * the command tools whose tool-wide grants were dropped, until the user has been told.
 */
interface StoredRules {
  readonly always: readonly string[];
  readonly workspaces: Readonly<Record<string, readonly string[]>>;
  readonly grantedAt?: unknown;
  readonly narrowed?: unknown;
}

/**
 * Gets what a grant's date is held under: its rule key, and the workspace it applies to.
 * @param key The rule key.
 * @param workspaceRoot The workspace, or null for a grant that applies everywhere.
 * @returns Returns the id.
 */
function grantId(key: string, workspaceRoot: string | null): string {
  return `${workspaceRoot ?? ''}${COMMAND_SEPARATOR}${key}`;
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
   * Holds when each grant was made, by {@link grantId}. A grant from before this was kept has no entry.
   */
  private grantedAt: Map<string, string> = new Map<string, string>();

  /**
   * Holds the command tools whose tool-wide grants were dropped and the user has not yet been told of.
   */
  private narrowed: Set<string> = new Set<string>();

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
    const grantedAt: string = new Date().toISOString();
    if (scope === 'always') {
      this.always.add(tool);
      this.grantedAt.set(grantId(tool, null), grantedAt);
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
      this.grantedAt.set(grantId(tool, workspaceRoot), grantedAt);
    }
    logger.info(
      'PermissionRuleStore',
      `Remembered permission grant for '${tool}' (scope=${scope}${scope === 'workspace' ? `, root=${workspaceRoot}` : ''})`,
    );
    this.persist();
  }

  /**
   * Lists the remembered grants, those that apply everywhere first.
   * @returns Returns the grants.
   */
  public list(): readonly AiPermissionGrant[] {
    this.ensureLoaded();
    const scopes: readonly (readonly [string | null, ReadonlySet<string>])[] = [
      [null, this.always],
      ...this.workspaces.entries(),
    ];
    return scopes.flatMap(
      ([root, keys]: readonly [string | null, ReadonlySet<string>]): AiPermissionGrant[] =>
        [...keys].map((key: string): AiPermissionGrant => {
          const separator: number = key.indexOf(COMMAND_SEPARATOR);
          return {
            key,
            tool: permissionRuleTool(key),
            command: separator < 0 ? null : key.slice(separator + 1),
            workspaceRoot: root,
            grantedAt: this.grantedAt.get(grantId(key, root)) ?? null,
          };
        }),
    );
  }

  /**
   * Revokes a remembered grant, which takes effect at once: the next use asks again.
   * @param key The rule key.
   * @param workspaceRoot The workspace the grant applies to, or null for one that applies everywhere.
   * @returns Returns false when the revocation could not be saved, so it would come back at the next
   * launch. A grant that isn't there has nothing to save.
   */
  public revoke(key: string, workspaceRoot: string | null): boolean {
    this.ensureLoaded();
    const keys: Set<string> | undefined =
      workspaceRoot === null ? this.always : this.workspaces.get(workspaceRoot);
    if (keys?.delete(key) !== true) {
      return true;
    }
    if (workspaceRoot !== null && keys.size === 0) {
      this.workspaces.delete(workspaceRoot);
    }
    this.grantedAt.delete(grantId(key, workspaceRoot));
    logger.info(
      'PermissionRuleStore',
      `Revoked permission grant for '${permissionRuleTool(key)}' (root=${workspaceRoot ?? 'everywhere'})`,
    );
    return this.persist();
  }

  /**
   * Takes the command tools whose tool-wide grants were dropped, so the user is told once.
   * @returns Returns the tools; a later call gets none of them again.
   */
  public takeNarrowed(): readonly string[] {
    this.ensureLoaded();
    const tools: readonly string[] = [...this.narrowed];
    if (tools.length > 0) {
      this.narrowed.clear();
      this.persist();
    }
    return tools;
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
      this.grantedAt = this.storedDates(parsed.grantedAt);
      const dropped: readonly string[] = [parsed.always, ...Object.values(parsed.workspaces)]
        .flat()
        .filter((key: string): boolean => COMMAND_TOOLS.has(key));
      this.narrowed = new Set<string>([...this.storedNarrowed(parsed.narrowed), ...dropped]);
      if (dropped.length > 0) {
        // A grant saved before #979 allowed a command tool outright. It is forgotten, so the next use
        // asks again and can be remembered for its exact command instead. It goes with a note, so the
        // user is told it has gone rather than left to find out (#1164).
        logger.warn(
          'PermissionRuleStore',
          `Forgot ${dropped.length} remembered grant(s) that allowed a command tool for any command`,
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
   * Reads the stored grant dates, keeping those that are dates. A bad one only loses its date.
   * @param value The stored value.
   * @returns Returns the dates.
   */
  private storedDates(value: unknown): Map<string, string> {
    return new Map<string, string>(
      typeof value === 'object' && value !== null
        ? Object.entries(value).filter(
            (entry: [string, unknown]): entry is [string, string] =>
              typeof entry[1] === 'string' && !Number.isNaN(Date.parse(entry[1])),
          )
        : [],
    );
  }

  /**
   * Reads the stored list of narrowed tools, keeping only command tools: it names what a notice says.
   * @param value The stored value.
   * @returns Returns the tools.
   */
  private storedNarrowed(value: unknown): readonly string[] {
    return Array.isArray(value)
      ? value.filter(
          (entry: unknown): entry is string =>
            typeof entry === 'string' && COMMAND_TOOLS.has(entry),
        )
      : [];
  }

  /**
   * Persists the rules. Best-effort.
   * @returns Returns false when they could not be saved.
   */
  private persist(): boolean {
    const value: StoredRules = {
      always: [...this.always],
      workspaces: Object.fromEntries(
        [...this.workspaces.entries()].map(
          ([root, tools]: [string, Set<string>]): [string, readonly string[]] => [root, [...tools]],
        ),
      ),
      ...(this.grantedAt.size > 0 ? { grantedAt: Object.fromEntries(this.grantedAt) } : {}),
      ...(this.narrowed.size > 0 ? { narrowed: [...this.narrowed] } : {}),
    };
    try {
      mkdirSync(dirname(this.file()), { recursive: true });
      writeFileSync(this.file(), JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      logger.debug('PermissionRuleStore', `Saved permission rules to ${this.file()}`);
      return true;
    } catch (error: unknown) {
      // Persistence is best-effort; the grant still applies for this session.
      logger.error('PermissionRuleStore', 'Failed to persist permission rules', error);
      return false;
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
