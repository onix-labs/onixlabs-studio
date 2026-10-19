import type * as MonacoApi from 'monaco-editor';
import {
  installSuggestCommands,
  ParameterHintsControl,
  ParameterHintsPresenter,
  PARAMETER_HINTS_CONTRIBUTION,
  STUDIO_PARAMETER_HINTS_HIDE_COMMAND,
  STUDIO_PARAMETER_HINTS_NEXT_COMMAND,
  STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND,
  STUDIO_SUGGEST_ACCEPT_COMMAND,
  STUDIO_SUGGEST_HIDE_COMMAND,
  STUDIO_SUGGEST_NEXT_COMMAND,
  STUDIO_SUGGEST_NEXT_PAGE_COMMAND,
  STUDIO_SUGGEST_PREVIOUS_COMMAND,
  STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND,
  STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND,
  STUDIO_TRIGGER_SUGGEST_COMMAND,
  SUGGEST_CONTRIBUTION,
  SuggestControl,
  SuggestItem,
  SuggestList,
  SuggestMove,
  SuggestPresenter,
  WORD_BASED_PROVIDER_NAME,
} from './monaco-suggest-commands';

/**
 * Monaco's key modifiers and codes, as the fake instance numbers them.
 */
const CTRL_CMD: number = 2048;
const SHIFT: number = 1024;
const ALT: number = 512;
const WIN_CTRL: number = 256;
const SPACE: number = 10;
const ESCAPE: number = 9;
const KEY_I: number = 39;
const ENTER: number = 3;
const TAB: number = 2;
const UP: number = 16;
const DOWN: number = 18;
const PAGE_UP: number = 11;
const PAGE_DOWN: number = 12;

/**
 * Adds a Monaco widget's DOM to the page, as Monaco's own widgets would when built.
 * @param kind The widget's class.
 */
function buildMonacoWidget(kind: string): void {
  const node: HTMLElement = document.createElement('div');
  node.className = kind;
  document.body.appendChild(node);
}

/**
 * Stands in for Monaco's idle value: builds its value at "window idle" (a timer) unless disposed
 * first, or at once when read.
 */
class FakeIdleValue {
  /**
   * Holds the built value.
   */
  private built: unknown = undefined;

  /**
   * Holds the timer standing for window idle.
   */
  private readonly timer: ReturnType<typeof setTimeout>;

  /**
   * Holds whether it was disposed.
   */
  public disposed: boolean = false;

  /**
   * Initializes a new instance of the {@link FakeIdleValue} class.
   * @param executor Builds the value.
   */
  public constructor(private readonly executor: () => unknown) {
    this.timer = setTimeout((): void => void this.value, 0);
  }

  /**
   * Gets the value, building it the first time.
   * @returns Returns the value.
   */
  public get value(): unknown {
    this.built ??= this.executor();
    return this.built;
  }

  /**
   * Cancels the idle build.
   */
  public dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}

/**
 * Stands in for Monaco's suggest contribution: its constructor makes the widget in an idle value
 * that builds Monaco's suggest DOM, and its model's events reach the widget as Monaco's do.
 */
class FakeSuggestController {
  /**
   * Gets or sets the widget's idle value (or the takeover's stand-in).
   */
  public widget: unknown;

  /**
   * Gets the suggest model's state.
   */
  public readonly model: { state: number } = { state: 0 };

  /**
   * Records the insertions asked of it.
   */
  public readonly inserted: { event: { index: number; item: SuggestItem }; flags: number }[] = [];

  /**
   * Records how often it was asked to cancel and to trigger.
   */
  public cancelled: number = 0;
  public triggered: number = 0;

  /**
   * Initializes a new instance of the {@link FakeSuggestController} class.
   */
  public constructor() {
    this.widget = new FakeIdleValue((): unknown => {
      buildMonacoWidget('suggest-widget');
      return {};
    });
  }

  /**
   * Gets the widget, as Monaco's events reach it.
   * @returns Returns the widget.
   */
  public get value(): Record<string, (...args: unknown[]) => unknown> {
    return (this.widget as { value: Record<string, (...args: unknown[]) => unknown> }).value;
  }

  /**
   * Inserts an item, Monaco's way.
   * @param event The item, its index and the model.
   * @param event.index The item's index.
   * @param event.item The item.
   * @param flags The insert flags.
   */
  public _insertSuggestion(event: { index: number; item: SuggestItem }, flags: number): void {
    this.inserted.push({ event, flags });
  }

  /**
   * Ends the session and hides the widget.
   */
  public cancelSuggestWidget(): void {
    this.cancelled += 1;
    this.value['hideWidget']();
  }

  /**
   * Starts a session.
   */
  public triggerSuggest(): void {
    this.triggered += 1;
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * Stands in for Monaco's lazy value: builds its value when read.
 */
class FakeLazy {
  /**
   * Holds the built value.
   */
  public rawValue: unknown = undefined;

  /**
   * Initializes a new instance of the {@link FakeLazy} class.
   * @param executor Builds the value.
   */
  public constructor(private readonly executor: () => unknown) {}

  /**
   * Gets the value, building it the first time.
   * @returns Returns the value.
   */
  public get value(): unknown {
    this.rawValue ??= this.executor();
    return this.rawValue;
  }
}

/**
 * Stands in for Monaco's parameter-hints contribution: signatures arriving reach its widget as
 * Monaco's do, and the widget builds Monaco's parameter-hints DOM when first read.
 */
class FakeParameterHintsController {
  /**
   * Gets or sets the widget's lazy value (or the takeover's stand-in).
   */
  public widget: unknown = new FakeLazy((): unknown => {
    buildMonacoWidget('parameter-hints-widget');
    return { show: (): void => undefined, render: (): void => undefined };
  });

  /**
   * Records what the model was asked.
   */
  public readonly asked: string[] = [];

  /**
   * Gets the signature-help model.
   */
  public readonly model: { next(): void; previous(): void } = {
    next: (): void => void this.asked.push('model.next'),
    previous: (): void => void this.asked.push('model.previous'),
  };

  /**
   * Shows signatures, as the model's change event does.
   * @param hints The signatures, or undefined to hide.
   */
  public changed(hints: MonacoApi.languages.SignatureHelp | undefined): void {
    const widget: {
      value: { show(): void; render(hints: unknown): void };
      rawValue?: { hide(): void };
    } = this.widget as never;
    if (hints !== undefined) {
      widget.value.show();
      widget.value.render(hints);
    } else {
      widget.rawValue?.hide();
    }
  }

  /**
   * Ends the session.
   */
  public cancel(): void {
    this.asked.push('cancel');
  }

  /**
   * Starts a session.
   * @param context What started it.
   */
  public trigger(context: { triggerKind: number }): void {
    this.asked.push(`trigger:${context.triggerKind}`);
  }

  /**
   * Shows the next overload, through the widget as Monaco does.
   */
  public next(): void {
    (this.widget as { rawValue?: { next(): void } }).rawValue?.next();
  }

  /**
   * Shows the previous overload, through the widget as Monaco does.
   */
  public previous(): void {
    (this.widget as { rawValue?: { previous(): void } }).rawValue?.previous();
  }

  /**
   * Releases nothing.
   */
  public dispose(): void {
    // Nothing to release.
  }
}

/**
 * What the presenters were asked.
 */
interface Presented {
  readonly calls: string[];
  readonly lists: SuggestList[];
  readonly controls: SuggestControl[];
  readonly hints: { control: ParameterHintsControl; hints: MonacoApi.languages.SignatureHelp }[];
  focused: SuggestItem | undefined;
}

/**
 * A fake editor and its contributions.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly suggest: FakeSuggestController;
  readonly hints: FakeParameterHintsController;
}

/**
 * Builds a fake editor whose contributions are the fakes above.
 * @param focused Whether its text holds the keyboard.
 * @returns Returns the editor and its contributions.
 */
function fakeEditor(focused: boolean = true): FakeEditor {
  const suggest: FakeSuggestController = new FakeSuggestController();
  const hints: FakeParameterHintsController = new FakeParameterHintsController();
  const model: unknown = { uri: { toString: (): string => 'inmemory://1' } };
  const editor: MonacoApi.editor.ICodeEditor = {
    hasTextFocus: (): boolean => focused,
    hasWidgetFocus: (): boolean => focused,
    getModel: (): unknown => model,
    getContribution: (id: string): unknown =>
      id === SUGGEST_CONTRIBUTION ? suggest : id === PARAMETER_HINTS_CONTRIBUTION ? hints : null,
  } as unknown as MonacoApi.editor.ICodeEditor;
  return { editor, suggest, hints };
}

/**
 * What a fake Monaco instance was asked to do.
 */
interface Installed {
  readonly rules: MonacoApi.editor.IKeybindingRule[];
  readonly commands: Map<string, () => void>;
  readonly presented: Presented;
  create(editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Installs the suggest commands into a fake Monaco instance holding the given editors.
 * @param editors The editors the instance holds.
 * @param isMac Whether the host is macOS.
 * @param suppressed Whether a document's word-based suggestions are left out.
 * @returns Returns what the instance was asked to do.
 */
function install(
  editors: readonly MonacoApi.editor.ICodeEditor[],
  isMac: boolean = true,
  suppressed: boolean = false,
): Installed {
  let onCreate: ((editor: MonacoApi.editor.ICodeEditor) => void) | null = null;
  const presented: Presented = {
    calls: [],
    lists: [],
    controls: [],
    hints: [],
    focused: undefined,
  };
  const installed: Installed = {
    rules: [],
    commands: new Map(),
    presented,
    create: (editor: MonacoApi.editor.ICodeEditor): void => onCreate?.(editor),
  };
  const fake: typeof MonacoApi = {
    KeyMod: { CtrlCmd: CTRL_CMD, Shift: SHIFT, Alt: ALT },
    KeyCode: {
      Space: SPACE,
      Escape: ESCAPE,
      KeyI: KEY_I,
      Enter: ENTER,
      Tab: TAB,
      UpArrow: UP,
      DownArrow: DOWN,
      PageUp: PAGE_UP,
      PageDown: PAGE_DOWN,
    },
    editor: {
      getEditors: (): readonly MonacoApi.editor.ICodeEditor[] => editors,
      registerCommand: (id: string, handler: () => void): void =>
        void installed.commands.set(id, handler),
      addKeybindingRules: (rules: MonacoApi.editor.IKeybindingRule[]): void =>
        void installed.rules.push(...rules),
      onDidCreateEditor: (listener: (editor: MonacoApi.editor.ICodeEditor) => void): void => {
        onCreate = listener;
      },
    },
  } as unknown as typeof MonacoApi;
  const suggest: SuggestPresenter = {
    triggered: (_editor: unknown, control: SuggestControl, auto: boolean, delay: number): void => {
      presented.controls.push(control);
      presented.calls.push(`triggered:${auto}:${delay}`);
    },
    suggestions: (_editor: unknown, control: SuggestControl, list: SuggestList): void => {
      presented.controls.push(control);
      presented.lists.push(list);
      presented.calls.push('suggestions');
    },
    hidden: (): void => void presented.calls.push('hidden'),
    focusedItem: (): SuggestItem | undefined => presented.focused,
    move: (_editor: unknown, move: SuggestMove): void => void presented.calls.push(`move:${move}`),
    accept: (): void => void presented.calls.push('accept'),
  };
  const hints: ParameterHintsPresenter = {
    showSignatures: (
      _editor: unknown,
      control: ParameterHintsControl,
      value: MonacoApi.languages.SignatureHelp,
    ): void => void presented.hints.push({ control, hints: value }),
    hideSignatures: (): void => void presented.calls.push('hideSignatures'),
  };
  installSuggestCommands(
    fake,
    isMac,
    (): SuggestPresenter => suggest,
    (): ParameterHintsPresenter => hints,
    (): boolean => suppressed,
  );
  return installed;
}

/**
 * Builds a completion of a provider.
 * @param label The label.
 * @param provider The provider's debug name.
 * @returns Returns the completion.
 */
function item(label: string, provider: string = 'lsp'): SuggestItem {
  return {
    completion: { label } as MonacoApi.languages.CompletionItem,
    textLabel: label,
    score: [0, 0],
    provider: { _debugDisplayName: provider },
    isResolved: true,
    resolve: (): Promise<void> => Promise.resolve(),
  };
}

/**
 * Lets the fake idle values' "window idle" pass.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function idle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 5);
  });
}

/**
 * Counts Monaco's suggest and parameter-hints elements in the page.
 * @returns Returns how many there are.
 */
function monacoWidgets(): number {
  return document.querySelectorAll('.suggest-widget, .parameter-hints-widget').length;
}

describe('installSuggestCommands (#1021)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('removesMonacosTriggerChords_andBindsStudios_onMacOS', () => {
    const installed: Installed = install([], true);
    const list: string = 'studioSuggestVisible && !studioEditorComposing';
    const accept: string = `${list} && studioSuggestFocused`;
    const card: string =
      'studioParameterHintsVisible && !studioSuggestVisible && !studioEditorComposing';
    const overloads: string = `${card} && studioParameterHintsMultiple`;
    const trigger: string = 'editorTextFocus && !editorReadonly';

    expect(installed.rules).toEqual([
      { keybinding: 0, command: '-editor.action.triggerSuggest' },
      { keybinding: 0, command: '-editor.action.triggerParameterHints' },
      { keybinding: WIN_CTRL | SPACE, command: STUDIO_TRIGGER_SUGGEST_COMMAND, when: trigger },
      { keybinding: ALT | ESCAPE, command: STUDIO_TRIGGER_SUGGEST_COMMAND, when: trigger },
      { keybinding: CTRL_CMD | KEY_I, command: STUDIO_TRIGGER_SUGGEST_COMMAND, when: trigger },
      {
        keybinding: CTRL_CMD | SHIFT | SPACE,
        command: STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND,
        when: 'editorTextFocus',
      },
      { keybinding: DOWN, command: STUDIO_SUGGEST_NEXT_COMMAND, when: list },
      { keybinding: UP, command: STUDIO_SUGGEST_PREVIOUS_COMMAND, when: list },
      { keybinding: PAGE_DOWN, command: STUDIO_SUGGEST_NEXT_PAGE_COMMAND, when: list },
      { keybinding: PAGE_UP, command: STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND, when: list },
      { keybinding: ENTER, command: STUDIO_SUGGEST_ACCEPT_COMMAND, when: accept },
      { keybinding: TAB, command: STUDIO_SUGGEST_ACCEPT_COMMAND, when: accept },
      { keybinding: ESCAPE, command: STUDIO_SUGGEST_HIDE_COMMAND, when: list },
      { keybinding: SHIFT | ESCAPE, command: STUDIO_SUGGEST_HIDE_COMMAND, when: list },
      { keybinding: DOWN, command: STUDIO_PARAMETER_HINTS_NEXT_COMMAND, when: overloads },
      { keybinding: ALT | DOWN, command: STUDIO_PARAMETER_HINTS_NEXT_COMMAND, when: overloads },
      { keybinding: UP, command: STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND, when: overloads },
      { keybinding: ALT | UP, command: STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND, when: overloads },
      { keybinding: ESCAPE, command: STUDIO_PARAMETER_HINTS_HIDE_COMMAND, when: card },
      { keybinding: SHIFT | ESCAPE, command: STUDIO_PARAMETER_HINTS_HIDE_COMMAND, when: card },
    ]);
  });

  it('bindsCtrlSpaceAndCtrlI_elsewhere', () => {
    const installed: Installed = install([], false);

    expect(
      installed.rules
        .filter(
          (rule: MonacoApi.editor.IKeybindingRule): boolean =>
            rule.command === STUDIO_TRIGGER_SUGGEST_COMMAND,
        )
        .map((rule: MonacoApi.editor.IKeybindingRule): number => rule.keybinding),
    ).toEqual([CTRL_CMD | SPACE, CTRL_CMD | KEY_I]);
  });

  it('studiosCommands_runInTheFocusedEditor_throughItsContributionsAndThePresenter', () => {
    const other: FakeEditor = fakeEditor(false);
    const focused: FakeEditor = fakeEditor(true);
    const installed: Installed = install([other.editor, focused.editor]);
    installed.create(other.editor);
    installed.create(focused.editor);

    for (const command of [
      STUDIO_TRIGGER_SUGGEST_COMMAND,
      STUDIO_SUGGEST_NEXT_COMMAND,
      STUDIO_SUGGEST_PREVIOUS_COMMAND,
      STUDIO_SUGGEST_NEXT_PAGE_COMMAND,
      STUDIO_SUGGEST_PREVIOUS_PAGE_COMMAND,
      STUDIO_SUGGEST_ACCEPT_COMMAND,
      STUDIO_SUGGEST_HIDE_COMMAND,
      STUDIO_TRIGGER_PARAMETER_HINTS_COMMAND,
      STUDIO_PARAMETER_HINTS_HIDE_COMMAND,
    ]) {
      installed.commands.get(command)?.();
    }

    expect(focused.suggest.triggered).toBe(1);
    expect(focused.suggest.cancelled).toBe(1);
    expect(other.suggest.triggered).toBe(0);
    expect(installed.presented.calls).toEqual([
      'move:next',
      'move:previous',
      'move:nextPage',
      'move:previousPage',
      'accept',
      // Escape cancels Monaco's session, which hides the list.
      'hidden',
    ]);
    // Invoke: SignatureHelpTriggerKind 1.
    expect(focused.hints.asked).toEqual(['trigger:1', 'cancel']);
  });

  it('stopsTheIdleBuildOfMonacosSuggestWidget_andNeverBuildsEitherWidget', async () => {
    const editor: FakeEditor = fakeEditor();
    const idleValue: FakeIdleValue = editor.suggest.widget as FakeIdleValue;
    const installed: Installed = install([editor.editor]);

    installed.create(editor.editor);
    await idle();
    // Every way Monaco reaches its widgets.
    editor.suggest.value['showTriggered'](false, 50);
    editor.suggest.value['showSuggestions']({ items: [item('a')] }, 0, false, false, false);
    editor.suggest.value['getFocusedItem']();
    editor.suggest.value['hideWidget']();
    editor.hints.changed({ signatures: [], activeSignature: 0, activeParameter: 0 });
    editor.hints.changed(undefined);
    editor.hints.next();
    editor.hints.previous();
    await idle();

    expect(idleValue.disposed).toBe(true);
    expect(monacoWidgets()).toBe(0);
  });

  it('withoutTheTakeover_theFakesWouldBuildMonacosWidgets', async () => {
    // The control for the spec above: the stand-ins really do build DOM if nothing replaces them.
    const editor: FakeEditor = fakeEditor();

    await idle();
    editor.hints.changed({ signatures: [], activeSignature: 0, activeParameter: 0 });

    expect(monacoWidgets()).toBe(2);
  });

  it('handsMonacosSuggestSession_toThePresenter', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor]);
    installed.create(editor.editor);
    const first: SuggestItem = item('first');
    const second: SuggestItem = item('second');

    editor.suggest.value['showTriggered'](false, 50);
    editor.suggest.value['showSuggestions']({ items: [first, second] }, 1, false, true, false);
    editor.suggest.value['hideWidget']();

    expect(installed.presented.calls).toEqual(['triggered:false:50', 'suggestions', 'hidden']);
    expect(installed.presented.lists[0]).toEqual({
      items: [first, second],
      selected: second,
      frozen: false,
      auto: true,
      noFocus: false,
    });
  });

  it('leavesWordBasedSuggestionsOut_whenTheDocumentSaysSo', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor], true, true);
    installed.create(editor.editor);
    const words: SuggestItem = item('word', WORD_BASED_PROVIDER_NAME);
    const server: SuggestItem = item('server');

    editor.suggest.value['showSuggestions']({ items: [words, server] }, 0, false, true, false);

    // Monaco's choice was a word, which is gone: the first item left is focused instead.
    expect(installed.presented.lists[0].items).toEqual([server]);
    expect(installed.presented.lists[0].selected).toBe(server);
  });

  it('keepsWordBasedSuggestions_otherwise', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor]);
    installed.create(editor.editor);
    const words: SuggestItem = item('word', WORD_BASED_PROVIDER_NAME);

    editor.suggest.value['showSuggestions']({ items: [words] }, 0, false, true, false);

    expect(installed.presented.lists[0].items).toEqual([words]);
  });

  it('insertsThroughMonacosOwnInsertion_withTheFlagsOfHowItWasAccepted', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor]);
    installed.create(editor.editor);
    const first: SuggestItem = item('first');
    const second: SuggestItem = item('second');
    editor.suggest.value['showSuggestions']({ items: [first, second] }, 0, false, true, false);
    const control: SuggestControl = installed.presented.controls[0];

    control.insert(second, 'select');
    control.insert(first, 'commit');
    control.insert(item('not listed'), 'select');

    expect(editor.suggest.inserted.map((entry) => [entry.event.index, entry.flags])).toEqual([
      // InsertFlags.None, as Monaco's own list accepts.
      [1, 0],
      // InsertFlags.NoAfterUndoStop: the commit character joins the completion's undo step.
      [0, 2],
    ]);
  });

  it('answersMonacosQuestions_aboutTheFocusedItemAndTheSession', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor]);
    installed.create(editor.editor);
    const first: SuggestItem = item('first');
    const second: SuggestItem = item('second');
    const focusEvents: SuggestItem[] = [];
    (
      editor.suggest.value['onDidFocus'] as (
        listener: (event: { item: SuggestItem }) => void,
      ) => unknown
    )((event: { item: SuggestItem }): void => void focusEvents.push(event.item));
    editor.suggest.value['showSuggestions']({ items: [first, second] }, 0, true, true, false);
    installed.presented.focused = second;
    const control: SuggestControl = installed.presented.controls[0];

    expect(editor.suggest.value['getFocusedItem']()).toEqual({
      item: second,
      index: 1,
      model: { items: [first, second] },
    });
    expect(editor.suggest.value['isFrozen']()).toBe(true);
    expect(control.active).toBe(false);
    editor.suggest.model.state = 1;
    expect(control.active).toBe(true);
    control.focused(second);
    expect(focusEvents).toEqual([second]);
  });

  it('handsMonacosSignatures_toThePresenter_andItsOverloadButtons_toTheModel', () => {
    const editor: FakeEditor = fakeEditor();
    const installed: Installed = install([editor.editor]);
    installed.create(editor.editor);
    const hints: MonacoApi.languages.SignatureHelp = {
      signatures: [{ label: 'f(a)', parameters: [{ label: 'a' }] }],
      activeSignature: 0,
      activeParameter: 0,
    };

    editor.hints.changed(hints);
    installed.presented.hints[0].control.next();
    installed.presented.hints[0].control.previous();
    installed.presented.hints[0].control.cancel();
    installed.commands.get(STUDIO_PARAMETER_HINTS_NEXT_COMMAND)?.();
    installed.commands.get(STUDIO_PARAMETER_HINTS_PREVIOUS_COMMAND)?.();
    editor.hints.changed(undefined);

    expect(installed.presented.hints[0].hints).toBe(hints);
    expect(editor.hints.asked).toEqual([
      'model.next',
      'model.previous',
      'cancel',
      'model.next',
      'model.previous',
    ]);
    expect(installed.presented.calls).toEqual(['hideSignatures']);
  });

  it('anEditorWithoutTheContributions_isLeftAlone', () => {
    const installed: Installed = install([]);
    const editor: MonacoApi.editor.ICodeEditor = {
      getContribution: (): null => null,
    } as unknown as MonacoApi.editor.ICodeEditor;

    expect((): void => installed.create(editor)).not.toThrow();
  });
});
