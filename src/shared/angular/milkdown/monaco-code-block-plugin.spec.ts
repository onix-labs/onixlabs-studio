import { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { drainMilkdownTimers } from '../testing/drain-milkdown-timers';
import { createMonacoCodeBlockPlugin, MonacoCodeBlockDeps } from './monaco-code-block-plugin';

/**
 * Builds fake Monaco services for the node view: Monaco never "loads", so the view stays on its
 * placeholder path and never constructs a real editor (which jsdom could not host anyway).
 * @returns Returns the fake dependencies.
 */
function fakeDeps(): MonacoCodeBlockDeps {
  return {
    monaco: {
      ensureLoadedIn: (): Promise<never> => Promise.reject(new Error('No Monaco in jsdom.')),
      getEditorOptions: (): object => ({}),
      getThemeName: (): string => 'onix-dark-outline',
    } as unknown as MonacoCodeBlockDeps['monaco'],
    highlighter: {
      colorize: (): Promise<string> => Promise.resolve(''),
      resolveLanguageId: (): string => 'plaintext',
    } as unknown as MonacoCodeBlockDeps['highlighter'],
  };
}

/**
 * A disposable listener registration.
 */
class Registration {
  public disposed: boolean = false;

  public constructor(private readonly clear: () => void) {}

  public dispose(): void {
    this.disposed = true;
    this.clear();
  }
}

/**
 * A place in a model.
 */
class FakePosition {
  public constructor(
    public readonly offset: number,
    public readonly lineNumber: number,
  ) {}
}

/**
 * A text model holding a plain string.
 */
class FakeModel {
  public disposed: boolean = false;

  public constructor(
    public value: string,
    public language: string,
  ) {}

  public getValue(): string {
    return this.value;
  }

  public getValueLength(): number {
    return this.value.length;
  }

  public getLineCount(): number {
    return this.value.split('\n').length;
  }

  public getPositionAt(offset: number): FakePosition {
    return new FakePosition(offset, this.value.slice(0, offset).split('\n').length);
  }

  public getOffsetAt(position: FakePosition): number {
    return position.offset;
  }

  public applyEdits(edits: readonly FakeEdit[]): void {
    for (const edit of edits) {
      this.value =
        this.value.slice(0, edit.range.from) + edit.text + this.value.slice(edit.range.to);
    }
  }

  public dispose(): void {
    this.disposed = true;
  }
}

/**
 * The range of an edit.
 */
interface FakeRange {
  readonly from: number;
  readonly to: number;
}

/**
 * An edit a fence applies to its model.
 */
interface FakeEdit {
  readonly range: FakeRange;
  readonly text: string;
}

/**
 * A caret or selection, whose positions are offsets.
 */
class FakeSelection {
  public model: FakeModel = new FakeModel('', '');

  public constructor(
    public readonly start: number,
    public readonly end: number,
  ) {}

  public isEmpty(): boolean {
    return this.start === this.end;
  }

  public getStartPosition(): FakePosition {
    return this.model.getPositionAt(this.start);
  }

  public getEndPosition(): FakePosition {
    return this.model.getPositionAt(this.end);
  }
}

/**
 * The key a fence's editor reports, as far as a fence reads it.
 */
interface FakeKey {
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly preventDefault: () => void;
  readonly stopPropagation: () => void;
}

/**
 * The key codes the fence switches on.
 */
const keyCodes: Readonly<Record<string, number>> = {
  UpArrow: 1,
  DownArrow: 2,
  LeftArrow: 3,
  RightArrow: 4,
  Enter: 5,
  Backspace: 6,
  Escape: 7,
};

/**
 * A standalone editor that renders a textarea, so focus is real and everything else is scripted.
 */
class FakeEditor {
  public selection: FakeSelection = new FakeSelection(0, 0);
  public disposed: boolean = false;
  public laidOutHeight: number = 0;
  public contentHeight: number = 10;
  public contextKeys: string[] = [];
  public changeListener: ((event: FakeChange) => void) | null = null;
  public blurListener: (() => void) | null = null;
  public sizeListener: (() => void) | null = null;
  public keyListener: ((event: FakeKey) => void) | null = null;
  public readonly surface: HTMLTextAreaElement;

  public constructor(
    private readonly host: HTMLElement,
    public readonly model: FakeModel,
  ) {
    this.surface = host.appendChild(host.ownerDocument.createElement('textarea'));
  }

  public getModel(): FakeModel {
    return this.model;
  }

  public getSelection(): FakeSelection {
    this.selection.model = this.model;
    return this.selection;
  }

  public setSelection(range: FakeRange): void {
    this.selection = new FakeSelection(range.from, range.to);
  }

  public focus(): void {
    this.surface.focus();
  }

  public getContentHeight(): number {
    return this.contentHeight;
  }

  public getContainerDomNode(): HTMLElement {
    return this.host;
  }

  public layout(size: { width: number; height: number }): void {
    this.laidOutHeight = size.height;
  }

  public createContextKey(key: string): void {
    this.contextKeys.push(key);
  }

  public onDidChangeModelContent(listener: (event: FakeChange) => void): Registration {
    this.changeListener = listener;
    return new Registration((): void => {
      this.changeListener = null;
    });
  }

  public onDidContentSizeChange(listener: () => void): Registration {
    this.sizeListener = listener;
    return new Registration((): void => {
      this.sizeListener = null;
    });
  }

  public onDidBlurEditorWidget(listener: () => void): Registration {
    this.blurListener = listener;
    return new Registration((): void => {
      this.blurListener = null;
    });
  }

  public onKeyDown(listener: (event: FakeKey) => void): Registration {
    this.keyListener = listener;
    return new Registration((): void => {
      this.keyListener = null;
    });
  }

  public dispose(): void {
    this.disposed = true;
  }

  /**
   * Types over a range, as Monaco reports it.
   */
  public type(offset: number, length: number, text: string): void {
    this.model.applyEdits([{ range: { from: offset, to: offset + length }, text }]);
    this.changeListener?.({ changes: [{ rangeOffset: offset, rangeLength: length, text }] });
  }

  /**
   * Presses a key, resolving whether the fence consumed it.
   */
  public press(key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}): boolean {
    let consumed: boolean = false;
    this.keyListener?.({
      keyCode: keyCodes[key] ?? 0,
      ctrlKey: modifiers.ctrlKey === true,
      metaKey: modifiers.metaKey === true,
      preventDefault: (): void => {
        consumed = true;
      },
      stopPropagation: (): void => undefined,
    });
    return consumed;
  }
}

/**
 * A content change, as far as a fence reads it.
 */
interface FakeChange {
  readonly changes: readonly {
    readonly rangeOffset: number;
    readonly rangeLength: number;
    readonly text: string;
  }[];
}

/**
 * The slice of the Monaco API a fence uses.
 */
class FakeMonacoApi {
  public readonly KeyCode: Readonly<Record<string, number>> = keyCodes;
  public readonly models: FakeModel[] = [];
  public readonly editors: FakeEditor[] = [];
  public createFails: boolean = false;
  public readonly Range: {
    fromPositions: (from: FakePosition, to: FakePosition) => FakeRange;
  } = {
    fromPositions: (from: FakePosition, to: FakePosition): FakeRange => ({
      from: from.offset,
      to: to.offset,
    }),
  };

  public readonly editor: {
    createModel: (value: string, language: string) => FakeModel;
    create: (host: HTMLElement, options: { model: FakeModel }) => FakeEditor;
    setModelLanguage: (model: FakeModel, language: string) => void;
  } = {
    createModel: (value: string, language: string): FakeModel => {
      const model: FakeModel = new FakeModel(value, language);
      this.models.push(model);
      return model;
    },
    create: (host: HTMLElement, options: { model: FakeModel }): FakeEditor => {
      if (this.createFails) {
        throw new Error('Monaco cannot host an editor here');
      }
      const editor: FakeEditor = new FakeEditor(host, options.model);
      this.editors.push(editor);
      return editor;
    },
    setModelLanguage: (model: FakeModel, language: string): void => {
      model.language = language;
    },
  };
}

/**
 * Builds the dependencies around a fake Monaco.
 */
function liveDeps(
  api: FakeMonacoApi,
  overrides: Partial<MonacoCodeBlockDeps> = {},
  colorize: (code: string) => Promise<string> = (): Promise<string> => Promise.resolve(''),
  load: () => Promise<FakeMonacoApi> = (): Promise<FakeMonacoApi> => Promise.resolve(api),
): MonacoCodeBlockDeps {
  return {
    monaco: {
      ensureLoadedIn: load,
      getEditorOptions: (): object => ({ fontFamily: 'Fixture Mono', fontSize: 13 }),
    } as unknown as MonacoCodeBlockDeps['monaco'],
    highlighter: {
      colorize,
      resolveLanguageId: (language: string): string => (language === '' ? 'plaintext' : language),
    } as unknown as MonacoCodeBlockDeps['highlighter'],
    ...overrides,
  };
}

describe('MonacoCodeBlock node view', () => {
  let root: HTMLDivElement;
  let editor: Editor | null;
  let view: EditorView;
  let api: FakeMonacoApi;

  /**
   * Creates a real editor with the plugin over the given markdown.
   */
  async function boot(
    markdown: string,
    deps: MonacoCodeBlockDeps = liveDeps(api),
    editable: boolean = true,
  ): Promise<void> {
    root = document.body.appendChild(document.createElement('div'));
    editor = await Editor.make()
      .config((ctx: Ctx): void => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, markdown);
      })
      .use(commonmark)
      .use(createMonacoCodeBlockPlugin(deps))
      .create();
    view = editor.action((ctx: Ctx): EditorView => ctx.get(editorViewCtx));
    if (!editable) {
      view.setProps({ editable: (): boolean => false });
    }
  }

  /**
   * Gets a part of the (first) fence.
   */
  function part(selector: string): HTMLElement {
    const found: HTMLElement | null = root.querySelector<HTMLElement>(selector);
    if (found === null) {
      throw new Error(`No ${selector} in the fence`);
    }
    return found;
  }

  /**
   * Presses the fence's code area, which is how a mouse user enters it.
   */
  async function enterFence(): Promise<FakeEditor> {
    part('.milkdown-monaco-code-block__body').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor((): void => {
      expect(api.editors.length).toBeGreaterThan(0);
    });
    const live: FakeEditor | undefined = api.editors[api.editors.length - 1];
    if (live === undefined) {
      throw new Error('The fence did not mount an editor');
    }
    return live;
  }

  /**
   * Finds the position of the first fence.
   */
  function fencePosition(): number {
    let position: number = -1;
    view.state.doc.forEach((node: { type: { name: string } }, offset: number): void => {
      if (position === -1 && node.type.name === 'code_block') {
        position = offset;
      }
    });
    return position;
  }

  /**
   * Lets a teardown delay run out.
   */
  function afterTeardownDelay(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 200);
    });
  }

  /**
   * Types in the language field and commits it the given way.
   */
  function setLanguageField(language: string): HTMLInputElement {
    const field: HTMLElement = part('.milkdown-monaco-code-block__language');
    if (!(field instanceof HTMLInputElement)) {
      throw new Error('The language field is not an input');
    }
    field.value = language;
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field;
  }

  beforeAll((): void => {
    // jsdom's Range has no geometry, which ProseMirror asks for when it scrolls a selection in.
    Object.assign(Range.prototype, {
      getClientRects: (): DOMRectList => [] as unknown as DOMRectList,
      getBoundingClientRect: (): DOMRect => new DOMRect(0, 0, 0, 0),
    });
    Object.assign(Text.prototype, {
      getClientRects: (): DOMRectList => [] as unknown as DOMRectList,
    });
  });

  beforeEach((): void => {
    api = new FakeMonacoApi();
    editor = null;
  });

  afterEach(async (): Promise<void> => {
    await editor?.destroy();
    root.remove();
  });

  afterAll(drainMilkdownTimers);

  describe('the idle fence', () => {
    it('placeholder_escapesTheCode_untilItIsColourised', async () => {
      await boot('```html\n<b>&</b>\n```\n');

      expect(part('.milkdown-monaco-code-block__placeholder code').innerHTML).toBe(
        '&lt;b&gt;&amp;&lt;/b&gt;',
      );
      expect(part('.milkdown-monaco-code-block__placeholder').style.fontFamily).toContain(
        'Fixture Mono',
      );
      expect(part('.milkdown-monaco-code-block__placeholder').style.fontSize).toBe('13px');
    });

    it('placeholder_takesTheColourisedHtmlWhenItArrives', async () => {
      await boot(
        '```ts\nconst a;\n```\n',
        liveDeps(api, {}, (): Promise<string> => Promise.resolve('<span class="k">const</span>')),
      );

      await vi.waitFor((): void => {
        expect(part('.milkdown-monaco-code-block__placeholder code .k').textContent).toBe('const');
      });
    });

    it('placeholder_keepsThePlainCode_whenColourisingFails', async () => {
      await boot(
        '```ts\nconst a;\n```\n',
        liveDeps(api, {}, (): Promise<string> => Promise.reject(new Error('no grammar'))),
      );
      await Promise.resolve();

      expect(part('.milkdown-monaco-code-block__placeholder code').textContent).toBe('const a;');
    });

    it('placeholder_ignoresASlowColouringOfOlderCode', async () => {
      const finishes: ((html: string) => void)[] = [];
      await boot(
        '```ts\nold\n```\n',
        liveDeps(
          api,
          {},
          (): Promise<string> =>
            new Promise<string>((resolve: (html: string) => void): void => {
              finishes.push(resolve);
            }),
        ),
      );
      view.dispatch(view.state.tr.insertText('new ', fencePosition() + 1));

      finishes[0]?.('<i>stale</i>');
      await Promise.resolve();
      await Promise.resolve();

      expect(part('.milkdown-monaco-code-block__placeholder code').textContent).toBe('new old');
    });

    it('placeholder_numbersEachLine_whenFencesNumberLines', async () => {
      await boot('```ts\none\ntwo\n```\n', liveDeps(api, { lineNumbers: true }));

      expect(root.querySelectorAll('.milkdown-monaco-code-block__line')).toHaveLength(2);
    });

    it('placeholder_numbersColourisedLines_withoutATrailingEmptyOne', async () => {
      await boot(
        '```ts\none\ntwo\n```\n',
        liveDeps(api, { lineNumbers: true }, (): Promise<string> =>
          Promise.resolve('<i>one</i><br/><i>two</i><br/>'),
        ),
      );

      await vi.waitFor((): void => {
        expect(root.querySelectorAll('.milkdown-monaco-code-block__line i')).toHaveLength(2);
      });
      expect(root.querySelectorAll('.milkdown-monaco-code-block__line')).toHaveLength(2);
    });

    it('mathFence_showsItsEquation_whenPreviewsAreOn', async () => {
      await boot('```latex\nx^2\n```\n', liveDeps(api, { mathPreview: true }));

      await vi.waitFor((): void => {
        expect(root.querySelector('.milkdown-monaco-code-block__equation .katex')).not.toBeNull();
      });
    });

    it('mathFence_emptyOrWithPreviewsOff_showsItsSource', async () => {
      await boot('```latex\nx^2\n```\n');

      expect(part('.milkdown-monaco-code-block__placeholder code').textContent).toBe('x^2');
    });
  });

  describe('entering a fence', () => {
    it('pressingTheCode_mountsALiveEditorOverThePlaceholderAndFocusesIt', async () => {
      await boot('```ts\nconst a = 1;\n```\n');

      const live: FakeEditor = await enterFence();

      expect(root.querySelector('.milkdown-monaco-code-block__placeholder')).toBeNull();
      expect(live.model.value).toBe('const a = 1;');
      expect(live.model.language).toBe('ts');
      expect(document.activeElement).toBe(live.surface);
      expect(live.contextKeys).toHaveLength(1);
    });

    it('readOnlyDocument_staysAStaticBlock', async () => {
      await boot('```ts\nconst a = 1;\n```\n', liveDeps(api), false);

      part('.milkdown-monaco-code-block__body').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();

      expect(api.editors).toEqual([]);
      expect(root.querySelector('.milkdown-monaco-code-block__placeholder')).not.toBeNull();
    });

    it('twoTriggers_whileMonacoLoads_mountOneEditor', async () => {
      await boot('```ts\ncode\n```\n');
      const body: HTMLElement = part('.milkdown-monaco-code-block__body');

      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await vi.waitFor((): void => {
        expect(api.editors).toHaveLength(1);
      });

      expect(api.models).toHaveLength(1);
    });

    it('monacoFailingToLoad_leavesThePlaceholderAndCanBeRetried', async () => {
      let failing: boolean = true;
      await boot(
        '```ts\ncode\n```\n',
        liveDeps(api, {}, undefined, (): Promise<FakeMonacoApi> =>
          failing ? Promise.reject(new Error('offline')) : Promise.resolve(api),
        ),
      );
      const body: HTMLElement = part('.milkdown-monaco-code-block__body');
      body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await afterTeardownDelay();
      expect(root.querySelector('.milkdown-monaco-code-block__placeholder')).not.toBeNull();

      failing = false;
      await enterFence();

      expect(root.querySelector('.milkdown-monaco-code-block__placeholder')).toBeNull();
    });

    it('editorCreationFailing_restoresThePlaceholderAndLeavesNoModelBehind', async () => {
      api.createFails = true;
      await boot('```ts\ncode\n```\n');

      part('.milkdown-monaco-code-block__body').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor((): void => {
        expect(api.models).toHaveLength(1);
      });
      await Promise.resolve();

      expect(part('.milkdown-monaco-code-block__placeholder code').textContent).toBe('code');
      expect(api.models[0]?.disposed).toBe(true);
    });

    it('editorDestroyed_whileMonacoLoads_buildsNothing', async () => {
      let finishLoad: (loaded: FakeMonacoApi) => void = (): void => undefined;
      await boot(
        '```ts\ncode\n```\n',
        liveDeps(
          api,
          {},
          undefined,
          (): Promise<FakeMonacoApi> =>
            new Promise<FakeMonacoApi>((resolve: (loaded: FakeMonacoApi) => void): void => {
              finishLoad = resolve;
            }),
        ),
      );
      part('.milkdown-monaco-code-block__body').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );

      await editor?.destroy();
      editor = null;
      finishLoad(api);
      await afterTeardownDelay();

      expect(api.editors).toEqual([]);
      expect(api.models).toEqual([]);
    });

    it('selectionCarriedIn_placesTheCaretInTheEditor', async () => {
      await boot('```ts\nabcdef\n```\n');
      const inside: number = fencePosition() + 3;

      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, inside, inside + 2)),
      );
      view.focus();
      await vi.waitFor((): void => {
        expect(api.editors).toHaveLength(1);
      });
      await Promise.resolve();

      expect(api.editors[0]?.selection.start).toBe(2);
      expect(api.editors[0]?.selection.end).toBe(4);
    });
  });

  describe('editing in a fence', () => {
    it('typing_reachesTheDocument', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      live.selection = new FakeSelection(2, 2);
      live.type(1, 0, 'Z');

      expect(view.state.doc.child(0).textContent).toBe('aZbc');
    });

    it('deleting_reachesTheDocument', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      live.type(0, 2, '');

      expect(view.state.doc.child(0).textContent).toBe('c');
    });

    it('anEditWhileUnfocused_isNotAUserEdit', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.surface.blur();

      live.type(0, 0, 'Z');

      expect(view.state.doc.child(0).textContent).toBe('abc');
    });

    it('externalChange_reachesTheEditorAsAMinimalEdit_withoutEchoing', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      const edits: FakeEdit[][] = [];
      const apply: FakeModel['applyEdits'] = live.model.applyEdits.bind(live.model);
      live.model.applyEdits = (next: readonly FakeEdit[]): void => {
        edits.push([...next]);
        apply(next);
      };

      view.dispatch(view.state.tr.insertText('Z', fencePosition() + 2));

      expect(live.model.value).toBe('aZbc');
      expect(edits).toEqual([[{ range: { from: 1, to: 1 }, text: 'Z' }]]);
    });

    it('identicalUpdate_touchesNothing', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      let edits: number = 0;
      live.model.applyEdits = (): void => {
        edits += 1;
      };

      view.dispatch(view.state.tr.setNodeAttribute(fencePosition(), 'language', 'ts'));

      expect(edits).toBe(0);
    });

    it('languageChange_inTheField_recordsItAndRetunesTheEditor', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      setLanguageField('python');

      expect(view.state.doc.child(0).attrs['language']).toBe('python');
      expect(live.model.language).toBe('python');
    });

    it('languageEnter_commitsAndLeavesTheField', async () => {
      await boot('```ts\nabc\n```\n');
      const field: HTMLElement = part('.milkdown-monaco-code-block__language');
      if (!(field instanceof HTMLInputElement)) {
        throw new Error('The language field is not an input');
      }
      field.focus();
      field.value = 'rust';

      const enter: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enter);

      expect(view.state.doc.child(0).attrs['language']).toBe('rust');
      expect(enter.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(field);
    });

    it('languageField_followsTheDocument_unlessBeingTypedIn', async () => {
      await boot('```ts\nabc\n```\n');
      const field: HTMLElement = part('.milkdown-monaco-code-block__language');
      if (!(field instanceof HTMLInputElement)) {
        throw new Error('The language field is not an input');
      }

      view.dispatch(view.state.tr.setNodeAttribute(fencePosition(), 'language', 'go'));
      expect(field.value).toBe('go');

      field.focus();
      field.value = 'ru';
      view.dispatch(view.state.tr.setNodeAttribute(fencePosition(), 'language', 'c'));
      expect(field.value).toBe('ru');
    });

    it('languageField_inAReadOnlyDocument_doesNotChangeIt', async () => {
      await boot('```ts\nabc\n```\n', liveDeps(api), false);

      const field: HTMLInputElement = setLanguageField('python');

      expect(view.state.doc.child(0).attrs['language']).toBe('ts');
      expect(field.value).toBe('ts');
    });

    it('resizing_growsTheFenceToItsContent_withAComfortableMinimum', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      expect(live.laidOutHeight).toBe(32);

      live.contentHeight = 300;
      live.sizeListener?.();

      expect(live.laidOutHeight).toBe(300);
      expect(live.getContainerDomNode().style.height).toBe('300px');
    });
  });

  describe('leaving a fence', () => {
    it('blur_tearsTheEditorBackDownToThePlaceholder_withTheEditedCode', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.selection = new FakeSelection(1, 1);
      live.type(0, 0, 'Z');
      live.surface.blur();

      live.blurListener?.();
      await afterTeardownDelay();

      expect(live.disposed).toBe(true);
      expect(live.model.disposed).toBe(true);
      expect(live.changeListener).toBeNull();
      expect(part('.milkdown-monaco-code-block__placeholder code').textContent).toBe('Zabc');
    });

    it('blur_toTheLanguageField_keepsTheEditor', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      part('.milkdown-monaco-code-block__language').focus();

      live.blurListener?.();
      await afterTeardownDelay();

      expect(live.disposed).toBe(false);
    });

    it('reentering_beforeTheTeardown_keepsTheEditor', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.surface.blur();
      live.blurListener?.();

      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, fencePosition())),
      );
      await afterTeardownDelay();

      expect(live.disposed).toBe(false);
    });

    it('editorDestroyed_withATeardownPending_disposesOnceAndStaysQuiet', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.surface.blur();
      live.blurListener?.();

      await editor?.destroy();
      editor = null;
      await afterTeardownDelay();

      expect(live.disposed).toBe(true);
      expect(live.model.disposed).toBe(true);
    });

    it('arrowUp_atTheFirstLine_stepsOutBeforeTheFence', async () => {
      await boot('before\n\n```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      const consumed: boolean = live.press('UpArrow');

      expect(consumed).toBe(true);
      expect(view.state.selection.$from.parent.textContent).toBe('before');
    });

    it('arrowDown_atTheLastLine_stepsOutAfterTheFence', async () => {
      await boot('```ts\nabc\n```\n\nafter\n');
      const live: FakeEditor = await enterFence();

      const consumed: boolean = live.press('DownArrow');

      expect(consumed).toBe(true);
      expect(view.state.selection.$from.parent.textContent).toBe('after');
    });

    it('arrowDown_onAnEarlierLine_staysInTheFence', async () => {
      await boot('```ts\none\ntwo\n```\n\nafter\n');
      const live: FakeEditor = await enterFence();

      expect(live.press('DownArrow')).toBe(false);
    });

    it('arrowLeft_atTheVeryStart_stepsOut_butNotFromInsideTheCode', async () => {
      await boot('before\n\n```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.selection = new FakeSelection(1, 1);
      expect(live.press('LeftArrow')).toBe(false);

      live.selection = new FakeSelection(0, 0);

      expect(live.press('LeftArrow')).toBe(true);
    });

    it('arrowRight_atTheVeryEnd_stepsOut', async () => {
      await boot('```ts\nabc\n```\n\nafter\n');
      const live: FakeEditor = await enterFence();
      live.selection = new FakeSelection(3, 3);

      expect(live.press('RightArrow')).toBe(true);
    });

    it('arrows_withARangeSelected_stayInTheFence', async () => {
      await boot('before\n\n```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();
      live.selection = new FakeSelection(0, 2);

      expect(live.press('UpArrow')).toBe(false);
    });

    it('arrows_whileTheCompletionListShows_belongToTheList', async () => {
      await boot(
        'before\n\n```ts\nabc\n```\n',
        liveDeps(api, {
          assist: {
            attach: (): (() => void) => (): void => undefined,
            showing: (): boolean => true,
          },
        }),
      );
      const live: FakeEditor = await enterFence();

      expect(live.press('UpArrow')).toBe(false);
      expect(live.press('DownArrow')).toBe(false);
    });

    it('modEnter_exitsAfterTheFence_plainEnterDoesNot', async () => {
      await boot('```ts\nabc\n```\n\nafter\n');
      const live: FakeEditor = await enterFence();

      expect(live.press('Enter')).toBe(false);
      expect(live.press('Enter', { metaKey: true })).toBe(true);
      expect(view.state.selection.$from.parent.textContent).toBe('after');
    });

    it('backspace_atTheStartOfASingleLine_collapsesTheFenceToAParagraph', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      expect(live.press('Backspace')).toBe(true);

      expect(view.state.doc.child(0).type.name).toBe('paragraph');
      expect(view.state.doc.child(0).textContent).toBe('abc');
    });

    it('backspace_withSeveralLinesOrInsideTheLine_isTheEditors', async () => {
      await boot('```ts\none\ntwo\n```\n');
      const live: FakeEditor = await enterFence();
      expect(live.press('Backspace')).toBe(false);

      live.selection = new FakeSelection(2, 2);

      expect(live.press('Backspace')).toBe(false);
      expect(view.state.doc.child(0).type.name).toBe('code_block');
    });

    it('otherKeys_passThrough', async () => {
      await boot('```ts\nabc\n```\n');
      const live: FakeEditor = await enterFence();

      expect(live.press('Escape')).toBe(false);
    });

    it('assist_isAttachedToTheEditorAndDetachedWithIt', async () => {
      let attached: number = 0;
      await boot(
        '```ts\nabc\n```\n',
        liveDeps(api, {
          assist: {
            attach: (): (() => void) => {
              attached += 1;
              return (): void => {
                attached -= 1;
              };
            },
            showing: (): boolean => false,
          },
        }),
      );
      const live: FakeEditor = await enterFence();
      expect(attached).toBe(1);
      live.surface.blur();

      live.blurListener?.();
      await afterTeardownDelay();

      expect(attached).toBe(0);
    });
  });
});

describe('MonacoCodeBlock plugin', () => {
  beforeAll(() => {
    // jsdom lacks the observers Crepe's features reach for; stub them so a boot failure is our bug,
    // not a missing browser API.
    class StubObserver {
      public observe(): void {
        /* jsdom has no layout to observe */
      }

      public unobserve(): void {
        /* jsdom has no layout to observe */
      }

      public disconnect(): void {
        /* jsdom has no layout to observe */
      }
    }
    const globalRef: { ResizeObserver?: unknown; IntersectionObserver?: unknown } = globalThis;
    globalRef.ResizeObserver ??= StubObserver;
    globalRef.IntersectionObserver ??= StubObserver;
  });

  // Milkdown's timer watchdogs cannot be cancelled; let them fire before the environment goes.
  afterAll(drainMilkdownTimers);

  it('boots and overrides the CodeMirror code-block view with the Monaco one', async () => {
    const root: HTMLDivElement = document.createElement('div');
    document.body.appendChild(root);
    // CodeMirror stays enabled (as in the app — Latex depends on it); the plugin must override its
    // code_block node view rather than replace the feature.
    const crepe: Crepe = new Crepe({
      root,
      defaultValue: '```ts\nconst a = 1;\n```\n',
    });
    crepe.editor.use(createMonacoCodeBlockPlugin(fakeDeps()));

    await crepe.create();

    // The Monaco placeholder is rendered, and CodeMirror's own code-block view never mounts for the
    // fence, confirming the last-registration-wins override.
    expect(root.querySelector('.milkdown-monaco-code-block')).not.toBeNull();
    expect(root.querySelector('.milkdown-code-block')).toBeNull();

    await crepe.destroy();
    root.remove();
  });
});
