import { TestBed } from '@angular/core/testing';

import {
  type AiBridgeScope,
  CANCEL_EDIT_PREVIEW,
  COMMIT_EDIT_PREVIEW,
  EDIT_ACTIVE_DOCUMENT,
  EDIT_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  PREVIEW_ACTIVE_DOCUMENT_EDIT,
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  REPLACE_DOCUMENT,
  RUN_ACTIVE_DOCUMENT,
  SET_ACTIVE_DOCUMENT_LANGUAGE,
  UNSCOPED_BRIDGE_REQUEST,
} from '@shared/api/ai-types';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Documents } from '@shared/angular/services/documents/documents';
import {
  EditorCommandHandler,
  EditorCommands,
} from '@shared/angular/services/editor-commands/editor-commands';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { RunFileTaskProvider } from '@shared/angular/services/tasks/providers/run-file-task-provider';
import type { Task } from '@shared/angular/services/tasks/task';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { AgentEditorCapabilities } from './agent-editor-capabilities';

/**
 * Builds a code handler over a mutable text.
 */
function textHandler(holder: { text: string }): EditorCommandHandler {
  const noop: () => void = (): void => undefined;
  return {
    cut: noop,
    copy: noop,
    paste: noop,
    undo: noop,
    redo: noop,
    find: noop,
    formatDocument: noop,
    save: noop,
    saveAs: noop,
    getText: (): string => holder.text,
    getSelectionText: (): string => '',
    replaceText: (value: string): void => {
      holder.text = value;
    },
    replaceRange: (start: number, length: number, value: string): void => {
      holder.text = holder.text.slice(0, start) + value + holder.text.slice(start + length);
    },
  };
}

/**
 * A staged preview's answer, as far as these tests read it.
 */
interface Staged {
  readonly available: boolean;
  readonly previewId?: string;
  readonly summary?: string;
  readonly detail?: string;
  readonly name?: string;
}

/**
 * A run's answer, as far as these tests read it.
 */
interface Ran {
  readonly ran: boolean;
  readonly detail?: string;
  readonly exitCode?: number | null;
  readonly success?: boolean;
  readonly timedOut?: boolean;
  readonly output?: string;
  readonly command?: string;
}

describe('AgentEditorCapabilities, staged edits and runs', () => {
  let registered: Map<string, AiCapability>;
  let editorCommands: EditorCommands;
  let documents: Documents;
  let terminalText: string | null;
  let queued: string[];
  let task: Task | null;
  let runnable: boolean;

  /**
   * Calls a capability as an unscoped request.
   */
  function call(name: string, input: unknown, scope?: AiBridgeScope): unknown {
    const capability: AiCapability | undefined = registered.get(name);
    if (capability === undefined) {
      throw new Error(`${name} is not registered`);
    }
    return capability(input, scope ?? UNSCOPED_BRIDGE_REQUEST);
  }

  /**
   * Stages an edit and returns its answer.
   */
  function stage(input: object): Staged {
    return call(PREVIEW_ACTIVE_DOCUMENT_EDIT, input) as Staged;
  }

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    terminalText = null;
    queued = [];
    runnable = true;
    task = {
      resolve: async (): Promise<string> => Promise.resolve('node a.js'),
    } as unknown as Task;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiRuntime,
          useValue: {
            registerCapability: (name: string, handler: AiCapability): (() => void) => {
              registered.set(name, handler);
              return (): void => undefined;
            },
          },
        },
        {
          provide: RunFileTaskProvider,
          useValue: {
            canRun: (): boolean => runnable,
            buildTask: (): Task | null => task,
          },
        },
        {
          provide: EditorTerminals,
          useValue: {
            queueCommand: (_id: string, command: string): void => void queued.push(command),
          },
        },
        { provide: Terminals, useValue: { readText: (): string | null => terminalText } },
      ],
    });
    editorCommands = TestBed.inject(EditorCommands);
    documents = TestBed.inject(Documents);
    TestBed.inject(AgentEditorCapabilities);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('staging an edit', () => {
    it('stage_summarisesTheChangeAndTouchesNothing', () => {
      const holder: { text: string } = { text: 'one\ntwo' };
      editorCommands.register('tab-1', textHandler(holder));

      const staged: Staged = stage({
        operation: 'edit',
        oldString: 'two',
        newString: 'two\nthree',
      });

      expect(staged.available).toBe(true);
      expect(staged.name).toBe('the active document');
      expect(staged.summary).toBe('+1 lines, +6 characters');
      expect(holder.text).toBe('one\ntwo');
    });

    it('stage_ofAShorterDocument_countsDown', () => {
      editorCommands.register('tab-1', textHandler({ text: 'one\ntwo\nthree' }));

      expect(stage({ operation: 'replace', text: 'x' }).summary).toBe('−2 lines, −12 characters');
    });

    it('stage_inAMarkdownDocument_saysSo', () => {
      TestBed.inject(MarkdownCommands).register('doc-1', {
        readDocument: (): string => 'hello',
        replaceDocument: (): void => undefined,
      } as never);

      expect(stage({ operation: 'replace', text: 'x' }).name).toBe('the markdown document');
    });

    it.each([
      [{}],
      [{ operation: 'nonsense' }],
      [{ operation: 'replace' }],
      [{ operation: 'edit', oldString: 'a' }],
      [{ operation: 'insert', text: 'a', placement: 'sideways' }],
    ])('stage_withMalformedInput_%j_isRefused', (input: object) => {
      editorCommands.register('tab-1', textHandler({ text: 'x' }));

      expect(stage(input)).toEqual({ available: false, detail: 'The edit input was malformed.' });
    });

    it('stage_withNoDocument_isRefused', () => {
      expect(stage({ operation: 'replace', text: 'x' }).available).toBe(false);
    });

    it('stage_ofTextThatIsNotThere_explains', () => {
      editorCommands.register('tab-1', textHandler({ text: 'abc' }));

      const staged: Staged = stage({ operation: 'edit', oldString: 'zzz', newString: 'y' });

      expect(staged.available).toBe(false);
      expect(staged.detail).toBeTruthy();
    });

    it('stage_anInsert_appliesWhenCommitted', () => {
      const holder: { text: string } = { text: 'abc' };
      editorCommands.register('tab-1', textHandler(holder));
      const staged: Staged = stage({ operation: 'insert', text: 'Z', placement: 'start' });

      expect(call(COMMIT_EDIT_PREVIEW, { previewId: staged.previewId })).toMatchObject({
        ok: true,
      });
      expect(holder.text.startsWith('Z')).toBe(true);
    });
  });

  describe('deciding', () => {
    it('commit_appliesTheStagedEdit_once', () => {
      const holder: { text: string } = { text: 'one two' };
      editorCommands.register('tab-1', textHandler(holder));
      const staged: Staged = stage({ operation: 'edit', oldString: 'two', newString: '2' });

      const first: unknown = call(COMMIT_EDIT_PREVIEW, { previewId: staged.previewId });
      const second: unknown = call(COMMIT_EDIT_PREVIEW, { previewId: staged.previewId });

      expect(first).toEqual({ ok: true, detail: 'The edit was applied.' });
      expect(holder.text).toBe('one 2');
      expect(second).toEqual({ ok: false, detail: 'The staged edit is no longer available.' });
    });

    it('commit_afterTheUserTyped_keepsTheirTypingAndSaysWhy', () => {
      const holder: { text: string } = { text: 'one two' };
      editorCommands.register('tab-1', textHandler(holder));
      const staged: Staged = stage({ operation: 'replace', text: 'agent draft' });
      holder.text = 'one two, and what the user typed';

      const result: { ok: boolean; detail: string } = call(COMMIT_EDIT_PREVIEW, {
        previewId: staged.previewId,
      }) as { ok: boolean; detail: string };

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('changed');
      expect(holder.text).toBe('one two, and what the user typed');
    });

    it('commit_afterMovingToAnotherDocument_leavesThatDocumentAlone', () => {
      const first: { text: string } = { text: 'first' };
      const second: { text: string } = { text: 'second' };
      editorCommands.register('tab-1', textHandler(first));
      const staged: Staged = stage({ operation: 'edit', oldString: 'first', newString: 'edited' });
      editorCommands.register('tab-2', textHandler(second));

      const result: { ok: boolean } = call(COMMIT_EDIT_PREVIEW, {
        previewId: staged.previewId,
      }) as { ok: boolean };

      expect(result.ok).toBe(false);
      expect(second.text).toBe('second');
    });

    it('commit_afterTheDocumentClosed_saysSo', () => {
      editorCommands.register('tab-1', textHandler({ text: 'x' }));
      const staged: Staged = stage({ operation: 'replace', text: 'y' });
      editorCommands.forget('tab-1');

      expect(call(COMMIT_EDIT_PREVIEW, { previewId: staged.previewId })).toEqual({
        ok: false,
        detail: 'The editor is no longer available.',
      });
    });

    it('cancel_dropsTheEdit', () => {
      const holder: { text: string } = { text: 'x' };
      editorCommands.register('tab-1', textHandler(holder));
      const staged: Staged = stage({ operation: 'replace', text: 'y' });

      call(CANCEL_EDIT_PREVIEW, { previewId: staged.previewId });

      expect(call(COMMIT_EDIT_PREVIEW, { previewId: staged.previewId })).toMatchObject({
        ok: false,
      });
      expect(holder.text).toBe('x');
    });

    it('commit_ofNonsense_isRefused', () => {
      expect(call(COMMIT_EDIT_PREVIEW, null)).toMatchObject({ ok: false });
      expect(call(COMMIT_EDIT_PREVIEW, { previewId: 7 })).toMatchObject({ ok: false });
    });
  });

  describe('direct edits', () => {
    it('edit_withMalformedInput_isRefused', () => {
      expect(call(EDIT_ACTIVE_DOCUMENT, { oldString: 'a' })).toMatchObject({ ok: false });
      expect(call(INSERT_ACTIVE_DOCUMENT, { text: 'a', placement: 'nowhere' })).toMatchObject({
        ok: false,
      });
      expect(call(EDIT_DOCUMENT, { id: 'x' })).toMatchObject({ ok: false });
      expect(call(REPLACE_DOCUMENT, { id: 'x' })).toMatchObject({ ok: false });
    });

    it('edit_withNoDocument_saysSo', () => {
      expect(call(EDIT_ACTIVE_DOCUMENT, { oldString: 'a', newString: 'b' })).toEqual({
        ok: false,
        detail: 'No active document is open in the editor.',
      });
    });

    it('edit_aimedAtATabWithNoEditor_readsNothing', () => {
      expect(call(READ_ACTIVE_DOCUMENT, { tabId: 'gone' })).toEqual({
        available: false,
        text: '',
      });
      expect(call(REPLACE_ACTIVE_DOCUMENT, { tabId: 'gone', text: 'x' })).toEqual({ ok: false });
    });
  });

  describe('setting the language', () => {
    it('language_ofTheActiveDocument_isSet', () => {
      documents.ensure('tab-1');
      documents.setActiveDocument('tab-1');

      expect(call(SET_ACTIVE_DOCUMENT_LANGUAGE, { language: 'python' })).toMatchObject({
        ok: true,
      });
      expect(documents.get('tab-1')?.language()).toBe('python');
    });

    it('language_missingOrUnknown_isRefused', () => {
      expect(call(SET_ACTIVE_DOCUMENT_LANGUAGE, {})).toMatchObject({ ok: false });
      expect(call(SET_ACTIVE_DOCUMENT_LANGUAGE, { language: 'klingon' })).toMatchObject({
        ok: false,
      });
    });

    it('language_withNoDocument_isRefused', () => {
      expect(call(SET_ACTIVE_DOCUMENT_LANGUAGE, { language: 'python' })).toEqual({
        ok: false,
        detail: 'No code document is open in the editor.',
      });
    });
  });

  describe('running', () => {
    /**
     * Prepares a runnable active document.
     */
    function activeDocument(): void {
      documents.ensure('tab-1');
      documents.setActiveDocument('tab-1');
    }

    /**
     * Reads the marker the queued command will print.
     */
    function markerFor(exitCode: number): string {
      const marker: string | undefined = /__STUDIO_RUN_\d+_/.exec(queued[0] ?? '')?.[0];
      return `${marker ?? ''}${exitCode}__`;
    }

    it('run_withNoDocument_isRefused', async () => {
      expect(await call(RUN_ACTIVE_DOCUMENT, {})).toEqual({
        ran: false,
        detail: 'No code document is open in the editor to run.',
      });
    });

    it('run_ofALanguageWithNoRunner_says', async () => {
      activeDocument();
      runnable = false;

      const result: Ran = (await call(RUN_ACTIVE_DOCUMENT, {})) as Ran;

      expect(result.ran).toBe(false);
      expect(result.detail).toContain('cannot be run');
      expect(queued).toEqual([]);
    });

    it('run_thatCannotBePrepared_says', async () => {
      activeDocument();
      task = null;

      const result: Ran = (await call(RUN_ACTIVE_DOCUMENT, {})) as Ran;

      expect(result.ran).toBe(false);
      expect(queued).toEqual([]);
    });

    it('run_reportsTheExitCodeAndOutput', async () => {
      activeDocument();

      const running: Promise<unknown> = Promise.resolve(call(RUN_ACTIVE_DOCUMENT, {}));
      await vi.waitFor((): void => {
        expect(queued).toHaveLength(1);
      });
      terminalText = `$ ${queued[0]}\nhello\n${markerFor(3)}\n`;
      const result: Ran = (await running) as Ran;

      expect(result).toMatchObject({ ran: true, exitCode: 3, success: false, timedOut: false });
      expect(result.command).toBe('node a.js');
      expect(result.output).toContain('hello');
    });

    it('run_thatNeverFinishes_timesOutWithWhatItSaid', async () => {
      activeDocument();
      vi.useFakeTimers();
      terminalText = 'partial output\n';

      const running: Promise<unknown> = Promise.resolve(
        call(RUN_ACTIVE_DOCUMENT, { timeoutSeconds: 1 }),
      );
      await vi.advanceTimersByTimeAsync(1500);
      const result: Ran = (await running) as Ran;

      expect(result).toMatchObject({ ran: true, timedOut: true, exitCode: null, success: false });
    });

    it('run_whoseTerminalNeverAppears_timesOutEmpty', async () => {
      activeDocument();
      vi.useFakeTimers();

      const running: Promise<unknown> = Promise.resolve(
        call(RUN_ACTIVE_DOCUMENT, { timeoutSeconds: 'soon' }),
      );
      await vi.advanceTimersByTimeAsync(61_000);
      const result: Ran = (await running) as Ran;

      expect(result).toMatchObject({ timedOut: true, output: '' });
    });
  });
});
