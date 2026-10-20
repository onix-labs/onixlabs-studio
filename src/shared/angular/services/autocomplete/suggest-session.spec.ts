import { markStudioProvider } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import type * as MonacoApi from 'monaco-editor';
import type { CompletionListView } from '@shared/angular/components/completion-list/completion-list';
import type {
  SuggestAcceptance,
  SuggestControl,
  SuggestItem,
  SuggestList,
} from '@shared/angular/services/monaco/monaco-suggest-commands';
import {
  Cancellation,
  CompletionSurface,
  EditorOrigin,
  EMPTY_MESSAGE,
  LOADING_MESSAGE,
  SuggestSession,
  servedOnly,
  SuggestSessionHost,
} from './suggest-session';

/**
 * A listener of one of the fake editor's events.
 */
type Listener = (value?: unknown) => void;

/**
 * A fake editor and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly keys: Map<string, boolean>;
  readonly aria: (string | undefined)[];
  fire(event: string, value?: unknown): void;
  visible: boolean;
  commitOnCharacter: boolean;
  width: number;
}

/**
 * Builds a fake editor: its caret on line 1, column 5, after the word `abcd`.
 * @returns Returns the editor and its recorders.
 */
function fakeEditor(): FakeEditor {
  const listeners: Map<string, Listener[]> = new Map<string, Listener[]>();
  const subscribe: (event: string) => (listener: Listener) => MonacoApi.IDisposable =
    (event: string) =>
    (listener: Listener): MonacoApi.IDisposable => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return { dispose: (): void => undefined };
    };
  const keys: Map<string, boolean> = new Map<string, boolean>();
  const fake: FakeEditor = {
    keys,
    aria: [],
    visible: true,
    commitOnCharacter: true,
    width: 2000,
    fire: (event: string, value?: unknown): void => {
      for (const listener of listeners.get(event) ?? []) {
        listener(value);
      }
    },
    editor: undefined as unknown as MonacoApi.editor.ICodeEditor,
  };
  (fake as { editor: unknown }).editor = {
    createContextKey: (key: string, value: boolean): { set(next: boolean): void } => {
      keys.set(key, value);
      return { set: (next: boolean): void => void keys.set(key, next) };
    },
    onDidCompositionStart: subscribe('compositionStart'),
    onDidCompositionEnd: subscribe('compositionEnd'),
    onDidScrollChange: subscribe('scroll'),
    onDidLayoutChange: subscribe('layout'),
    onWillType: subscribe('type'),
    getPosition: (): MonacoApi.IPosition => ({ lineNumber: 1, column: 5 }),
    getModel: (): unknown => ({
      getWordUntilPosition: (): MonacoApi.editor.IWordAtPosition => ({
        startColumn: 1,
        endColumn: 5,
        word: 'abcd',
      }),
      getLanguageId: (): string => 'typescript',
    }),
    getScrolledVisiblePosition: (): { top: number; left: number; height: number } | null =>
      fake.visible ? { top: 20, left: 100, height: 18 } : null,
    getContainerDomNode: (): unknown => ({
      getBoundingClientRect: (): unknown => ({ left: 10, top: 30, width: 800, height: 400 }),
      ownerDocument: { defaultView: { innerWidth: fake.width } },
    }),
    getOption: (): boolean => fake.commitOnCharacter,
    setAriaOptions: (options: { activeDescendant: string | undefined }): void =>
      void fake.aria.push(options.activeDescendant),
  };
  return fake;
}

/**
 * A fake host and what was done through it.
 */
interface FakeHost {
  readonly host: SuggestSessionHost;
  readonly views: CompletionListView[];
  readonly origins: (EditorOrigin | null)[];
  readonly cancelled: number[];
  chosen: ((index: number) => void) | null;
  presented: number;
  disposed: number;
  frames: (() => void)[];
  timers: (() => void)[];
  flush(): void;
}

/**
 * Builds a fake host whose frames and timers run only when the spec says.
 * @returns Returns the host and its recorders.
 */
function fakeHost(): FakeHost {
  let requests: number = 0;
  const fake: FakeHost = {
    views: [],
    origins: [],
    cancelled: [],
    chosen: null,
    presented: 0,
    disposed: 0,
    frames: [],
    timers: [],
    flush: (): void => {
      const frames: (() => void)[] = fake.frames;
      fake.frames = [];
      for (const frame of frames) {
        frame();
      }
    },
    host: {
      present: (_origin: EditorOrigin, chosen: (index: number) => void): CompletionSurface => {
        fake.presented += 1;
        fake.chosen = chosen;
        return {
          update: (view: CompletionListView): void => void fake.views.push(view),
          place: (origin: EditorOrigin | null): void => void fake.origins.push(origin),
          dispose: (): void => void (fake.disposed += 1),
        };
      },
      frame: (run: () => void): (() => void) => {
        fake.frames.push(run);
        return (): void => {
          fake.frames = fake.frames.filter((frame: () => void): boolean => frame !== run);
        };
      },
      delay: (run: () => void): (() => void) => {
        fake.timers.push(run);
        return (): void => {
          fake.timers = fake.timers.filter((timer: () => void): boolean => timer !== run);
        };
      },
      cancellation: (): Cancellation => {
        const id: number = (requests += 1);
        return {
          token: { isCancellationRequested: false } as MonacoApi.CancellationToken,
          cancel: (): void => void fake.cancelled.push(id),
          dispose: (): void => undefined,
        };
      },
    },
  };
  return fake;
}

/**
 * A fake control and what was done through it.
 */
interface FakeControl {
  readonly control: SuggestControl;
  readonly inserted: [string, SuggestAcceptance][];
  readonly focused: string[];
}

/**
 * Builds a fake control of a running session.
 * @returns Returns the control and its recorders.
 */
function fakeControl(): FakeControl {
  const inserted: [string, SuggestAcceptance][] = [];
  const focused: string[] = [];
  return {
    inserted,
    focused,
    control: {
      active: true,
      insert: (item: SuggestItem, how: SuggestAcceptance): void =>
        void inserted.push([item.textLabel, how]),
      cancel: (): void => undefined,
      focused: (item: SuggestItem): void => void focused.push(item.textLabel),
    },
  };
}

/**
 * Builds a completion.
 * @param label The label.
 * @param extra Members to override.
 * @returns Returns the completion.
 */
function item(label: string, extra: Partial<SuggestItem> = {}): SuggestItem {
  return {
    completion: { label, kind: 0, insertText: label } as MonacoApi.languages.CompletionItem,
    textLabel: label,
    score: [0, 0],
    provider: {},
    isResolved: true,
    resolve: (): Promise<void> => Promise.resolve(),
    ...extra,
  };
}

/**
 * Builds an answer.
 * @param items The items.
 * @param extra Members to override.
 * @returns Returns the answer.
 */
function answer(items: readonly SuggestItem[], extra: Partial<SuggestList> = {}): SuggestList {
  return { items, selected: items[0], frozen: false, auto: true, noFocus: false, ...extra };
}

describe('SuggestSession (#1021)', () => {
  let editor: FakeEditor;
  let host: FakeHost;
  let control: FakeControl;
  let session: SuggestSession;

  beforeEach(() => {
    editor = fakeEditor();
    host = fakeHost();
    control = fakeControl();
    session = new SuggestSession(editor.editor, host.host);
  });

  /**
   * Gets the last view drawn.
   * @returns Returns the view.
   */
  function lastView(): CompletionListView {
    return host.views[host.views.length - 1];
  }

  it('showsAnAnswer_withMonacosChoiceFocused_andSetsItsKeys', () => {
    const items: SuggestItem[] = [item('alpha'), item('beta')];

    session.suggestions(control.control, answer(items, { selected: items[1] }));
    host.flush();

    expect(editor.keys.get('studioSuggestVisible')).toBe(true);
    expect(editor.keys.get('studioSuggestFocused')).toBe(true);
    expect(host.presented).toBe(1);
    expect(lastView().count).toBe(2);
    expect(lastView().focused).toBe(1);
    expect(lastView().row(0).label).toBe('alpha');
    expect(control.focused).toEqual(['beta']);
    // Placed at the word's start, less the rows' icon, under the caret's line.
    expect(host.origins[0]).toEqual({ x: 10 + 100 - 24, y: 50, width: 0, height: 18 });
    expect(editor.aria[editor.aria.length - 1]).toMatch(/^studio-completion-\d+-1$/);
  });

  it('drawsOnce_perFrame_howeverManyChangesComeFirst', () => {
    session.suggestions(control.control, answer([item('a'), item('b'), item('c')]));
    session.move('next');
    session.move('next');

    expect(host.frames).toHaveLength(1);
    host.flush();
    expect(host.views).toHaveLength(1);
    expect(lastView().focused).toBe(2);
  });

  it('movesTheFocus_roundTheEnds_byPages_andToEitherEnd', () => {
    const items: SuggestItem[] = Array.from({ length: 30 }, (_: unknown, index: number) =>
      item(`item${index}`),
    );
    session.suggestions(control.control, answer(items));

    const focusAfter: (move: Parameters<SuggestSession['move']>[0]) => string | undefined = (
      move: Parameters<SuggestSession['move']>[0],
    ): string | undefined => {
      session.move(move);
      return session.focusedItem()?.textLabel;
    };

    expect(focusAfter('previous')).toBe('item29');
    expect(focusAfter('next')).toBe('item0');
    expect(focusAfter('nextPage')).toBe('item11');
    expect(focusAfter('nextPage')).toBe('item22');
    expect(focusAfter('nextPage')).toBe('item29');
    expect(focusAfter('previousPage')).toBe('item18');
    expect(focusAfter('first')).toBe('item0');
    expect(focusAfter('last')).toBe('item29');
  });

  it('accepts_theFocusedItem_throughMonacosInsertion', () => {
    session.suggestions(control.control, answer([item('alpha'), item('beta')]));
    session.move('next');

    expect(session.accept()).toBe(true);
    expect(control.inserted).toEqual([['beta', 'select']]);
  });

  it('neverAccepts_whileAnInputMethodComposes', () => {
    session.suggestions(control.control, answer([item('alpha')]));

    editor.fire('compositionStart');
    expect(editor.keys.get('studioEditorComposing')).toBe(true);
    expect(session.accept()).toBe(false);
    session.choose(0);
    editor.fire('type', '.');
    editor.fire('compositionEnd');

    expect(control.inserted).toEqual([]);
    expect(editor.keys.get('studioEditorComposing')).toBe(false);
    expect(session.accept()).toBe(true);
  });

  it('choose_focusesAndAcceptsTheRowClicked', () => {
    session.suggestions(control.control, answer([item('alpha'), item('beta')]));
    host.flush();

    host.chosen?.(1);

    expect(control.inserted).toEqual([['beta', 'select']]);
  });

  it('withNoFocus_entersAndTabsPassToTheEditor', () => {
    session.suggestions(control.control, answer([item('alpha')], { noFocus: true }));

    expect(editor.keys.get('studioSuggestVisible')).toBe(true);
    expect(editor.keys.get('studioSuggestFocused')).toBe(false);
    expect(session.accept()).toBe(false);
    session.move('next');
    expect(editor.keys.get('studioSuggestFocused')).toBe(true);
  });

  it('hidden_takesTheListAway_andClearsItsKeys', () => {
    session.suggestions(control.control, answer([item('alpha')]));
    host.flush();

    session.hidden();

    expect(host.disposed).toBe(1);
    expect(editor.keys.get('studioSuggestVisible')).toBe(false);
    expect(editor.keys.get('studioSuggestFocused')).toBe(false);
    expect(session.focusedItem()).toBeUndefined();
    expect(editor.aria[editor.aria.length - 1]).toBeUndefined();
  });

  it('anEmptyAnswer_closesASessionThatStartedOnItsOwn', () => {
    session.suggestions(control.control, answer([item('alpha')]));
    session.suggestions(control.control, answer([], { auto: true }));

    expect(session.showing).toBe(false);
  });

  it('anEmptyAnswer_saysSo_forASessionTheUserAskedFor', () => {
    session.suggestions(control.control, answer([], { auto: false }));
    host.flush();

    expect(session.showing).toBe(true);
    expect(lastView().count).toBe(0);
    expect(lastView().message).toBe(EMPTY_MESSAGE);
    expect(editor.keys.get('studioSuggestFocused')).toBe(false);
  });

  it('saysItIsLoading_afterTheDelay_onlyForASessionTheUserAskedFor', () => {
    session.triggered(control.control, true, 50);
    expect(host.timers).toHaveLength(0);

    session.triggered(control.control, false, 50);
    host.timers[0]();
    host.flush();

    expect(lastView().message).toBe(LOADING_MESSAGE);
  });

  it('anAnswerBeforeTheDelay_cancelsLoading', () => {
    session.triggered(control.control, false, 50);
    session.suggestions(control.control, answer([item('alpha')]));

    expect(host.timers).toHaveLength(0);
  });

  it('aFrozenAnswer_keepsWhatShows', () => {
    session.suggestions(control.control, answer([item('alpha')]));
    session.suggestions(control.control, answer([item('other')], { frozen: true }));

    expect(session.focusedItem()?.textLabel).toBe('alpha');
  });

  it('acceptsOnACommitCharacter_unlessTheEditorSaysNot', () => {
    const member: SuggestItem = item('member', {
      completion: {
        label: 'member',
        kind: 0,
        insertText: 'member',
        commitCharacters: ['.', '('],
      } as never,
    });
    session.suggestions(control.control, answer([member]));

    editor.fire('type', 'x');
    editor.commitOnCharacter = false;
    editor.fire('type', '.');
    editor.commitOnCharacter = true;
    editor.fire('type', '(');

    expect(control.inserted).toEqual([['member', 'commit']]);
  });

  it('resolvesTheFocusedItem_andDropsTheAnswerForOneNoLongerFocused', async () => {
    let finish: () => void = (): void => undefined;
    const slow: SuggestItem = item('slow', {
      provider: { resolveCompletionItem: (): void => undefined },
      isResolved: false,
      resolve: (): Promise<void> =>
        new Promise<void>((resolve: () => void): void => {
          finish = resolve;
        }),
    });
    session.suggestions(control.control, answer([slow, item('fast')]));
    host.flush();

    session.move('next');
    host.flush();
    const drawn: number = host.views.length;
    finish();
    await Promise.resolve();
    await Promise.resolve();

    // The request for the item no longer focused was cancelled, and its answer drew nothing.
    expect(host.cancelled).toEqual([1]);
    expect(host.frames).toHaveLength(0);
    expect(host.views).toHaveLength(drawn);
  });

  it('showsTheFocusedItemsDetails_onceResolved', async () => {
    const resolving: SuggestItem = item('doc', {
      provider: { resolveCompletionItem: (): void => undefined },
      isResolved: false,
    });
    resolving.resolve = (): Promise<void> =>
      Promise.resolve().then((): void => {
        (resolving.completion as { documentation?: string }).documentation = 'Documented.';
      });
    session.suggestions(control.control, answer([resolving]));
    host.flush();
    expect(lastView().details).toBeNull();

    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 0));
    host.flush();

    expect(lastView().details).toEqual({ sections: ['Documented\\.'] });
  });

  it('hidesTheList_whileTheCaretsLineIsOutOfSight', () => {
    session.suggestions(control.control, answer([item('alpha')]));
    host.flush();

    editor.visible = false;
    editor.fire('scroll');
    host.flush();

    expect(host.origins[host.origins.length - 1]).toBeNull();
  });

  it('putsTheDetailsUnderTheList_whenThereIsNoRoomBeside', () => {
    session.suggestions(control.control, answer([item('alpha')]));
    host.flush();
    expect(lastView().placement).toBe('side');

    editor.width = 500;
    editor.fire('layout');
    host.flush();

    expect(lastView().placement).toBe('below');
  });
});

describe('servedOnly (#1021)', () => {
  /**
   * Builds an item from a provider, with only what the filter reads.
   * @param provider The provider.
   * @param label The label.
   * @returns Returns the item.
   */
  function from(provider: object, label: string): SuggestItem {
    return { provider, textLabel: label } as unknown as SuggestItem;
  }

  it('keepsALanguageServersCompletionsAlone_soNoSymbolIsListedTwice', () => {
    // Matthew's live check found "greet" twice: the server's and Monaco's worker's.
    const server: object = {};
    const worker: object = {};
    markStudioProvider(server);
    const items: readonly SuggestItem[] = [
      from(worker, 'greet'),
      from(server, 'greet'),
      from(server, 'groupEnd'),
    ];

    expect(servedOnly(items).map((item: SuggestItem): string => item.textLabel)).toEqual([
      'greet',
      'groupEnd',
    ]);
    expect(servedOnly(items).every((item: SuggestItem): boolean => item.provider === server)).toBe(
      true,
    );
  });

  it('keepsEverything_whereNoServerSpoke', () => {
    const items: readonly SuggestItem[] = [from({}, 'alpha'), from({}, 'beta')];

    expect(servedOnly(items)).toEqual(items);
  });
});
