import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { drainMilkdownTimers } from '../testing/drain-milkdown-timers';
import { createStudioCrepe } from './create-studio-crepe';
import { toggleTaskList } from './markdown-task-list';
import type { MonacoCodeBlockDeps } from './monaco-code-block-plugin';

/**
 * Builds Monaco services that never load, so no fence builds a real editor.
 */
function fakeDeps(): Pick<MonacoCodeBlockDeps, 'monaco' | 'highlighter'> {
  return {
    monaco: {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): undefined => undefined,
      getEditorOptions: (): object => ({}),
      getThemeName: (): string => 'onix-dark-outline',
    } as unknown as MonacoCodeBlockDeps['monaco'],
    highlighter: {
      colorize: (): Promise<string> => Promise.resolve(''),
      resolveLanguageId: (): string => 'plaintext',
    } as unknown as MonacoCodeBlockDeps['highlighter'],
  };
}

describe('toggleTaskList', () => {
  let crepe: Crepe | undefined;
  let root: HTMLDivElement | undefined;

  /**
   * Boots the application's editor over the given markdown.
   */
  async function boot(markdown: string): Promise<Crepe> {
    root = document.createElement('div');
    document.body.appendChild(root);
    crepe = createStudioCrepe({
      root,
      defaultValue: markdown,
      resizableImages: false,
      monaco: fakeDeps().monaco,
      highlighter: fakeDeps().highlighter,
    });
    await crepe.create();
    return crepe;
  }

  /**
   * Selects the whole document.
   */
  function selectAll(editor: Crepe): void {
    editor.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    });
  }

  /**
   * Places the cursor in the first text of the document.
   */
  function cursorAtStart(editor: Crepe): void {
    editor.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
    });
  }

  beforeAll((): void => {
    // jsdom lays nothing out, and a selection change in a list asks where it landed.
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: (): DOMRectList => [] as unknown as DOMRectList,
      configurable: true,
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: (): DOMRect => new DOMRect(),
      configurable: true,
    });
  });

  afterEach(async (): Promise<void> => {
    await crepe?.destroy();
    crepe = undefined;
    root?.remove();
  });

  afterAll(drainMilkdownTimers);

  it('toggle_looseParagraph_wrapsItAndMakesItATask', async () => {
    const editor: Crepe = await boot('Buy milk');
    cursorAtStart(editor);

    editor.editor.action(toggleTaskList);

    expect(editor.getMarkdown().trim()).toMatch(/^[*-] \[ \] Buy milk$/);
  });

  it('toggle_plainList_marksEveryCoveredItem', async () => {
    const editor: Crepe = await boot('- one\n- two\n');
    selectAll(editor);

    editor.editor.action(toggleTaskList);

    expect(editor.getMarkdown().match(/\[ \]/g)).toHaveLength(2);
  });

  it('toggle_allTasks_clearsThem', async () => {
    const editor: Crepe = await boot('- [ ] one\n- [x] two\n');
    selectAll(editor);

    editor.editor.action(toggleTaskList);

    expect(editor.getMarkdown()).not.toContain('[');
    expect(editor.getMarkdown()).toContain('one');
  });

  it('toggle_aMixOfTasksAndPlainItems_makesAllTasksRatherThanClearing', async () => {
    const editor: Crepe = await boot('- [x] one\n- two\n');
    selectAll(editor);

    editor.editor.action(toggleTaskList);

    expect(editor.getMarkdown().match(/\[ \]/g)).toHaveLength(2);
  });

  it('toggle_cursorInOneItem_leavesTheOthersAlone', async () => {
    const editor: Crepe = await boot('- one\n- two\n');
    cursorAtStart(editor);

    editor.editor.action(toggleTaskList);

    expect(editor.getMarkdown().match(/\[ \]/g)).toHaveLength(1);
  });
});
