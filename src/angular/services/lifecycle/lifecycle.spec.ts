import { TestBed } from '@angular/core/testing';

import type { AppApi, SaveDialogChoice } from '../../../shared/studio-api';
import { Documents, UnsavedDocument } from '../documents/documents';
import { FileSystem } from '../file-system/file-system';
import { Lifecycle } from './lifecycle';

describe('Lifecycle', () => {
  let requestClose: () => void;
  let respondedWith: boolean[];
  let savedIds: string[];
  let dirty: UnsavedDocument[];
  let saveResult: boolean;
  let choices: Map<string, SaveDialogChoice>;

  /**
   * Drains the microtask/timer queue so the asynchronous close handler settles.
   * @returns Returns a promise that resolves after the current task queue drains.
   */
  function flush(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  /**
   * Installs the lifecycle bridge on `window.studio.app` and the service's dependencies, then injects
   * the service so it subscribes to close requests.
   * @returns Returns the injected service.
   */
  function create(): Lifecycle {
    const api: AppApi = {
      onRequestClose: (listener: () => void): (() => void) => {
        requestClose = listener;
        return (): void => undefined;
      },
      respondClose: (proceed: boolean): void => {
        respondedWith.push(proceed);
      },
    };
    (globalThis as unknown as { studio: { app: AppApi } }).studio = { app: api };

    const documentsStub: Pick<Documents, 'dirtyDocuments' | 'save'> = {
      dirtyDocuments: (): readonly UnsavedDocument[] => dirty,
      save: (id: string): Promise<boolean> => {
        savedIds.push(id);
        return Promise.resolve(saveResult);
      },
    };
    const fileSystemStub: Pick<FileSystem, 'confirmSave'> = {
      confirmSave: (fileName: string): Promise<SaveDialogChoice> =>
        Promise.resolve(choices.get(fileName) ?? 'dontSave'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: Documents, useValue: documentsStub },
        { provide: FileSystem, useValue: fileSystemStub },
      ],
    });
    return TestBed.inject(Lifecycle);
  }

  beforeEach(() => {
    respondedWith = [];
    savedIds = [];
    dirty = [];
    saveResult = true;
    choices = new Map<string, SaveDialogChoice>();
  });

  afterEach(() => {
    delete (globalThis as unknown as { studio?: unknown }).studio;
  });

  it('requestClose_whenNoUnsavedChanges_proceeds', async () => {
    create();

    requestClose();
    await flush();

    expect(respondedWith).toEqual([true]);
    expect(savedIds).toHaveLength(0);
  });

  it('requestClose_whenSaveChosen_savesAndProceeds', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'save');
    create();

    requestClose();
    await flush();

    expect(savedIds).toEqual(['a']);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenDiscardChosen_proceedsWithoutSaving', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'dontSave');
    create();

    requestClose();
    await flush();

    expect(savedIds).toHaveLength(0);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenCancelled_keepsTheWindowOpen', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'cancel');
    create();

    requestClose();
    await flush();

    expect(respondedWith).toEqual([false]);
    expect(savedIds).toHaveLength(0);
  });

  it('requestClose_whenSaveAsCancelled_keepsTheWindowOpen', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'save');
    saveResult = false;
    create();

    requestClose();
    await flush();

    expect(savedIds).toEqual(['a']);
    expect(respondedWith).toEqual([false]);
  });
});
