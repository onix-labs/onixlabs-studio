import { TestBed } from '@angular/core/testing';

import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { SaveDialogChoice } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  UNSAVED_WORK,
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import { Lifecycle } from './lifecycle';

describe('Lifecycle', () => {
  let requestClose: () => void;
  let respondedWith: boolean[];
  let savedIds: string[];
  let dirty: UnsavedDocument[];
  let secondaryDirty: UnsavedDocument[];
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

    const fileSystemStub: Pick<FileSystem, 'confirmSave'> = {
      confirmSave: (fileName: string): Promise<SaveDialogChoice> =>
        Promise.resolve(choices.get(fileName) ?? 'dontSave'),
    };

    /**
     * Builds a stub unsaved-work source over the given dirty list.
     * @param documents Returns the source's dirty documents when called.
     * @returns Returns the stub source, recording saves into the shared `savedIds`.
     */
    const source: (documents: () => readonly UnsavedDocument[]) => UnsavedWorkSource = (
      documents: () => readonly UnsavedDocument[],
    ): UnsavedWorkSource => ({
      dirtyDocuments: documents,
      dirtyDocumentsFor: (tabId: string): readonly UnsavedDocument[] =>
        documents().filter((document: UnsavedDocument): boolean => document.id === tabId),
      save: (id: string): Promise<boolean> => {
        savedIds.push(id);
        return Promise.resolve(saveResult);
      },
      release: (): void => undefined,
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: UNSAVED_WORK,
          useValue: source((): readonly UnsavedDocument[] => dirty),
          multi: true,
        },
        {
          provide: UNSAVED_WORK,
          useValue: source((): readonly UnsavedDocument[] => secondaryDirty),
          multi: true,
        },
        { provide: FileSystem, useValue: fileSystemStub },
      ],
    });
    return TestBed.inject(Lifecycle);
  }

  beforeEach(() => {
    respondedWith = [];
    savedIds = [];
    dirty = [];
    secondaryDirty = [];
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

  it('requestClose_promptsEveryContributedSource', async () => {
    // A second source (the binary feature's document model, in the app) must be prompted too —
    // the regression behind #225 was binary documents being invisible to the close prompt.
    dirty = [{ id: 'a', name: 'a.ts' }];
    secondaryDirty = [{ id: 'blob', name: 'firmware.bin' }];
    choices.set('a.ts', 'save');
    choices.set('firmware.bin', 'save');
    create();

    requestClose();
    await flush();

    expect(savedIds).toEqual(['a', 'blob']);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_promptsSourcesRegisteredAtRuntime', async () => {
    // A workspace tab's document well registers its per-view Documents at runtime; the window close
    // must prompt for its unsaved work too (#231 — before, only the static sources were walked).
    choices.set('well.ts', 'save');
    const lifecycle: Lifecycle = create();
    void lifecycle;
    TestBed.inject(UnsavedWorkRegistry).register({
      dirtyDocuments: (): readonly UnsavedDocument[] => [{ id: 'well-1', name: 'well.ts' }],
      dirtyDocumentsFor: (): readonly UnsavedDocument[] => [],
      save: (id: string): Promise<boolean> => {
        savedIds.push(id);
        return Promise.resolve(true);
      },
      release: (): void => undefined,
    });

    requestClose();
    await flush();

    expect(savedIds).toEqual(['well-1']);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenSecondSourceCancelled_keepsTheWindowOpen', async () => {
    secondaryDirty = [{ id: 'blob', name: 'firmware.bin' }];
    choices.set('firmware.bin', 'cancel');
    create();

    requestClose();
    await flush();

    expect(respondedWith).toEqual([false]);
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
