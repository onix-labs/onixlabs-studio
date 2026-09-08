import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { drainMilkdownTimers } from '../testing/drain-milkdown-timers';
import { createStudioCrepe } from './create-studio-crepe';
import type { MonacoCodeBlockDeps } from './monaco-code-block-plugin';
import { selectDividerOnClick } from './divider-select-plugin';

/**
 * Builds fake Monaco services so the editor boots without a real Monaco.
 * @returns Returns the fake dependencies.
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

/**
 * Boots the studio editor with the given markdown and hands its view to the assertions.
 * @param markdown The initial markdown.
 * @param assertions The assertions to run with the editor view and Crepe instance.
 */
async function withView(
  markdown: string,
  assertions: (view: EditorView, crepe: Crepe) => void,
): Promise<void> {
  const root: HTMLDivElement = document.createElement('div');
  document.body.appendChild(root);
  const deps: Pick<MonacoCodeBlockDeps, 'monaco' | 'highlighter'> = fakeDeps();
  const crepe: Crepe = createStudioCrepe({
    root,
    defaultValue: markdown,
    resizableImages: false,
    monaco: deps.monaco,
    highlighter: deps.highlighter,
  });
  await crepe.create();
  try {
    crepe.editor.action((ctx: Ctx): void => {
      assertions(ctx.get(editorViewCtx), crepe);
    });
  } finally {
    await crepe.destroy();
    root.remove();
  }
}

/**
 * Finds the first divider in the document.
 * @param view The editor view.
 * @returns Returns the divider node and its position.
 */
function findDivider(view: EditorView): { node: ProseMirrorNode; pos: number } {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  view.state.doc.descendants((node: ProseMirrorNode, pos: number): boolean => {
    if (found === null && node.type.name === 'hr') {
      found = { node, pos };
    }
    return found === null;
  });
  expect(found).not.toBeNull();
  return found as unknown as { node: ProseMirrorNode; pos: number };
}

describe('dividerSelectPlugin', () => {
  beforeAll(() => {
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

  it('click_onADivider_selectsIt', async () => {
    await withView('above\n\n---\n\nbelow\n', (view: EditorView): void => {
      const { node, pos } = findDivider(view);
      expect(selectDividerOnClick(view, node, pos)).toBe(true);
      const selection: NodeSelection = view.state.selection as NodeSelection;
      expect(selection).toBeInstanceOf(NodeSelection);
      expect(selection.node.type.name).toBe('hr');
    });
  });

  it('click_onAnyOtherNode_isLeftToTheEditor', async () => {
    await withView('a paragraph\n', (view: EditorView): void => {
      const paragraph: ProseMirrorNode = view.state.doc.child(0);
      expect(selectDividerOnClick(view, paragraph, 0)).toBe(false);
    });
  });

  it('selectedDivider_deletesWithTheSelection_removingTheDividerFromTheMarkdown', async () => {
    await withView('above\n\n---\n\nbelow\n', (view: EditorView, crepe: Crepe): void => {
      const { node, pos } = findDivider(view);
      selectDividerOnClick(view, node, pos);
      view.dispatch(view.state.tr.deleteSelection());
      expect(crepe.getMarkdown()).toBe('above\n\nbelow\n');
    });
  });
});
