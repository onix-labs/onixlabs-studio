import { TestBed } from '@angular/core/testing';

import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { SaveDialogChoice } from '@shared/api/file-channels';
import { Documents, UnsavedDocument } from '@shared/angular/services/documents/documents';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
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
   * Installs a stub transport on `window.bridge` routing the app-lifecycle channels, and the service's
   * dependencies, then injects the service so it subscribes to close requests.
   * @returns Returns the injected service.
   */
  function create(): Lifecycle {
    const bridge: Bridge = {
      invoke: <T>(): Promise<T> => Promise.resolve(undefined as T),
      send: (channel: string, ...args: unknown[]): void => {
        if (channel === (AppChannel.ConfirmClose as string)) {
          respondedWith.push(args[0] as boolean);
        }
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (AppChannel.RequestClose as string)) {
          requestClose = listener;
        }
        return (): void => undefined;
      },
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;

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
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
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
