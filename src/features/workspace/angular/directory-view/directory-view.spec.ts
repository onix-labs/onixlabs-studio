import { Component, input, InputSignal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Mock, MockInstance } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';
import { SourceControlCommands } from '@shared/angular/services/source-control-commands/source-control-commands';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import {
  collectPanelIds,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { WorkspaceDocumentCommands } from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
import { WORKSPACE_KEYBINDINGS } from '@features/workspace/angular/workspace-keybindings';
import { DirectoryListing, FileOperationResult } from '@shared/api/workspace-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import {
  ActiveWorkspace,
  WellDocument,
  WellTerminal,
  WorkspaceWell,
} from '@shared/angular/services/workspace/active-workspace';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { IssueOpener } from '@shared/angular/services/issues/issue-opener';
import { IssueStore } from '@shared/angular/services/issues/issue-store';

import { ReferencesPanelState } from '@features/workspace/angular/panels/references-panel/references-panel-state';
import { WorkspaceReferences } from '@features/workspace/angular/workspace-references/workspace-references';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import type { ReferenceList } from '@shared/angular/services/references/reference-list';

import { RepositoryInfo } from '@shared/api/source-control-channels';
import type { FileWriteResult } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  DockPanelCommands,
  DockPanelState,
} from '@shared/angular/services/dock-panel-commands/dock-panel-commands';
import { HierarchyRouter, HierarchySource } from '@shared/angular/services/hierarchy/hierarchy';
import { Repository } from '@shared/angular/services/repository/repository';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { SearchPanelRequests } from '@features/workspace/angular/panels/search-panel/search-panel-requests';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';

import { DirectoryView } from './directory-view';

/**
 * What a successful push reports.
 */
const PUSHED: MutationResult = { success: true };

const ROOT_LISTING: DirectoryListing = {
  path: '/ws',
  name: 'ws',
  entries: [{ name: 'README.md', path: '/ws/README.md', type: 'file' }],
};

/**
 * Stands in for the component of a panel that saves its own document (an image in the well).
 */
@Component({ selector: 'app-stub-self-saving-panel', template: '' })
class StubSelfSavingPanel {
  public readonly panel: InputSignal<DockPanel | undefined> = input<DockPanel>();
}

describe('DirectoryView', () => {
  let component: DirectoryView;
  let fixture: ComponentFixture<DirectoryView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DirectoryView],
      providers: [provideKeybindingCatalogue(WORKSPACE_KEYBINDINGS)],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectoryView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tabId', 'tab-1');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('init_whenAFolderIsStashedForTheTab_seedsTheScopedWorkspace', () => {
    const workspaces: Workspaces = TestBed.inject(Workspaces);
    workspaces.setInitial('tab-2', ROOT_LISTING);

    const seeded: ComponentFixture<DirectoryView> = TestBed.createComponent(DirectoryView);
    seeded.componentRef.setInput('tabId', 'tab-2');
    seeded.detectChanges();

    // The scoped workspace is the instance provided by this directory view.
    const scopedWorkspace: Workspace = seeded.debugElement.injector.get(Workspace);
    expect(scopedWorkspace.rootName()).toBe('ws');
  });

  describe('the References panel (#1014)', () => {
    it('aListWhileActive_tabsThePanelBesideTheErrorList_bringsItForward_andShowsTheList', async () => {
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      const dock: DockState = fixture.debugElement.injector.get(DockState);
      const list: ReferenceList = { kind: 'references', symbol: 'Foo', status: 'done', items: [] };

      TestBed.inject(WorkspaceReferences).reveal(list);

      const stack: StackNode | null = findStackOfPanel(dock.layout(), 'references');
      expect(stack).not.toBeNull();
      expect(stack?.panels).toContain('errors');
      expect(stack?.active).toBe('references');
      expect(fixture.debugElement.injector.get(ReferencesPanelState).list()).toBe(list);
    });

    it('aChosenPlaceInAnotherFile_opensThroughThisTabsOwnOpener_notTheApplicationWideOne', async () => {
      // The application-wide opener's dock is rendered by no view: a file it opened never showed an
      // editor, so a chosen reference went nowhere.
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      const own: FileOpener = fixture.debugElement.injector.get(FileOpener);
      const appWide: FileOpener = TestBed.inject(FileOpener);
      expect(own).not.toBe(appWide);
      const ownOpen: Mock = vi.spyOn(own, 'openPath').mockResolvedValue(true);
      const appWideOpen: Mock = vi.spyOn(appWide, 'openPath').mockResolvedValue(true);

      await expect(TestBed.inject(WorkspaceReferences).open('/ws/README.md')).resolves.toBe(true);

      expect(ownOpen).toHaveBeenCalledWith('/ws/README.md');
      expect(appWideOpen).not.toHaveBeenCalled();
    });

    it('onceInactive_opensNothing', async () => {
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      fixture.componentRef.setInput('isActive', false);
      await fixture.whenStable();
      const ownOpen: Mock = vi
        .spyOn(fixture.debugElement.injector.get(FileOpener), 'openPath')
        .mockResolvedValue(true);

      await expect(TestBed.inject(WorkspaceReferences).open('/ws/README.md')).resolves.toBe(false);

      expect(ownOpen).not.toHaveBeenCalled();
    });

    it('whileInactive_registersNothing_soNoListReachesIt', async () => {
      await fixture.whenStable();

      expect(TestBed.inject(WorkspaceReferences).available()).toBe(false);
    });
  });

  describe('the published well (#713)', () => {
    /**
     * Gets the well this view published, which the agent's workbench tools reach it through.
     * @returns Returns the well.
     */
    function well(): WorkspaceWell {
      const published: WorkspaceWell | null = TestBed.inject(ActiveWorkspace).activeWell();
      if (published === null) {
        throw new Error('The view published no well');
      }
      return published;
    }

    it('init_publishesAWellThatListsDocumentsAndReadsSourceControl', () => {
      fixture.detectChanges();

      expect(well().tabId).toBe('tab-1');
      expect(well().documents()).toEqual([]);
      // Not a repository until the folder proves to be one.
      expect(well().sourceControl()).toBeNull();
    });

    it('documents_reportsEachWellDocumentWithItsStateAndWhichIsActive', () => {
      fixture.detectChanges();
      const documents: Documents = fixture.debugElement.injector.get(Documents);
      const first: string = documents.createWellDocument({
        path: '/ws/a.ts',
        name: 'a.ts',
        extension: 'ts',
        content: 'original',
      });
      documents.setContent(first, 'changed');
      documents.setActiveDocument(first);

      const listed: readonly WellDocument[] = well().documents();

      expect(listed).toEqual([
        { path: '/ws/a.ts', name: 'a.ts', language: 'typescript', dirty: true, active: true },
      ]);
    });

    it('openTerminal_createsASessionInTheDockAndListsIt', () => {
      fixture.detectChanges();

      const opened: WellTerminal = well().openTerminal();

      expect(opened.id).toMatch(/^term-/);
      expect(well().terminals()).toEqual([{ id: opened.id, name: opened.name, active: true }]);
    });

    it('reveal_whenThePathIsOutsideTheWorkspace_refuses', async () => {
      fixture.detectChanges();

      expect(await well().reveal('/somewhere/else')).toBe(false);
    });

    it('openDiff_whenTheFolderIsNotARepository_refusesWithTheReason', async () => {
      fixture.detectChanges();

      expect(await well().openDiff('/ws/a.ts')).toContain('not a git repository');
    });
  });

  describe('the panels menu', () => {
    let commands: DockPanelCommands;

    /**
     * Reads a panel's row in the menu.
     * @param id The panel.
     * @returns Returns its row.
     */
    function row(id: string): DockPanelState | undefined {
      return commands.panels().find((panel: DockPanelState): boolean => panel.id === id);
    }

    beforeEach(async () => {
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      commands = TestBed.inject(DockPanelCommands);
    });

    it('panels_listsToolPanelsOnly', () => {
      expect(row('files')?.docked).toBe(true);
      expect(commands.panels().some((panel: DockPanelState) => panel.id.startsWith('doc'))).toBe(
        false,
      );
    });

    it('toggle_aHiddenPanel_docksAndRevealsIt', async () => {
      const dock: DockState = fixture.debugElement.injector.get(DockState);
      expect(findStackOfPanel(dock.layout(), 'references')).toBeNull();

      commands.toggle('references');
      await fixture.whenStable();

      expect(findStackOfPanel(dock.layout(), 'references')?.active).toBe('references');
      expect(row('references')?.docked).toBe(true);
    });

    it('toggle_aShowingPanel_closesIt', async () => {
      const dock: DockState = fixture.debugElement.injector.get(DockState);
      commands.toggle('references');
      await fixture.whenStable();

      commands.toggle('references');
      await fixture.whenStable();

      expect(findStackOfPanel(dock.layout(), 'references')).toBeNull();
    });

    it('destroy_takesTheMenuAway', () => {
      fixture.destroy();

      expect(commands.panels()).toEqual([]);
    });
  });

  describe('find and hierarchy', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
    });

    it('find_withNoSearchPanel_docksItAndBringsItForward', async () => {
      const dock: DockState = fixture.debugElement.injector.get(DockState);

      TestBed.inject(WorkspaceFind).reveal();
      await fixture.whenStable();

      expect(findStackOfPanel(dock.layout(), 'search')?.active).toBe('search');
    });

    it('find_aPanelAlreadyMoved_staysWhereItWasPut', async () => {
      const dock: DockState = fixture.debugElement.injector.get(DockState);
      TestBed.inject(WorkspaceFind).reveal();
      await fixture.whenStable();
      const stack: string | undefined = findStackOfPanel(dock.layout(), 'search')?.id;

      TestBed.inject(WorkspaceFind).reveal();
      await fixture.whenStable();

      expect(findStackOfPanel(dock.layout(), 'search')?.id).toBe(stack);
      expect(
        collectPanelIds(dock.layout()).filter((panel: string): boolean => panel === 'search'),
      ).toHaveLength(1);
    });

    it('find_withARequest_postsItToThePanel', async () => {
      const requests: SearchPanelRequests = fixture.debugElement.injector.get(SearchPanelRequests);
      const post: Mock = vi.spyOn(requests, 'post');

      TestBed.inject(WorkspaceFind).reveal({
        term: 'needle',
        filePath: '/ws/a.ts',
      } as unknown as FindRequest);
      await fixture.whenStable();

      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]?.[1]).toBe(false);
    });

    it('hierarchy_docksThePanelBesideTheErrorList', async () => {
      const dock: DockState = fixture.debugElement.injector.get(DockState);
      const source: HierarchySource = {
        kind: 'calls',
        roots: [],
      } as unknown as HierarchySource;

      expect(TestBed.inject(HierarchyRouter).show(source)).toBe(true);
      await fixture.whenStable();

      const stack: StackNode | null = findStackOfPanel(dock.layout(), 'hierarchy');
      expect(stack?.panels).toContain('errors');
      expect(stack?.active).toBe('hierarchy');
    });
  });

  describe('an agent working through the well', () => {
    let workspace: Workspace;
    let revealed: Mock;

    /**
     * Gets the well the active view published.
     * @returns Returns the well.
     */
    function well(): WorkspaceWell {
      const published: WorkspaceWell | null = TestBed.inject(ActiveWorkspace).activeWell();
      if (published === null) {
        throw new Error('The view published no well');
      }
      return published;
    }

    beforeEach(() => {
      TestBed.inject(Workspaces).setInitial('tab-2', ROOT_LISTING);
      const seeded: ComponentFixture<DirectoryView> = TestBed.createComponent(DirectoryView);
      seeded.componentRef.setInput('tabId', 'tab-2');
      seeded.detectChanges();
      workspace = seeded.debugElement.injector.get(Workspace);
      revealed = vi.spyOn(workspace, 'revealPath').mockResolvedValue(undefined);
      fixture = seeded;
    });

    it('createFile_empty_createsRevealsAndOpensBehindTheUser', async () => {
      const made: Mock = vi
        .spyOn(workspace, 'createFile')
        .mockResolvedValue({ success: true, path: '/ws/a.ts' });
      const opener: FileOpener = fixture.debugElement.injector.get(FileOpener);
      const open: Mock = vi.spyOn(opener, 'openPath').mockResolvedValue(true);
      const write: Mock = vi.spyOn(fixture.debugElement.injector.get(FileSystem), 'write');

      expect(await well().createFile('/ws/a.ts', null)).toBeNull();

      expect(made).toHaveBeenCalledWith('/ws', 'a.ts');
      expect(write).not.toHaveBeenCalled();
      expect(revealed).toHaveBeenCalledWith('/ws/a.ts');
      expect(open.mock.calls[0]?.[0]).toBe('/ws/a.ts');
    });

    it('createFile_withContent_writesItWhereTheFileActuallyWent', async () => {
      vi.spyOn(workspace, 'createFile').mockResolvedValue({ success: true, path: '/ws/a (1).ts' });
      vi.spyOn(fixture.debugElement.injector.get(FileOpener), 'openPath').mockResolvedValue(true);
      const write: Mock = vi
        .spyOn(fixture.debugElement.injector.get(FileSystem), 'write')
        .mockResolvedValue({ success: true });

      await well().createFile('/ws/a.ts', 'body');

      expect(write).toHaveBeenCalledWith('/ws/a (1).ts', 'body');
    });

    it.each([
      [{ success: false, error: 'exists' }, 'exists'],
      [{ success: false }, 'The file could not be created.'],
    ])('createFile_refused_%j_saysWhy', async (result: FileOperationResult, reason: string) => {
      vi.spyOn(workspace, 'createFile').mockResolvedValue(result);

      expect(await well().createFile('/ws/a.ts', 'body')).toBe(reason);
    });

    it.each([
      [{ success: false, error: 'disk full' }, 'disk full'],
      [{ success: false }, 'The file was created but its content could not be written.'],
    ])('createFile_writeRefused_%j_saysWhy', async (result: FileWriteResult, reason: string) => {
      vi.spyOn(workspace, 'createFile').mockResolvedValue({ success: true });
      vi.spyOn(fixture.debugElement.injector.get(FileSystem), 'write').mockResolvedValue(result);

      expect(await well().createFile('/ws/a.ts', 'body')).toBe(reason);
    });

    it('createFile_windowsPath_splitsOnTheBackslash', async () => {
      const made: Mock = vi.spyOn(workspace, 'createFile').mockResolvedValue({ success: false });

      await well().createFile('C:\\ws\\a.ts', null);

      expect(made).toHaveBeenCalledWith('C:\\ws', 'a.ts');
    });

    it('createFile_bareName_isItsOwnParentAndName', async () => {
      const made: Mock = vi.spyOn(workspace, 'createFile').mockResolvedValue({ success: false });

      await well().createFile('a.ts', null);

      expect(made).toHaveBeenCalledWith('a.ts', 'a.ts');
    });

    it('createFolder_createsAndReveals', async () => {
      const made: Mock = vi
        .spyOn(workspace, 'createFolder')
        .mockResolvedValue({ success: true, path: '/ws/src' });

      expect(await well().createFolder('/ws/src')).toBeNull();

      expect(made).toHaveBeenCalledWith('/ws', 'src');
      expect(revealed).toHaveBeenCalledWith('/ws/src');
    });

    it.each([
      [{ success: false, error: 'exists' }, 'exists'],
      [{ success: false }, 'The folder could not be created.'],
    ])('createFolder_refused_%j_saysWhy', async (result: FileOperationResult, reason: string) => {
      vi.spyOn(workspace, 'createFolder').mockResolvedValue(result);

      expect(await well().createFolder('/ws/src')).toBe(reason);
    });

    it('rename_revealsTheNewPath', async () => {
      vi.spyOn(workspace, 'rename').mockResolvedValue({ success: true, path: '/ws/b.ts' });

      expect(await well().rename('/ws/a.ts', 'b.ts')).toEqual({ path: '/ws/b.ts', error: null });

      expect(revealed).toHaveBeenCalledWith('/ws/b.ts');
    });

    it('rename_withoutAPathBack_revealsNothing', async () => {
      vi.spyOn(workspace, 'rename').mockResolvedValue({ success: true });

      expect(await well().rename('/ws/a.ts', 'b.ts')).toEqual({ path: null, error: null });

      expect(revealed).not.toHaveBeenCalled();
    });

    it.each([
      [{ success: false, error: 'locked' }, 'locked'],
      [{ success: false }, 'The entry could not be renamed.'],
    ])('rename_refused_%j_saysWhy', async (result: FileOperationResult, reason: string) => {
      vi.spyOn(workspace, 'rename').mockResolvedValue(result);

      expect(await well().rename('/ws/a.ts', 'b.ts')).toEqual({ path: null, error: reason });
    });

    it.each([
      [
        { success: true, trashed: true },
        { trashed: true, error: null },
      ],
      [{ success: true }, { trashed: false, error: null }],
      [
        { success: false, error: 'locked' },
        { trashed: false, error: 'locked' },
      ],
      [{ success: false }, { trashed: false, error: 'The entry could not be deleted.' }],
    ])('delete_%j_reports', async (result: FileOperationResult, reported: unknown) => {
      vi.spyOn(workspace, 'delete').mockResolvedValue(result);

      expect(await well().delete('/ws/a.ts')).toEqual(reported);
    });

    it('reveal_insideTheWorkspace_revealsIt', async () => {
      expect(await well().reveal('/ws/src/a.ts')).toBe(true);

      expect(revealed).toHaveBeenCalledWith('/ws/src/a.ts');
    });

    it.each(['/ws-secret/a.ts', '/wsfile', '/ws/../etc/passwd', '/ws/src/../../etc/passwd'])(
      'reveal_%s_isOutsideTheWorkspace',
      async (path: string) => {
        expect(await well().reveal(path)).toBe(false);

        expect(revealed).not.toHaveBeenCalled();
      },
    );

    it('createFile_atTheFilesystemRoot_keepsTheRootAsItsParent', async () => {
      const made: Mock = vi.spyOn(workspace, 'createFile').mockResolvedValue({ success: false });

      await well().createFile('/a.ts', null);

      expect(made).toHaveBeenCalledWith('/', 'a.ts');
    });

    it('reveal_theRootItself_isRefused', async () => {
      expect(await well().reveal('/ws')).toBe(false);
    });

    it('rootPath_isTheOpenFolder', () => {
      expect(well().rootPath()).toBe('/ws');
    });

    it('sourceControl_boundRepository_reportsItsState', () => {
      const repository: Repository = fixture.debugElement.injector.get(Repository);
      repository.bind({ root: '/ws', trust: 'trusted' } as RepositoryInfo);

      expect(well().sourceControl()).toMatchObject({
        root: '/ws',
        branch: null,
        ahead: 0,
        behind: 0,
        staged: [],
      });
    });

    it('destroy_takesTheWellDown', () => {
      fixture.destroy();

      expect(TestBed.inject(ActiveWorkspace).activeWell()?.tabId).not.toBe('tab-2');
    });
  });

  describe('binding the repository for an action', () => {
    const info: RepositoryInfo = { root: '/ws', trust: 'trusted' } as RepositoryInfo;
    let closed: string[];
    let resolving: () => Promise<RepositoryInfo | null>;
    let view: ComponentFixture<DirectoryView>;
    let repository: Repository;

    /**
     * Lets the replies in flight land.
     */
    async function settle(): Promise<void> {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }

    beforeEach(async () => {
      closed = [];
      resolving = (): Promise<RepositoryInfo | null> => Promise.resolve(null);
      const known: Record<string, unknown> = {
        resolveRepository: (): Promise<RepositoryInfo | null> => resolving(),
        closeRepository: (root: string): Promise<void> => {
          closed.push(root);
          return Promise.resolve();
        },
      };
      // The binding reads far more than these tests are about; everything else is refused.
      Object.defineProperty(TestBed.inject(SourceControl), 'client', {
        value: new Proxy(known, {
          get: (target: Record<string, unknown>, name: string): unknown =>
            target[name] ?? ((): Promise<unknown> => Promise.resolve({ ok: false, error: 'none' })),
        }),
      });
      TestBed.inject(Workspaces).setInitial('tab-2', ROOT_LISTING);
      view = TestBed.createComponent(DirectoryView);
      view.componentRef.setInput('tabId', 'tab-2');
      view.componentRef.setInput('isActive', true);
      await view.whenStable();
      await settle();
      repository = view.debugElement.injector.get(Repository);
      closed.length = 0;
    });

    it('push_notARepository_doesNothing', async () => {
      const push: Mock = vi.spyOn(repository, 'push');

      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      expect(push).not.toHaveBeenCalled();
    });

    it('push_trustedRepository_bindsAndPushes', async () => {
      const push: Mock = vi.spyOn(repository, 'push').mockResolvedValue(PUSHED);
      resolving = (): Promise<RepositoryInfo> => Promise.resolve(info);

      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      expect(repository.isBound()).toBe(true);
      expect(push).toHaveBeenCalledTimes(1);
    });

    it('push_refusedTrust_releasesItsHoldAndPushesNothing', async () => {
      const push: Mock = vi.spyOn(repository, 'push');
      vi.spyOn(TestBed.inject(RepositoryTrust), 'ensureTrusted').mockResolvedValue(false);
      resolving = (): Promise<RepositoryInfo> => Promise.resolve(info);

      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      expect(closed).toEqual(['/ws']);
      expect(push).not.toHaveBeenCalled();
    });

    it('push_twiceAtOnce_balancesTheSecondHold', async () => {
      vi.spyOn(repository, 'push').mockResolvedValue(PUSHED);
      resolving = (): Promise<RepositoryInfo> => Promise.resolve(info);

      TestBed.inject(WorkspaceSourceControlCommands).push();
      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      expect(closed).toEqual(['/ws']);
    });

    it('push_resolveRejected_staysQuiet', async () => {
      const push: Mock = vi.spyOn(repository, 'push');
      resolving = (): Promise<never> => Promise.reject(new Error('git crashed'));

      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      expect(push).not.toHaveBeenCalled();
    });

    it('destroy_whileResolving_releasesTheHoldAndBindsNothing', async () => {
      const bind: Mock = vi.spyOn(repository, 'bind');
      let answer: (value: RepositoryInfo) => void = (): void => undefined;
      resolving = (): Promise<RepositoryInfo> =>
        new Promise<RepositoryInfo>((resolve: (value: RepositoryInfo) => void): void => {
          answer = resolve;
        });
      TestBed.inject(WorkspaceSourceControlCommands).push();

      view.destroy();
      answer(info);
      await settle();

      expect(bind).not.toHaveBeenCalled();
      expect(closed).toEqual(['/ws']);
    });

    it('destroy_whileTheTrustQuestionIsOpen_releasesTheHoldAndBindsNothing', async () => {
      const bind: Mock = vi.spyOn(repository, 'bind');
      let answer: (trusted: boolean) => void = (): void => undefined;
      vi.spyOn(TestBed.inject(RepositoryTrust), 'ensureTrusted').mockReturnValue(
        new Promise<boolean>((resolve: (trusted: boolean) => void): void => {
          answer = resolve;
        }),
      );
      resolving = (): Promise<RepositoryInfo> => Promise.resolve(info);
      TestBed.inject(WorkspaceSourceControlCommands).push();
      await settle();

      view.destroy();
      answer(true);
      await settle();

      expect(bind).not.toHaveBeenCalled();
      expect(closed).toEqual(['/ws']);
    });
  });

  describe('saving panels that hold their own document (#760)', () => {
    let registry: DockPanelRegistry;
    let dockState: DockState;
    let documents: Documents;
    let commands: WorkspaceDocumentCommands;
    let dirty: WritableSignal<boolean>;
    let save: Mock<() => Promise<boolean>>;

    /**
     * Activates the view and puts a self-saving panel (standing in for an edited image) in its well.
     */
    beforeEach((): void => {
      fixture.componentRef.setInput('isActive', true);
      fixture.detectChanges();
      registry = fixture.debugElement.injector.get(DockPanelRegistry);
      dockState = fixture.debugElement.injector.get(DockState);
      documents = fixture.debugElement.injector.get(Documents);
      commands = TestBed.inject(WorkspaceDocumentCommands);
      dirty = signal<boolean>(true);
      save = vi.fn((): Promise<boolean> => {
        dirty.set(false);
        return Promise.resolve(true);
      });
      registry.register({
        id: 'image-well:tab-1:/ws/shot.png',
        title: 'shot.png',
        icon: Icon.IMAGE_FILE,
        role: 'document',
        component: StubSelfSavingPanel,
        dirty,
        save,
      });
      dockState.tabInto(wellId(), 'image-well:tab-1:/ws/shot.png');
    });

    /**
     * Gets the id of the view's document well.
     * @returns Returns the well's stack id.
     */
    function wellId(): string {
      const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
      if (well === null) {
        throw new Error('The view has no document well');
      }
      return well.id;
    }

    it('hasUnsavedChanges_countsAnEditedPanelInTheLayoutOnly', (): void => {
      expect(commands.hasUnsavedChanges()).toBe(true);

      // Closing the panel leaves it registered; it must stop counting once it has left the layout.
      dockState.removeFromLayout('image-well:tab-1:/ws/shot.png');

      expect(commands.hasUnsavedChanges()).toBe(false);
    });

    it('saveAll_savesTheTextDocumentsAndTheEditedPanel', async (): Promise<void> => {
      const saveAllText: Mock<() => Promise<boolean>> = vi
        .spyOn(documents, 'saveAll')
        .mockResolvedValue(true);

      commands.saveAll();
      await fixture.whenStable();

      expect(saveAllText).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();
    });

    it('saveAll_skipsAPanelWithNothingToSave', async (): Promise<void> => {
      dirty.set(false);

      commands.saveAll();
      await fixture.whenStable();

      expect(save).not.toHaveBeenCalled();
    });

    it('save_whenTheFocusedWellShowsTheEditedPanel_savesIt', async (): Promise<void> => {
      const saveText: Mock<() => Promise<boolean>> = vi
        .spyOn(documents, 'saveActive')
        .mockResolvedValue(true);
      fixture.debugElement.injector.get(DockFocus).focus(wellId());

      expect(commands.canSave()).toBe(true);
      commands.save();
      await fixture.whenStable();

      expect(save).toHaveBeenCalledOnce();
      expect(saveText).not.toHaveBeenCalled();
      expect(commands.canSave()).toBe(false);
    });

    it('save_whenFocusIsOnAToolAndATextDocumentIsActive_savesTheTextDocument', (): void => {
      const saveText: Mock<() => Promise<boolean>> = vi
        .spyOn(documents, 'saveActive')
        .mockResolvedValue(true);
      documents.setActiveDocument('doc-1');
      fixture.debugElement.injector.get(DockFocus).focus('not-a-well');

      commands.save();

      expect(saveText).toHaveBeenCalledOnce();
      expect(save).not.toHaveBeenCalled();
    });

    it('saveAllChord_withFocusOutsideTheWell_savesTheEditedPanel', async (): Promise<void> => {
      fixture.debugElement.injector.get(DockFocus).focus('not-a-well');

      const handled: boolean = TestBed.inject(Keybindings).dispatch(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
      );
      await fixture.whenStable();

      expect(handled).toBe(true);
      expect(save).toHaveBeenCalledOnce();
    });
  });

  // Anything that opens a document reaches for THIS tab's dock. A service left to the root injector
  // gets the root DockState, which no view renders — so the tab opens where nobody can see it, and
  // the click looks like it did nothing. The pairs below must be scoped here, together.
  const perTabServices: readonly [string, unknown][] = [
    ['Diffs', Diffs],
    ['DiffOpener', DiffOpener],
    ['IssueStore', IssueStore],
    ['IssueOpener', IssueOpener],
    ['DockState', DockState],
    ['DockPanelRegistry', DockPanelRegistry],
  ];

  for (const [name, token] of perTabServices) {
    it(`providers_${name}_isScopedToTheTabNotTheRoot`, () => {
      const scoped: unknown = fixture.debugElement.injector.get(token as never);
      expect(scoped).not.toBe(TestBed.inject(token as never));
    });
  }

  describe('language servers of a hidden view', () => {
    let client: LspClient;
    let suspend: MockInstance<LspClient['suspend']>;
    let resume: MockInstance<LspClient['resume']>;

    beforeEach(async () => {
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
      client = fixture.debugElement.injector.get(LspClient);
      suspend = vi.spyOn(client, 'suspend').mockReturnValue(undefined);
      resume = vi.spyOn(client, 'resume').mockReturnValue(undefined);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('hidden_pastTheIdleWait_stopsThem', () => {
      fixture.componentRef.setInput('isActive', false);
      TestBed.tick();

      vi.advanceTimersByTime(10 * 60_000 - 1);
      expect(suspend).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(suspend).toHaveBeenCalledTimes(1);
    });

    it('shownAgainInTime_keepsThem_andResumes', () => {
      fixture.componentRef.setInput('isActive', false);
      TestBed.tick();
      vi.advanceTimersByTime(60_000);
      resume.mockClear();

      fixture.componentRef.setInput('isActive', true);
      TestBed.tick();
      vi.advanceTimersByTime(60 * 60_000);

      expect(suspend).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('withStopSetToNever_keepsThem', () => {
      TestBed.inject(Settings).set('lsp.idleStopMinutes', 0);
      fixture.componentRef.setInput('isActive', false);
      TestBed.tick();

      vi.advanceTimersByTime(24 * 60 * 60_000);

      expect(suspend).not.toHaveBeenCalled();
    });
  });

  describe('promoting to worktrees', () => {
    let promoted: Mock<(conversationId: string | null) => void>;

    beforeEach(async () => {
      promoted = vi.fn<(conversationId: string | null) => void>();
      fixture.componentRef.setInput('promoteHandler', promoted);
      fixture.componentRef.setInput('isActive', true);
      await fixture.whenStable();
    });

    it('promote_whileTheAgentWorks_isRefusedWithTheReason', async () => {
      fixture.debugElement.injector.get(Agent).send('working');

      TestBed.inject(SourceControlCommands).promoteToWorktree();
      await fixture.whenStable();

      expect(promoted).not.toHaveBeenCalled();
      expect(TestBed.inject(Notifications).toasts()[0].title).toBe(
        'Could not convert to worktrees',
      );
    });

    it('promote_whenIdle_handsTheConversationToTheHost', async () => {
      vi.spyOn(fixture.debugElement.injector.get(AgentConversation), 'flush').mockResolvedValue(
        'conversation-1',
      );

      TestBed.inject(SourceControlCommands).promoteToWorktree();
      await fixture.whenStable();

      expect(promoted).toHaveBeenCalledWith('conversation-1');
    });
  });
});
