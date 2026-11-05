import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ApiDocument } from '@shared/api/api-client-types';
import { API_DOCUMENT_KIND, API_DOCUMENT_VERSION } from '@shared/api/api-client-types';
import { ApiFiles } from '@shared/angular/services/api-files/api-files';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Settings } from '@shared/angular/services/settings/settings';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { API_EXPLORER_KEYBINDINGS } from '../api-explorer-keybindings';
import { ApiExplorerCommands } from '../api-explorer-commands/api-explorer-commands';
import { ApiHttp } from '../api-http/api-http';
import { ApiWorkspace } from '../api-workspace/api-workspace';
import { ApiExplorerView } from './api-explorer-view';

/**
 * A document with nothing in it.
 */
const EMPTY_DOCUMENT: Partial<ApiDocument> = {
  kind: API_DOCUMENT_KIND,
  version: API_DOCUMENT_VERSION,
  folders: [],
  requests: [],
  environments: [],
};

describe('ApiExplorerView', () => {
  let fixture: ComponentFixture<ApiExplorerView>;
  let view: ApiExplorerView;
  let workspace: ApiWorkspace;

  /**
   * Builds the view for a tab.
   * @param tabId The tab's identifier.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function build(tabId: string = 'tab-1'): Promise<void> {
    fixture = TestBed.createComponent(ApiExplorerView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tabId', tabId);
    workspace = fixture.debugElement.injector.get(ApiWorkspace);
    await fixture.whenStable();
  }

  /**
   * Gets the panel the document well is showing.
   * @returns Returns its identifier, or null when the well is empty.
   */
  function shownRequest(): string | null {
    const dock: DockState = fixture.debugElement.injector.get(DockState);
    return firstStackOfRole(dock.layout(), 'document')?.active ?? null;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ApiExplorerView],
      providers: [provideKeybindingCatalogue(API_EXPLORER_KEYBINDINGS)],
    });
    // No sample content, so each test starts from a workspace with nothing in it.
    TestBed.inject(Settings).set('apiExplorer.sampleContent', false);
  });

  it('send_withNothingOpen_doesNothing', async () => {
    await build();
    const send: MockInstance<ApiWorkspace['send']> = vi.spyOn(workspace, 'send');
    expect(view.canSend()).toBe(false);

    view.send();

    expect(send).not.toHaveBeenCalled();
  });

  it('newRequest_withNoCollection_makesOne_andOpensTheRequest', async () => {
    await build();

    view.newRequest();
    await fixture.whenStable();

    expect(workspace.folders()).toHaveLength(1);
    expect(shownRequest()).toBe(workspace.requests()[0].id);
    expect(view.canSend()).toBe(true);
  });

  it('newRequest_withACollection_addsToIt', async () => {
    await build();
    const collection: { id: string } = workspace.addCollection('Mine');

    view.newRequest();

    expect(workspace.folders()).toHaveLength(1);
    expect(workspace.requests()[0].parentId).toBe(collection.id);
  });

  it('send_ofAnOpenRequest_sendsIt_andCancelsItOncePressedAgain', async () => {
    await build();
    view.newRequest();
    await fixture.whenStable();
    const http: ApiHttp = fixture.debugElement.injector.get(ApiHttp);
    vi.spyOn(http, 'send').mockReturnValue(new Promise<never>((): void => undefined));
    const cancel: MockInstance<ApiHttp['cancel']> = vi.spyOn(http, 'cancel');

    view.send();
    expect(view.sending()).toBe(true);

    view.send();

    expect(cancel).toHaveBeenCalledWith(workspace.requests()[0].id);
  });

  it('cycleEnvironment_withNone_changesNothing', async () => {
    await build();

    view.cycleEnvironment();

    expect(view.environmentName()).toBeNull();
  });

  it('cycleEnvironment_walksThemAndWrapsAtTheEnd', async () => {
    await build();
    workspace.addEnvironment('dev');
    workspace.addEnvironment('prod');
    const names: (string | null)[] = [];

    for (let press: number = 0; press < 3; press += 1) {
      view.cycleEnvironment();
      names.push(view.environmentName());
    }

    // Adding an environment activates the first, so the first press moves on to the second.
    expect(names).toEqual(['prod', 'dev', 'prod']);
  });

  it('dirtyDocuments_listsAnUnsavedWorkspace_onlyForItsOwnTab', async () => {
    await build();
    expect(view.dirtyDocuments()).toEqual([]);

    workspace.addCollection('Mine');

    expect(view.documentDirty()).toBe(true);
    expect(view.dirtyDocumentsFor('tab-1')).toHaveLength(1);
    expect(view.dirtyDocumentsFor('tab-2')).toEqual([]);
  });

  it('save_forAnotherTab_writesNothing_andSucceeds', async () => {
    await build();
    const save: MockInstance<ApiWorkspace['save']> = vi
      .spyOn(workspace, 'save')
      .mockResolvedValue(false);

    await expect(view.save('tab-2')).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();

    await expect(view.save('tab-1')).resolves.toBe(false);
  });

  it('init_withAFileHandedOver_loadsItAndOpensItsFirstRequest', async () => {
    const files: ApiFiles = TestBed.inject(ApiFiles);
    const document: ApiDocument | null = files.parse(
      JSON.stringify({
        ...EMPTY_DOCUMENT,
        folders: [{ id: 'f1', parentId: null, name: 'Orders' }],
        requests: [
          {
            id: 'r1',
            parentId: 'f1',
            name: 'List',
            method: 'GET',
            url: '/orders',
            params: [],
            headers: [],
            body: { kind: 'none', text: '', fields: [] },
            auth: { kind: 'none' },
            description: '',
          },
        ],
      }),
    );
    if (document === null) {
      throw new Error('The fixture is not a document');
    }
    vi.spyOn(files, 'takeInitial').mockReturnValue({
      path: '/ws/orders.api.json',
      fileName: 'orders.api.json',
      document,
    });

    await build();

    expect(workspace.filePath()).toBe('/ws/orders.api.json');
    expect(shownRequest()).toBe('r1');
  });

  it('activeTab_bindsTheSaveChords_andGivesThemUpWhenHidden', async () => {
    await build();
    const keybindings: Keybindings = TestBed.inject(Keybindings);
    const deactivate: MockInstance<Keybindings['deactivate']> = vi.spyOn(keybindings, 'deactivate');
    const register: MockInstance<Keybindings['register']> = vi.spyOn(keybindings, 'register');

    fixture.componentRef.setInput('isActive', true);
    await fixture.whenStable();
    expect(register).toHaveBeenCalledWith('tab-1', expect.any(Array));

    fixture.componentRef.setInput('isActive', false);
    await fixture.whenStable();
    expect(deactivate).toHaveBeenCalledWith('tab-1');
  });

  it('destroy_leavesNothingForTheRibbonOrTheCloseFlowsToDrive', async () => {
    await build();
    const commands: ApiExplorerCommands = TestBed.inject(ApiExplorerCommands);
    const unsaved: UnsavedWorkRegistry = TestBed.inject(UnsavedWorkRegistry);
    workspace.addCollection('Mine');
    expect(commands.documentDirty()).toBe(true);
    expect(unsaved.sources()).toHaveLength(1);

    fixture.destroy();

    expect(commands.documentDirty()).toBe(false);
    expect(unsaved.sources()).toEqual([]);
  });
});
