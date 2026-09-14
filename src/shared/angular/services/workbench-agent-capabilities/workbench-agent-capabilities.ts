import { inject, Service } from '@angular/core';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Documents } from '@shared/angular/services/documents/documents';
import { Log } from '@shared/angular/services/log/log';
import { resolveLanguageId } from '@shared/angular/services/monaco/monaco-languages';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  ActiveWorkspace,
  WellDocument,
  WellSourceControl,
  WellTerminal,
  WorkspaceWell,
} from '@shared/angular/services/workspace/active-workspace';
import {
  LIST_OPEN_DOCUMENTS,
  LIST_TERMINALS,
  OPEN_DIFF,
  OPEN_DOCUMENT,
  OPEN_FILE,
  OPEN_TERMINAL,
  READ_SOURCE_CONTROL_STATUS,
  SAVE_DOCUMENT,
} from '@shared/api/ai-types';

/**
 * The title a document opens under when the agent supplies none.
 */
const DEFAULT_TITLE: string = 'Untitled';

/**
 * The result of opening a document.
 */
interface OpenDocumentResult {
  /**
   * Gets whether a tab was opened.
   */
  readonly ok: boolean;

  /**
   * Gets the reason the tab was not opened, when it was not.
   */
  readonly error?: string;

  /**
   * Gets the identifier of the opened tab, which {@link SAVE_DOCUMENT} later refers to.
   */
  readonly id?: string;

  /**
   * Gets the title the tab is showing.
   */
  readonly title?: string;
}

/**
 * The result of offering to save a document.
 */
interface SaveDocumentResult {
  /**
   * Gets whether the document was written to disk.
   */
  readonly ok: boolean;

  /**
   * Gets the reason nothing was written, when nothing was.
   */
  readonly error?: string;

  /**
   * Gets whether the user dismissed the save dialog, which is an ordinary outcome rather than a
   * failure — the agent should not try again.
   */
  readonly cancelled?: boolean;

  /**
   * Gets the path the document was saved to.
   */
  readonly path?: string;
}

/**
 * The result of opening a file into a workspace's document well.
 */
interface OpenFileResult {
  /**
   * Gets whether the file was opened.
   */
  readonly ok: boolean;

  /**
   * Gets the reason the file was not opened, when it was not.
   */
  readonly error?: string;

  /**
   * Gets the absolute path that was opened.
   */
  readonly path?: string;
}

/**
 * The result of listing a well's documents.
 */
interface ListOpenDocumentsResult {
  /**
   * Gets whether a well was found to list.
   */
  readonly ok: boolean;

  /**
   * Gets the reason there was nothing to list, when there was not.
   */
  readonly error?: string;

  /**
   * Gets the workspace root the well belongs to.
   */
  readonly root?: string | null;

  /**
   * Gets the documents, in the well's order.
   */
  readonly documents?: readonly WellDocument[];
}

/**
 * The result of opening a diff into a well.
 */
interface OpenDiffResult {
  /**
   * Gets whether the diff was opened.
   */
  readonly ok: boolean;

  /**
   * Gets the reason it was not, when it was not.
   */
  readonly error?: string;

  /**
   * Gets the absolute path whose diff was opened.
   */
  readonly path?: string;
}

/**
 * The result of reading a workspace's source-control state.
 */
interface SourceControlStatusResult {
  /**
   * Gets whether a well was found to ask.
   */
  readonly ok: boolean;

  /**
   * Gets the reason there was nothing to read, when there was not.
   */
  readonly error?: string;

  /**
   * Gets the state, or null when the workspace is not a repository.
   */
  readonly status?: WellSourceControl | null;
}

/**
 * The result of opening a terminal.
 */
interface OpenTerminalResult {
  /**
   * Gets whether a terminal was opened.
   */
  readonly ok: boolean;

  /**
   * Gets the identifier of the opened terminal — a top-level tab's id, or a workspace terminal's
   * session id — which the terminal tools address it by.
   */
  readonly id?: string;

  /**
   * Gets where the terminal opened: in the workspace's dock, or as a top-level tab.
   */
  readonly where?: 'workspace' | 'tab';
}

/**
 * The result of listing a workspace's terminals.
 */
interface ListTerminalsResult {
  /**
   * Gets whether a workspace was found to list.
   */
  readonly ok: boolean;

  /**
   * Gets the reason there was nothing to list, when there was not.
   */
  readonly error?: string;

  /**
   * Gets the terminals.
   */
  readonly terminals?: readonly WellTerminal[];
}

/**
 * Registers the workbench agent capabilities with the {@link AiRuntime} registry: opening a new
 * document tab and filling it, offering to save it, and opening a terminal tab.
 *
 * Unlike the other capability registrations, which belong to a view and live only while such a tab is
 * open, these are **application-global and permanent**. Opening a top-level tab is not something the
 * agent's own surface does — it is something the workbench does — so an agent docked to a terminal, a
 * binary or an API collection reaches the same registry as one docked to an editor. They are
 * registered from the application root and never released; there is no owning view to release them
 * with, and the registry they write into is the root one that outlives every tab.
 *
 * That root scoping is the point of registering here rather than inside a feature: {@link Documents}
 * is re-provided per workspace for the document well, and a workspace-scoped instance would put the
 * agent's report inside whichever workspace happened to be open rather than in a tab of its own. The
 * injector at the root resolves the root registries, which is what backs standalone tabs.
 *
 * Content lands **unsaved**. The user reviews it in the editor and decides whether to keep it; the
 * agent never writes to disk on its own, and {@link SAVE_DOCUMENT} only reaches the file system
 * through the operating system's own save dialog.
 */
@Service()
export class WorkbenchAgentCapabilities {
  /**
   * Holds the agent runtime the capabilities are registered with.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the global tab registry the capabilities open into.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the root document registry backing standalone code and markdown tabs.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the seam that resolves which workspace's document well a file opens into.
   */
  private readonly workspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers the capabilities. Deliberately never released — see the class remarks.
   */
  public constructor() {
    this.runtime.registerCapability(OPEN_DOCUMENT, (input: unknown): OpenDocumentResult =>
      this.openDocument(input),
    );
    this.runtime.registerCapability(SAVE_DOCUMENT, (input: unknown): Promise<SaveDocumentResult> =>
      this.saveDocument(input),
    );
    this.runtime.registerCapability(OPEN_TERMINAL, (input: unknown): OpenTerminalResult =>
      this.openTerminal(input),
    );
    this.runtime.registerCapability(OPEN_FILE, (input: unknown): Promise<OpenFileResult> =>
      this.openFile(input),
    );
    // The workspace surface's own view of its well (#713). Registered here with the other well-based
    // capabilities: they resolve the well the same way, and the surface that offers them is decided in
    // the main process.
    this.runtime.registerCapability(LIST_OPEN_DOCUMENTS, (): ListOpenDocumentsResult =>
      this.listOpenDocuments(),
    );
    this.runtime.registerCapability(OPEN_DIFF, (input: unknown): Promise<OpenDiffResult> =>
      this.openDiff(input),
    );
    this.runtime.registerCapability(READ_SOURCE_CONTROL_STATUS, (): SourceControlStatusResult =>
      this.readSourceControlStatus(),
    );
    this.runtime.registerCapability(LIST_TERMINALS, (): ListTerminalsResult =>
      this.listTerminals(),
    );
    this.log.info('workbench.agent', 'Workbench agent capabilities registered');
  }

  /**
   * Opens a new unsaved document tab and fills it with the agent's content.
   *
   * The document is seeded here rather than left to the view: a code or markdown view calls
   * `Documents.ensure` when it mounts, which happens a render later, and it returns the existing entry
   * when one is already there. Creating the entry first therefore wins the race without depending on
   * it — the view finds the document already populated instead of replacing it with an empty one.
   * @param input The tool input: format, title, content and optional language.
   * @returns Returns the {@link OpenDocumentResult}.
   */
  private openDocument(input: unknown): OpenDocumentResult {
    const args: {
      format?: unknown;
      title?: unknown;
      content?: unknown;
      language?: unknown;
    } = input ?? {};
    const format: string = typeof args.format === 'string' ? args.format : 'markdown';
    if (format !== 'markdown' && format !== 'code') {
      return { ok: false, error: `Unknown document format "${format}"; use markdown or code.` };
    }
    const content: string = typeof args.content === 'string' ? args.content : '';
    const title: string =
      typeof args.title === 'string' && args.title.trim().length > 0
        ? args.title.trim()
        : DEFAULT_TITLE;

    const type: TabType = format === 'markdown' ? 'markdown' : 'code';
    // No resource key: an agent's document is not backed by a file, so nothing should ever dedup
    // against it — two reports asked for in one conversation are two tabs.
    const tab: Tab = this.tabs.open(type);
    this.documents.ensure(tab.id, title);
    this.documents.setContent(tab.id, content);
    this.documents.setLanguage(tab.id, this.languageFor(format, args.language));
    this.log.info('workbench.agent', `Agent opened a ${format} document`, tab.id, title);
    return { ok: true, id: tab.id, title };
  }

  /**
   * Resolves the editor language a new document opens under. Markdown is fixed — the markdown view
   * renders it — while a code document takes whatever the agent named, falling back to plain text so
   * an unrecognised language still opens rather than failing.
   * @param format The document format.
   * @param language The language the agent named, if any.
   * @returns Returns the editor language id.
   */
  private languageFor(format: string, language: unknown): string {
    if (format === 'markdown') {
      return 'markdown';
    }
    if (typeof language !== 'string' || language.trim().length === 0) {
      return 'plaintext';
    }
    return resolveLanguageId(language) ?? 'plaintext';
  }

  /**
   * Offers to save a document the agent opened, through the operating system's save dialog.
   * @param input The tool input: the id of the document to save.
   * @returns Returns the {@link SaveDocumentResult}.
   */
  private async saveDocument(input: unknown): Promise<SaveDocumentResult> {
    const args: { id?: unknown } = input ?? {};
    const id: string = typeof args.id === 'string' ? args.id : '';
    if (this.documents.get(id) === undefined) {
      return { ok: false, error: `No open document with id "${id}".` };
    }
    const saved: boolean = await this.documents.saveAs(id);
    if (!saved) {
      // saveAs reports false both for a dismissed dialog and for a failed write. The dismissal is by
      // far the common case and is not an error the agent should retry, so it is reported as its own
      // outcome rather than as a failure.
      this.log.info('workbench.agent', 'Agent save was declined or failed', id);
      return { ok: false, cancelled: true };
    }
    const path: string | null = this.documents.get(id)?.filePath() ?? null;
    this.log.info('workbench.agent', 'Agent document saved', id, path ?? '');
    return { ok: true, path: path ?? undefined };
  }

  /**
   * Opens an existing workspace file into that workspace's document well and brings its tab forward.
   *
   * Activating the tab is part of the action rather than a courtesy: the well may belong to a
   * workspace the user is not looking at (an agent docked to a terminal reaches the last active one),
   * and opening a file into a tab nobody can see is indistinguishable from doing nothing.
   * @param input The tool input: the path to open.
   * @returns Returns the {@link OpenFileResult}.
   */
  private async openFile(input: unknown): Promise<OpenFileResult> {
    const args: { path?: unknown } = input ?? {};
    const requested: string = typeof args.path === 'string' ? args.path.trim() : '';
    if (requested.length === 0) {
      return { ok: false, error: 'No path was given.' };
    }
    const well: WorkspaceWell | null = this.workspace.activeWell();
    if (well === null) {
      return {
        ok: false,
        error: 'No workspace is open, so there is no document well to open the file into.',
      };
    }
    const path: string = this.absolutePath(requested, well.root);
    const opened: boolean = await well.open(path);
    if (!opened) {
      return {
        ok: false,
        error:
          `"${path}" could not be opened. It may not exist, may lie outside the open workspace, ` +
          'or may be a directory.',
      };
    }
    this.tabs.activate(well.tabId);
    this.log.info('workbench.agent', 'Agent opened a file in the well', path);
    return { ok: true, path };
  }

  /**
   * Lists the documents open in the active workspace's well (#713).
   * @returns Returns the {@link ListOpenDocumentsResult}.
   */
  private listOpenDocuments(): ListOpenDocumentsResult {
    const well: WorkspaceWell | null = this.workspace.activeWell();
    if (well === null) {
      return { ok: false, error: 'No workspace is open, so there is no document well to list.' };
    }
    const documents: readonly WellDocument[] = well.documents();
    this.log.debug('workbench.agent', `Agent listed ${documents.length} well document(s)`);
    return { ok: true, root: well.root, documents };
  }

  /**
   * Opens a changed file's diff into the active workspace's well and brings the tab forward (#713).
   * @param input The tool input: the path whose diff to open.
   * @returns Returns the {@link OpenDiffResult}.
   */
  private async openDiff(input: unknown): Promise<OpenDiffResult> {
    const args: { path?: unknown } = input ?? {};
    const requested: string = typeof args.path === 'string' ? args.path.trim() : '';
    if (requested.length === 0) {
      return { ok: false, error: 'No path was given.' };
    }
    const well: WorkspaceWell | null = this.workspace.activeWell();
    if (well === null) {
      return {
        ok: false,
        error: 'No workspace is open, so there is no document well to open the diff into.',
      };
    }
    const path: string = this.absolutePath(requested, well.root);
    const refusal: string | null = await well.openDiff(path);
    if (refusal !== null) {
      this.log.debug('workbench.agent', `Agent diff refused: ${refusal}`);
      return { ok: false, error: refusal };
    }
    this.tabs.activate(well.tabId);
    this.log.info('workbench.agent', 'Agent opened a diff in the well', path);
    return { ok: true, path };
  }

  /**
   * Reads the active workspace's source-control state (#713).
   * @returns Returns the {@link SourceControlStatusResult}.
   */
  private readSourceControlStatus(): SourceControlStatusResult {
    const well: WorkspaceWell | null = this.workspace.activeWell();
    if (well === null) {
      return { ok: false, error: 'No workspace is open, so there is no repository to read.' };
    }
    return { ok: true, status: well.sourceControl() };
  }

  /**
   * Resolves a requested path against the workspace root, so a model that names a file the way the
   * repository does (`src/app/main.ts`) reaches the same file as one that gives a full path.
   * @param requested The requested path, absolute or workspace-relative.
   * @param root The workspace root, or null when the tab has no folder open.
   * @returns Returns the absolute path.
   */
  private absolutePath(requested: string, root: string | null): string {
    const absolute: boolean = requested.startsWith('/') || /^[A-Za-z]:[\\/]/.test(requested);
    if (absolute || root === null) {
      return requested;
    }
    const separator: string = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    return `${root.replace(/[\\/]+$/, '')}${separator}${requested.replace(/^[\\/]+/, '')}`;
  }

  /**
   * Opens a terminal: into the active workspace's dock when the caller asks for one and a workspace
   * is open (#713) — so the conversation and the terminal it drives share a tab — and otherwise as a
   * top-level terminal tab.
   * @param input The tool input: whether the terminal belongs in the workspace.
   * @returns Returns the {@link OpenTerminalResult}.
   */
  private openTerminal(input: unknown): OpenTerminalResult {
    const args: { workspace?: unknown } = input ?? {};
    const well: WorkspaceWell | null = args.workspace === true ? this.workspace.activeWell() : null;
    if (well !== null) {
      const terminal: WellTerminal = well.openTerminal();
      this.tabs.activate(well.tabId);
      this.log.info('workbench.agent', 'Agent opened a workspace terminal', terminal.id);
      return { ok: true, id: terminal.id, where: 'workspace' };
    }
    const tab: Tab = this.tabs.open('terminal');
    this.log.info('workbench.agent', 'Agent opened a terminal', tab.id);
    return { ok: true, id: tab.id, where: 'tab' };
  }

  /**
   * Lists the active workspace's terminals (#713).
   * @returns Returns the {@link ListTerminalsResult}.
   */
  private listTerminals(): ListTerminalsResult {
    const well: WorkspaceWell | null = this.workspace.activeWell();
    if (well === null) {
      return { ok: false, error: 'No workspace is open, so there are no workspace terminals.' };
    }
    return { ok: true, terminals: well.terminals() };
  }
}
