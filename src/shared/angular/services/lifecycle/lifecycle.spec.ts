import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { ConfirmDestructiveRequest, SaveDialogChoice } from '@shared/api/file-channels';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { RunningWork } from '@shared/angular/services/running-work/running-work';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentConversations } from '@shared/angular/services/agent-conversations/agent-conversations';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import {
  UNSAVED_WORK,
  UnsavedDocument,
  UnsavedWorkSource,
} from '@shared/angular/services/unsaved-work/unsaved-work';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import { Dormancy } from '@shared/angular/services/dormancy/dormancy';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Lifecycle } from './lifecycle';

describe('Lifecycle', () => {
  let requestClose: () => void;
  let requestPark: () => void;
  let wake: () => void;
  let parkedWith: boolean[];
  let respondedWith: boolean[];
  let savedIds: string[];
  let dirty: UnsavedDocument[];
  let secondaryDirty: UnsavedDocument[];
  let saveResult: boolean;
  let choices: Map<string, SaveDialogChoice>;
  let runningAgents: WritableSignal<number>;
  let debugging: WritableSignal<boolean>;
  let quitQuestions: ConfirmDestructiveRequest[];
  let quitAnswer: boolean;

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
        if (channel === (AppChannel.ConfirmPark as string)) {
          parkedWith.push(args[0] as boolean);
        }
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (AppChannel.RequestClose as string)) {
          requestClose = listener;
        }
        if (channel === (AppChannel.RequestPark as string)) {
          requestPark = listener;
        }
        if (channel === (AppChannel.Wake as string)) {
          wake = listener;
        }
        return (): void => undefined;
      },
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;

    const fileSystemStub: Pick<FileSystem, 'confirmSave' | 'confirmDestructive'> = {
      confirmSave: (fileName: string): Promise<SaveDialogChoice> =>
        Promise.resolve(choices.get(fileName) ?? 'dontSave'),
      confirmDestructive: (request: ConfirmDestructiveRequest): Promise<boolean> => {
        quitQuestions.push(request);
        return Promise.resolve(quitAnswer);
      },
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
        { provide: AgentHosts, useValue: { runningCount: runningAgents, hosts: signal([]) } },
        { provide: Debugger, useValue: { running: debugging } },
      ],
    });
    return TestBed.inject(Lifecycle);
  }

  beforeEach(() => {
    respondedWith = [];
    parkedWith = [];
    savedIds = [];
    dirty = [];
    secondaryDirty = [];
    saveResult = true;
    choices = new Map<string, SaveDialogChoice>();
    runningAgents = signal<number>(0);
    debugging = signal<boolean>(false);
    quitQuestions = [];
    quitAnswer = true;
  });

  afterEach(() => {
    // The settings persist through localStorage; a test's choice must not reach the next one.
    globalThis.localStorage?.clear();
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('requestClose_whenNoUnsavedChanges_proceeds', async () => {
    create();

    requestClose();
    await flush();

    expect(respondedWith).toEqual([true]);
    expect(savedIds).toHaveLength(0);
  });

  it('requestPark_closesEveryTab_andGoesDormant', async () => {
    create();
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('settings');
    tabs.open('terminal');

    requestPark();
    await flush();

    expect(tabs.tabs()).toHaveLength(0);
    expect(TestBed.inject(Dormancy).dormant()).toBe(true);
    expect(parkedWith).toEqual([true]);
  });

  it('requestPark_whenAnUnsavedDocumentIsCancelled_keepsEverything', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'cancel');
    create();
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('settings');

    requestPark();
    await flush();

    expect(tabs.tabs()).toHaveLength(1);
    expect(TestBed.inject(Dormancy).dormant()).toBe(false);
    expect(parkedWith).toEqual([false]);
  });

  it('requestPark_whenAnAgentIsRunning_asksBeforeClosingTheWindow', async () => {
    runningAgents.set(1);
    quitAnswer = false;
    create();

    requestPark();
    await flush();

    expect(quitQuestions[0].confirmLabel).toBe('Close Window');
    expect(parkedWith).toEqual([false]);
  });

  it('requestPark_whenSetToAlways_asksEvenWithNothingRunning', async () => {
    create();
    TestBed.inject(Settings).assign('application.confirmBeforeQuitting', 'always');

    requestPark();
    await flush();

    expect(quitQuestions).toHaveLength(1);
    expect(quitQuestions[0].message).toBe('Close the window?');
    expect(parkedWith).toEqual([true]);
  });

  it('requestPark_whenNothingIsRunning_doesNotAsk', async () => {
    create();

    requestPark();
    await flush();

    expect(quitQuestions).toHaveLength(0);
    expect(parkedWith).toEqual([true]);
  });

  it('wake_endsTheDormancy', async () => {
    create();
    requestPark();
    await flush();

    wake();

    expect(TestBed.inject(Dormancy).dormant()).toBe(false);
  });

  it('requestClose_whenNothingIsRunning_doesNotAskToQuit', async () => {
    create();

    requestClose();
    await flush();

    expect(quitQuestions).toHaveLength(0);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenAnAgentIsRunning_asksBeforeQuitting', async () => {
    runningAgents.set(2);
    create();

    requestClose();
    await flush();

    expect(quitQuestions).toHaveLength(1);
    expect(quitQuestions[0].detail).toContain('2 agents');
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenQuittingIsDeclined_keepsTheWindowOpenWithoutPromptingToSave', async () => {
    debugging.set(true);
    quitAnswer = false;
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'save');
    create();

    requestClose();
    await flush();

    expect(respondedWith).toEqual([false]);
    expect(savedIds).toHaveLength(0);
  });

  it('requestClose_countsEveryWorkspacesRuns', async () => {
    create();
    TestBed.inject(RunningWork).register({ count: signal<number>(1) });

    requestClose();
    await flush();

    expect(quitQuestions[0].detail).toContain('1 run or build');
  });

  it('requestClose_whenSetToAlways_asksEvenWithNothingRunning', async () => {
    create();
    TestBed.inject(Settings).assign('application.confirmBeforeQuitting', 'always');

    requestClose();
    await flush();

    expect(quitQuestions).toHaveLength(1);
    expect(quitQuestions[0].message).toBe('Quit Studio?');
  });

  it('requestClose_whenSetToNever_doesNotAskWhileWorkIsRunning', async () => {
    runningAgents.set(1);
    create();
    TestBed.inject(Settings).assign('application.confirmBeforeQuitting', 'never');

    requestClose();
    await flush();

    expect(quitQuestions).toHaveLength(0);
    expect(respondedWith).toEqual([true]);
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

  it('requestClose_savesHeldBackConversationsBeforeAnswering', async () => {
    const events: string[] = [];
    create();
    TestBed.inject(AgentConversations).registerPendingSave(async (): Promise<void> => {
      await Promise.resolve();
      events.push('conversation saved');
    });

    requestClose();
    await flush();

    expect(events).toEqual(['conversation saved']);
    expect(respondedWith).toEqual([true]);
  });

  it('requestClose_whenCancelled_leavesHeldBackConversationsToTheirAutosave', async () => {
    dirty = [{ id: 'a', name: 'a.ts' }];
    choices.set('a.ts', 'cancel');
    let saved: boolean = false;
    create();
    TestBed.inject(AgentConversations).registerPendingSave((): Promise<void> => {
      saved = true;
      return Promise.resolve();
    });

    requestClose();
    await flush();

    expect(saved).toBe(false);
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
