import { TestBed } from '@angular/core/testing';
import { MergeToolPanel } from '@shared/angular/components/panels/merge-tool-panel/merge-tool-panel';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { OpenOptions } from '@shared/angular/services/tabs/tab';
import { MergeToolOpener } from './merge-tool-opener';
import { MergeTools } from './merge-tools';

/**
 * Stands in for the workspace's file opener: a text file opens as a document, anything named `.png`
 * opens as something else, and a path containing `missing` does not open at all.
 */
class FakeFileOpener {
  /**
   * Holds what was opened, and how.
   */
  public readonly opened: { readonly path: string; readonly options?: OpenOptions }[] = [];

  /**
   * Initializes a new instance of the {@link FakeFileOpener} class.
   * @param documents The documents a text file opens into.
   */
  public constructor(private readonly documents: Documents) {}

  /**
   * Opens a file, as the workspace's opener does.
   * @param path The file's absolute path.
   * @param options How it is opened.
   * @returns Returns whether it opened.
   */
  public openPath(path: string, options?: OpenOptions): Promise<boolean> {
    this.opened.push({ path, ...(options === undefined ? {} : { options }) });
    if (path.includes('missing')) {
      return Promise.resolve(false);
    }
    if (!path.endsWith('.png') && this.documents.findIdByPath(path) === undefined) {
      this.documents.createWellDocument({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        content: '',
      } as Parameters<Documents['createWellDocument']>[0]);
    }
    return Promise.resolve(true);
  }
}

describe('MergeToolOpener', () => {
  let opener: MergeToolOpener;
  let files: FakeFileOpener;
  let tools: MergeTools;
  let registry: DockPanelRegistry;
  let dockState: DockState;

  /**
   * Gets the document well of the default layout.
   * @returns Returns the well.
   */
  function well(): StackNode {
    const stack: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    if (stack === null) {
      throw new Error('The default layout should contain a document well.');
    }
    return stack;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FileOpener,
          useFactory: (): FakeFileOpener => new FakeFileOpener(TestBed.inject(Documents)),
        },
      ],
    });
    opener = TestBed.inject(MergeToolOpener);
    files = TestBed.inject(FileOpener) as unknown as FakeFileOpener;
    tools = TestBed.inject(MergeTools);
    registry = TestBed.inject(DockPanelRegistry);
    dockState = TestBed.inject(DockState);
  });

  it('opensTheFileBehind_thenTheMergeToolInFrontOfIt', async () => {
    expect(await opener.open('/repo/src/app.ts')).toBe(true);

    const id: string = tools.idForPath('/repo/src/app.ts');
    // The file is opened without taking the user away from where they are; the merge tool is shown.
    expect(files.opened).toEqual([{ path: '/repo/src/app.ts', options: { background: true } }]);
    expect(registry.get(id)?.component).toBe(MergeToolPanel);
    expect(registry.get(id)?.title).toBe('app.ts (Merge)');
    expect(well().panels).toContain(id);
    expect(well().active).toBe(id);
    expect(tools.pathOf(id)).toBe('/repo/src/app.ts');
    expect(TestBed.inject(DockFocus).focusedStackId()).toBe(well().id);
  });

  it('asksForTheConflictItWasOpenedOn_orTheFirst', async () => {
    await opener.open('/repo/a.ts', 3);
    expect(tools.reveal()).toEqual(
      expect.objectContaining({ panelId: tools.idForPath('/repo/a.ts'), index: 3 }),
    );

    await opener.open('/repo/a.ts');
    expect(tools.reveal()?.index).toBe(0);
  });

  it('goesToTheMergeToolAlreadyOpen_ratherThanOpeningAnother', async () => {
    await opener.open('/repo/a.ts');
    await opener.open('/repo/b.ts');
    await opener.open('/repo/a.ts');

    const id: string = tools.idForPath('/repo/a.ts');
    expect(well().panels.filter((panel: string): boolean => panel === id)).toHaveLength(1);
    expect(well().active).toBe(id);
  });

  it('savesTheFile_whenTheMergeToolIsSaved', async () => {
    const documents: Documents = TestBed.inject(Documents);
    let saved: string | null = null;
    documents.save = (id: string): Promise<boolean> => {
      saved = id;
      return Promise.resolve(true);
    };

    await opener.open('/repo/a.ts');

    expect(await registry.get(tools.idForPath('/repo/a.ts'))?.save?.()).toBe(true);
    expect(saved).toBe(documents.findIdByPath('/repo/a.ts'));
  });

  it('opensNothing_forAFileThatDidNotOpen_orDidNotOpenAsText', async () => {
    expect(await opener.open('/repo/missing.ts')).toBe(false);
    expect(await opener.open('/repo/logo.png')).toBe(false);

    expect(registry.has(tools.idForPath('/repo/missing.ts'))).toBe(false);
    expect(registry.has(tools.idForPath('/repo/logo.png'))).toBe(false);
  });
});
