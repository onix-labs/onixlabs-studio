import { Component, input, InputSignal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Mock } from 'vitest';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { WorkspaceDocumentCommands } from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
import { WORKSPACE_KEYBINDINGS } from '@features/workspace/angular/workspace-keybindings';
import { DirectoryListing } from '@shared/api/workspace-channels';
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

import { DirectoryView } from './directory-view';

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
});
