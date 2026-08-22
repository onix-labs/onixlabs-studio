import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import {
  ActiveWorkspace,
  WorkspaceWell,
} from '@shared/angular/services/workspace/active-workspace';
import { OPEN_DOCUMENT, OPEN_FILE, OPEN_TERMINAL, SAVE_DOCUMENT } from '@shared/api/ai-types';
import { WorkbenchAgentCapabilities } from './workbench-agent-capabilities';

/**
 * A stand-in runtime capturing the capabilities registered against it.
 */
class FakeRuntime {
  public readonly capabilities: Map<string, (input: unknown) => unknown> = new Map<
    string,
    (input: unknown) => unknown
  >();

  /**
   * Records a capability and returns its release.
   * @param name The capability name.
   * @param handler The handler.
   * @returns Returns the release function.
   */
  public registerCapability(name: string, handler: (input: unknown) => unknown): () => void {
    this.capabilities.set(name, handler);
    return (): void => undefined;
  }
}

/**
 * A stand-in active-workspace seam publishing one well, or none.
 */
class FakeActiveWorkspace {
  public readonly requested: string[] = [];

  /**
   * Whether opening succeeds; false stands for a path outside the workspace.
   */
  public opens: boolean = true;

  /**
   * The well published, or null when no workspace is open.
   */
  public well: WorkspaceWell | null = null;

  /**
   * Publishes a well backed by this fake.
   * @param root The workspace root.
   */
  public publish(root: string | null): void {
    this.well = {
      tabId: 'workspace-tab',
      root,
      open: (path: string): Promise<boolean> => {
        this.requested.push(path);
        return Promise.resolve(this.opens);
      },
    };
  }

  /**
   * Resolves the published well.
   * @returns Returns the well, or null.
   */
  public activeWell(): WorkspaceWell | null {
    return this.well;
  }
}

/**
 * A stand-in tab registry recording what was opened.
 */
class FakeTabs {
  public readonly opened: { type: TabType; resourceKey?: string }[] = [];
  public readonly activated: string[] = [];
  private sequence: number = 0;

  /**
   * Records an activation.
   * @param id The tab id.
   */
  public activate(id: string): void {
    this.activated.push(id);
  }

  /**
   * Opens a tab and records it.
   * @param type The tab type.
   * @param resourceKey The resource key, when the tab is backed by one.
   * @returns Returns the opened tab.
   */
  public open(type: TabType, resourceKey?: string): Tab {
    this.sequence += 1;
    this.opened.push({ type, resourceKey });
    return { id: `tab-${this.sequence}`, type, title: type, resourceKey } as Tab;
  }
}

/**
 * A stand-in document registry recording the seeding calls and answering saves.
 */
class FakeDocuments {
  public readonly ensured: { id: string; name: string }[] = [];
  public readonly contents: Map<string, string> = new Map<string, string>();
  public readonly languages: Map<string, string> = new Map<string, string>();
  public readonly savedIds: string[] = [];

  /**
   * Whether the next save succeeds; false stands for a dismissed dialog.
   */
  public saveSucceeds: boolean = true;

  /**
   * The path a successful save lands on.
   */
  public savedPath: string = '/tmp/report.md';

  /**
   * Records the ensure and returns a stub document.
   * @param id The document id.
   * @param name The default name.
   * @returns Returns a stub document.
   */
  public ensure(id: string, name: string): CodeDocument {
    this.ensured.push({ id, name });
    return {} as CodeDocument;
  }

  /**
   * Records the content.
   * @param id The document id.
   * @param content The content.
   */
  public setContent(id: string, content: string): void {
    this.contents.set(id, content);
  }

  /**
   * Records the language.
   * @param id The document id.
   * @param language The language.
   */
  public setLanguage(id: string, language: string): void {
    this.languages.set(id, language);
  }

  /**
   * Resolves a document, present once ensured.
   * @param id The document id.
   * @returns Returns a stub document, or undefined when unknown.
   */
  public get(id: string): CodeDocument | undefined {
    const known: boolean = this.ensured.some((entry: { id: string }): boolean => entry.id === id);
    return known ? ({ filePath: (): string | null => this.savedPath } as CodeDocument) : undefined;
  }

  /**
   * Records the save and reports the configured outcome.
   * @param id The document id.
   * @returns Returns whether the document was saved.
   */
  public saveAs(id: string): Promise<boolean> {
    this.savedIds.push(id);
    return Promise.resolve(this.saveSucceeds);
  }
}

describe('WorkbenchAgentCapabilities', () => {
  let runtime: FakeRuntime;
  let tabs: FakeTabs;
  let documents: FakeDocuments;
  let workspace: FakeActiveWorkspace;

  /**
   * Invokes a registered capability.
   * @param name The capability name.
   * @param input The input to pass.
   * @returns Returns the capability's result.
   */
  async function invoke(name: string, input: unknown = {}): Promise<Record<string, unknown>> {
    const handler: ((input: unknown) => unknown) | undefined = runtime.capabilities.get(name);
    expect(handler).toBeDefined();
    return (await handler!(input)) as Record<string, unknown>;
  }

  beforeEach(() => {
    runtime = new FakeRuntime();
    tabs = new FakeTabs();
    documents = new FakeDocuments();
    workspace = new FakeActiveWorkspace();
    TestBed.configureTestingModule({
      providers: [
        WorkbenchAgentCapabilities,
        { provide: AiRuntime, useValue: runtime },
        { provide: Tabs, useValue: tabs },
        { provide: Documents, useValue: documents },
        { provide: ActiveWorkspace, useValue: workspace },
      ],
    });
    TestBed.inject(WorkbenchAgentCapabilities);
  });

  it('constructor_registersTheWorkbenchCapabilities', () => {
    expect([...runtime.capabilities.keys()].sort()).toEqual(
      [OPEN_DOCUMENT, SAVE_DOCUMENT, OPEN_TERMINAL, OPEN_FILE].sort(),
    );
  });

  describe(OPEN_DOCUMENT, () => {
    it('markdown_opensAMarkdownTabSeededWithTheContent', async () => {
      const result: Record<string, unknown> = await invoke(OPEN_DOCUMENT, {
        format: 'markdown',
        title: 'Release notes',
        content: '# Done\n',
      });

      expect(result['ok']).toBe(true);
      expect(tabs.opened).toEqual([{ type: 'markdown', resourceKey: undefined }]);
      expect(documents.ensured).toEqual([{ id: 'tab-1', name: 'Release notes' }]);
      expect(documents.contents.get('tab-1')).toBe('# Done\n');
      expect(documents.languages.get('tab-1')).toBe('markdown');
    });

    it('markdown_opensWithoutAResourceKey_soTwoReportsAreTwoTabs', async () => {
      // A resource key would dedup the second open onto the first tab: an agent's document is backed
      // by no file, so nothing should ever be matched against it.
      await invoke(OPEN_DOCUMENT, { format: 'markdown', title: 'One', content: 'a' });
      await invoke(OPEN_DOCUMENT, { format: 'markdown', title: 'Two', content: 'b' });

      expect(tabs.opened).toHaveLength(2);
      expect(tabs.opened.every((entry): boolean => entry.resourceKey === undefined)).toBe(true);
    });

    it('code_resolvesTheLanguageByIdOrDisplayName', async () => {
      await invoke(OPEN_DOCUMENT, {
        format: 'code',
        title: 'Probe',
        content: 'x',
        language: 'C#',
      });

      expect(tabs.opened[0].type).toBe('code');
      expect(documents.languages.get('tab-1')).toBe('csharp');
    });

    it('code_withAnUnknownLanguage_stillOpensAsPlainText', async () => {
      // An unrecognised language must not cost the user the document: the content is the point, the
      // highlighting is not.
      const result: Record<string, unknown> = await invoke(OPEN_DOCUMENT, {
        format: 'code',
        title: 'Probe',
        content: 'x',
        language: 'not-a-language',
      });

      expect(result['ok']).toBe(true);
      expect(documents.languages.get('tab-1')).toBe('plaintext');
    });

    it('anUnknownFormat_isRefusedRatherThanGuessed', async () => {
      const result: Record<string, unknown> = await invoke(OPEN_DOCUMENT, {
        format: 'spreadsheet',
        title: 'x',
        content: 'y',
      });

      expect(result['ok']).toBe(false);
      expect(String(result['error'])).toContain('spreadsheet');
      expect(tabs.opened).toEqual([]);
    });

    it('aMissingTitle_fallsBackRatherThanFailing', async () => {
      await invoke(OPEN_DOCUMENT, { format: 'markdown', content: 'x' });
      expect(documents.ensured[0].name).toBe('Untitled');
    });
  });

  describe(SAVE_DOCUMENT, () => {
    it('anOpenDocument_savesAndReportsThePath', async () => {
      await invoke(OPEN_DOCUMENT, { format: 'markdown', title: 'Report', content: 'x' });

      const result: Record<string, unknown> = await invoke(SAVE_DOCUMENT, { id: 'tab-1' });

      expect(documents.savedIds).toEqual(['tab-1']);
      expect(result['ok']).toBe(true);
      expect(result['path']).toBe('/tmp/report.md');
    });

    it('aDismissedDialog_reportsCancelledRatherThanAnError', async () => {
      // The agent must be able to tell "the user said no" from "something broke", or it will retry
      // and put the dialog up again.
      await invoke(OPEN_DOCUMENT, { format: 'markdown', title: 'Report', content: 'x' });
      documents.saveSucceeds = false;

      const result: Record<string, unknown> = await invoke(SAVE_DOCUMENT, { id: 'tab-1' });

      expect(result['ok']).toBe(false);
      expect(result['cancelled']).toBe(true);
    });

    it('anUnknownId_isRefused', async () => {
      const result: Record<string, unknown> = await invoke(SAVE_DOCUMENT, { id: 'nope' });

      expect(result['ok']).toBe(false);
      expect(documents.savedIds).toEqual([]);
    });
  });

  describe(OPEN_FILE, () => {
    it('opensAnAbsolutePathIntoTheWellAndBringsTheTabForward', async () => {
      workspace.publish('/repo');

      const result: Record<string, unknown> = await invoke(OPEN_FILE, { path: '/repo/src/a.ts' });

      expect(result['ok']).toBe(true);
      expect(workspace.requested).toEqual(['/repo/src/a.ts']);
      // Opening into a well the user cannot see is indistinguishable from doing nothing, and the well
      // may belong to a workspace that is not the active tab.
      expect(tabs.activated).toEqual(['workspace-tab']);
    });

    it('resolvesAWorkspaceRelativePathAgainstTheRoot', async () => {
      // Models name files the way the repository does; requiring an absolute path would make the tool
      // fail on the most natural input.
      workspace.publish('/repo');

      await invoke(OPEN_FILE, { path: 'src/a.ts' });

      expect(workspace.requested).toEqual(['/repo/src/a.ts']);
    });

    it('doesNotDoubleTheSeparatorWhenTheRootHasATrailingSlash', async () => {
      workspace.publish('/repo/');

      await invoke(OPEN_FILE, { path: '/src/a.ts'.slice(1) });

      expect(workspace.requested).toEqual(['/repo/src/a.ts']);
    });

    it('withNoWorkspaceOpen_saysSoRatherThanFailingSilently', async () => {
      const result: Record<string, unknown> = await invoke(OPEN_FILE, { path: 'src/a.ts' });

      expect(result['ok']).toBe(false);
      expect(String(result['error'])).toContain('No workspace is open');
      expect(tabs.activated).toEqual([]);
    });

    it('whenTheFileCannotBeOpened_reportsWhyAndLeavesTheTabAlone', async () => {
      workspace.publish('/repo');
      workspace.opens = false;

      const result: Record<string, unknown> = await invoke(OPEN_FILE, { path: 'nope.ts' });

      expect(result['ok']).toBe(false);
      expect(String(result['error'])).toContain('/repo/nope.ts');
      expect(tabs.activated).toEqual([]);
    });

    it('withNoPath_isRefused', async () => {
      workspace.publish('/repo');

      const result: Record<string, unknown> = await invoke(OPEN_FILE, {});

      expect(result['ok']).toBe(false);
      expect(workspace.requested).toEqual([]);
    });
  });

  describe(OPEN_TERMINAL, () => {
    it('opensATerminalTab', async () => {
      const result: Record<string, unknown> = await invoke(OPEN_TERMINAL, {});

      expect(result['ok']).toBe(true);
      expect(tabs.opened).toEqual([{ type: 'terminal', resourceKey: undefined }]);
    });
  });
});
