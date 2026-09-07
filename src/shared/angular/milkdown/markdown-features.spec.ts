import { beforeAll, describe, expect, it } from 'vitest';
import type { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  insertHrCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
} from '@milkdown/preset-commonmark';
import { insertTableCommand } from '@milkdown/preset-gfm';
import { AllSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { callCommand } from '@milkdown/utils';
import { createStudioCrepe } from './create-studio-crepe';
import type { MonacoCodeBlockDeps } from './monaco-code-block-plugin';

/**
 * Builds fake Monaco services for the code-block node view: Monaco never "loads", so fences stay on
 * their static placeholder path and never construct a real editor (which jsdom could not host).
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
 * A booted editor under test: the mounted root to query, the Crepe instance to serialise and command,
 * and a disposer that tears both down.
 */
interface BootedEditor {
  /**
   * Gets the element the editor is mounted in, for DOM assertions.
   */
  readonly root: HTMLDivElement;

  /**
   * Gets the Crepe instance.
   */
  readonly crepe: Crepe;

  /**
   * Destroys the editor and removes its root from the document.
   */
  readonly dispose: () => Promise<void>;
}

/**
 * Boots the application's markdown editor — via the same factory the shared markdown-editor component
 * uses — with the given markdown as its initial content.
 * @param markdown The initial markdown source.
 * @returns Returns the booted editor.
 */
async function boot(markdown: string): Promise<BootedEditor> {
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
  return {
    root,
    crepe,
    dispose: async (): Promise<void> => {
      await crepe.destroy();
      root.remove();
    },
  };
}

/**
 * Boots the editor with the given markdown and returns what it serialises back.
 * @param markdown The markdown source.
 * @returns Returns the editor's serialisation of it.
 */
async function serialize(markdown: string): Promise<string> {
  const editor: BootedEditor = await boot(markdown);
  const result: string = editor.crepe.getMarkdown();
  await editor.dispose();
  return result;
}

/**
 * Asserts the feature's serialisation round-trips without loss: parsing the markdown and serialising
 * it yields the expected canonical form, and parsing that canonical form again reproduces it exactly.
 * A feature failing the second leg mutates the user's document every time it is opened and saved.
 * @param markdown The authored markdown source.
 * @param canonical The canonical serialisation the editor normalises it to; defaults to the input.
 */
async function expectRoundTrip(markdown: string, canonical: string = markdown): Promise<void> {
  const first: string = await serialize(markdown);
  expect(first).toBe(canonical);
  const second: string = await serialize(first);
  expect(second).toBe(first);
}

/**
 * Runs assertions against the DOM of an editor booted with the given markdown, then tears it down.
 * @param markdown The markdown source.
 * @param assertions The assertions to run against the booted editor.
 */
async function withEditor(
  markdown: string,
  assertions: (editor: BootedEditor) => void | Promise<void>,
): Promise<void> {
  const editor: BootedEditor = await boot(markdown);
  try {
    await assertions(editor);
  } finally {
    await editor.dispose();
  }
}

/**
 * Selects the whole document and runs a Milkdown command against the booted editor.
 * @param editor The booted editor.
 * @param command The command runner (from {@link callCommand}).
 */
function runOnWholeDocument(editor: BootedEditor, command: (ctx: Ctx) => unknown): void {
  editor.crepe.editor.action((ctx: Ctx): void => {
    const view: EditorView = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
  });
  editor.crepe.editor.action((ctx: Ctx): void => {
    command(ctx);
  });
}

describe('markdown features', () => {
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

  describe('headings', () => {
    it('renders_everyAtxHeadingLevel_asItsHeadingElement', async () => {
      await withEditor(
        '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n',
        ({ root }): void => {
          for (const [tag, text] of [
            ['h1', 'One'],
            ['h2', 'Two'],
            ['h3', 'Three'],
            ['h4', 'Four'],
            ['h5', 'Five'],
            ['h6', 'Six'],
          ]) {
            expect(root.querySelector(tag)?.textContent).toBe(text);
          }
        },
      );
    });

    it('roundTrips_headings_unchanged', async () => {
      await expectRoundTrip('# One\n\n###### Six\n');
    });
  });

  describe('paragraphs and inline marks', () => {
    it('renders_inlineMarks_asStrongEmDelCodeAndAnchor', async () => {
      await withEditor(
        'Some **bold** and *italic* and ~~gone~~ and `code` and [link](https://example.com/).\n',
        ({ root }): void => {
          expect(root.querySelector('p strong')?.textContent).toBe('bold');
          expect(root.querySelector('p em')?.textContent).toBe('italic');
          expect(root.querySelector('p del')?.textContent).toBe('gone');
          expect(root.querySelector('p code')?.textContent).toBe('code');
          expect(root.querySelector('p a')?.getAttribute('href')).toBe('https://example.com/');
        },
      );
    });

    it('roundTrips_inlineMarks_unchanged', async () => {
      await expectRoundTrip(
        'Some **bold** and *italic* and ~~gone~~ and `code` and [link](https://example.com/).\n',
      );
    });
  });

  describe('dividers', () => {
    it('renders_aThematicBreak_asAnHrElement', async () => {
      await withEditor('above\n\n---\n\nbelow\n', ({ root }): void => {
        expect(root.querySelector('hr')).not.toBeNull();
      });
    });

    it('roundTrips_aDivider_toTheCanonicalStarForm', async () => {
      await expectRoundTrip('above\n\n---\n\nbelow\n', 'above\n\n***\n\nbelow\n');
    });
  });

  describe('lists', () => {
    it('renders_bulletAndOrderedLists_asListItems', async () => {
      await withEditor('* one\n* two\n\n1. first\n2. second\n', ({ root }): void => {
        const bullets: string[] = Array.from(root.querySelectorAll('ul li p')).map(
          (item: Element): string => item.textContent ?? '',
        );
        const ordered: string[] = Array.from(root.querySelectorAll('ol li p')).map(
          (item: Element): string => item.textContent ?? '',
        );
        expect(bullets).toEqual(['one', 'two']);
        expect(ordered).toEqual(['first', 'second']);
      });
    });

    it('renders_taskListItems_withCheckedAndUncheckedLabels', async () => {
      await withEditor('* [ ] open\n* [x] done\n', ({ root }): void => {
        expect(root.querySelector('li .label.unchecked')).not.toBeNull();
        expect(root.querySelector('li .label.checked')).not.toBeNull();
      });
    });

    it('roundTrips_lists_toTheCanonicalStarBullets', async () => {
      await expectRoundTrip('- one\n- two\n', '* one\n* two\n');
      await expectRoundTrip('1. first\n2. second\n');
      await expectRoundTrip('- [ ] open\n- [x] done\n', '* [ ] open\n* [x] done\n');
    });

    it('roundTrips_aNestedList_unchanged', async () => {
      await expectRoundTrip('* parent\n\n  * child\n');
    });
  });

  describe('blockquotes', () => {
    it('renders_aBlockquote_asABlockquoteElement', async () => {
      await withEditor('> quoted\n', ({ root }): void => {
        expect(root.querySelector('blockquote p')?.textContent).toBe('quoted');
      });
    });

    it('roundTrips_aBlockquote_unchanged', async () => {
      await expectRoundTrip('> quoted\n');
    });
  });

  describe('tables', () => {
    it('renders_aGfmTable_insideTheTableBlockView', async () => {
      await withEditor('| a | b |\n| - | - |\n| 1 | 2 |\n', ({ root }): void => {
        const block: Element | null = root.querySelector('.milkdown-table-block');
        expect(block).not.toBeNull();
        const headers: string[] = Array.from(block?.querySelectorAll('th') ?? []).map(
          (cell: Element): string => cell.textContent?.trim() ?? '',
        );
        const cells: string[] = Array.from(block?.querySelectorAll('td') ?? []).map(
          (cell: Element): string => cell.textContent?.trim() ?? '',
        );
        expect(headers).toEqual(['a', 'b']);
        expect(cells).toEqual(['1', '2']);
      });
    });

    it('roundTrips_aGfmTable_unchanged', async () => {
      await expectRoundTrip('| a | b |\n| - | - |\n| 1 | 2 |\n');
    });
  });

  describe('code fences', () => {
    it('renders_aFence_asTheMonacoBlockPlaceholderWithItsCodeAndLanguage', async () => {
      await withEditor('```ts\nconst a = 1;\n```\n', ({ root }): void => {
        expect(
          root.querySelector('.milkdown-monaco-code-block__placeholder code')?.textContent,
        ).toBe('const a = 1;');
        const language: HTMLInputElement | null = root.querySelector<HTMLInputElement>(
          '.milkdown-monaco-code-block__language',
        );
        expect(language?.value).toBe('ts');
      });
    });

    it('roundTrips_aFence_unchanged', async () => {
      await expectRoundTrip('```ts\nconst a = 1;\n```\n');
    });

    it('roundTrips_aFenceContainingBackticks_byExtendingTheOuterFence', async () => {
      // The data-loss class: a fence whose body itself holds a three-backtick fence must serialise
      // with a longer outer fence and survive a reopen byte-for-byte.
      await expectRoundTrip('````md\nInner fence:\n\n```js\nlet x = 2;\n```\n````\n');
    });
  });

  describe('math', () => {
    it('renders_inlineMath_throughKatex', async () => {
      await withEditor('Euler: $e^{i\\pi} = -1$\n', ({ root }): void => {
        expect(root.querySelector('[data-type="math_inline"] .katex')).not.toBeNull();
      });
    });

    it('roundTrips_inlineAndBlockMath_unchanged', async () => {
      await expectRoundTrip('Euler: $e^{i\\pi} = -1$\n');
      await expectRoundTrip('$$\nx^2\n$$\n');
    });
  });

  describe('emoji', () => {
    it('converts_aShortcode_toItsUnicodeEmoji', async () => {
      await withEditor('Hello :smile:\n', ({ root }): void => {
        expect(root.querySelector('p')?.textContent).toBe('Hello 😄');
      });
    });

    it('roundTrips_theConvertedEmoji_stably', async () => {
      await expectRoundTrip('Hello :smile:\n', 'Hello 😄\n');
    });
  });

  describe('subscript and superscript', () => {
    it('renders_subAndSupTags_asSubscriptAndSuperscript', async () => {
      await withEditor('H<sub>2</sub>O and x<sup>2</sup>\n', ({ root }): void => {
        expect(root.querySelector('p sub')?.textContent).toBe('2');
        expect(root.querySelector('p sup')?.textContent).toBe('2');
      });
    });

    it('roundTrips_subAndSupTags_unchanged', async () => {
      await expectRoundTrip('H<sub>2</sub>O and x<sup>2</sup>\n');
    });

    it('rendersItsOwnSerialisation_withoutLosingTheMarks', async () => {
      // The regression that motivated the html-node serialisation: the escaped form `\<sub>` parsed
      // back as literal text, so the marks were lost the first time a document was reopened.
      const serialised: string = await serialize('H<sub>2</sub>O and x<sup>2</sup>\n');
      await withEditor(serialised, ({ root }): void => {
        expect(root.querySelector('p sub')?.textContent).toBe('2');
        expect(root.querySelector('p sup')?.textContent).toBe('2');
      });
    });
  });

  describe('footnotes', () => {
    it('renders_aFootnote_asAReferenceAndADefinition', async () => {
      await withEditor('A claim.[^1]\n\n[^1]: The evidence.\n', ({ root }): void => {
        expect(root.querySelector('sup[data-type="footnote_reference"]')?.textContent).toBe('1');
        expect(root.querySelector('dl[data-type="footnote_definition"] dd p')?.textContent).toBe(
          'The evidence.',
        );
      });
    });

    it('roundTrips_aFootnote_unchanged', async () => {
      await expectRoundTrip('A claim.[^1]\n\n[^1]: The evidence.\n');
    });
  });

  describe('github alerts', () => {
    it('renders_anAlertBlockquote_asItsAlertBlockWithItsContent', async () => {
      await withEditor('> [!NOTE]\n> Useful context.\n', ({ root }): void => {
        const alert: Element | null = root.querySelector('.github-alert.github-alert-note');
        expect(alert).not.toBeNull();
        expect(alert?.querySelector('.alert-content')?.textContent).toContain('Useful context.');
      });
    });
  });

  describe('collapsible sections', () => {
    it('renders_aDetailsBlock_asTheCollapseViewWithSummaryAndBody', async () => {
      await withEditor(
        '<details>\n<summary>More</summary>\n\nHidden body\n\n</details>\n',
        ({ root }): void => {
          const block: Element | null = root.querySelector('.collapse-block');
          expect(block?.querySelector('.collapse-summary')?.textContent).toBe('More');
          expect(block?.querySelector('.collapse-inner p')?.textContent).toBe('Hidden body');
        },
      );
    });

    it('roundTrips_aDetailsBlock_unchanged', async () => {
      await expectRoundTrip('<details>\n<summary>More</summary>\n\nHidden body\n\n</details>\n');
    });
  });

  describe('images', () => {
    it('renders_aMarkdownImage_asAnImgElement', async () => {
      await withEditor('![alt text](pic.png)\n', ({ root }): void => {
        const image: HTMLImageElement | null = root.querySelector<HTMLImageElement>('p img[alt]');
        expect(image?.getAttribute('src')).toBe('pic.png');
        expect(image?.getAttribute('alt')).toBe('alt text');
      });
    });

    it('renders_aRawHtmlImage_throughTheHtmlImageBlock', async () => {
      await withEditor('<img src="pic.png" width="100" alt="p">\n', ({ root }): void => {
        const block: Element | null = root.querySelector('.html-image-block');
        expect(block?.querySelector('img')?.getAttribute('width')).toBe('100');
      });
    });

    it('roundTrips_markdownAndHtmlImages_unchanged', async () => {
      await expectRoundTrip('![alt text](pic.png)\n');
      await expectRoundTrip('<img src="pic.png" width="100" alt="p">\n');
    });
  });

  describe('mermaid diagrams', () => {
    it('renders_aMermaidFence_asTheDiagramBlockCarryingItsSource', async () => {
      await withEditor('```mermaid\ngraph TD;\nA-->B;\n```\n', ({ root }): void => {
        // jsdom cannot rasterise the diagram; what matters is the fence became the diagram block and
        // its source is carried on the block for editing.
        expect(root.querySelector('.mermaid-block')?.getAttribute('data-value')).toBe(
          'graph TD;\nA-->B;',
        );
      });
    });

    it('roundTrips_aMermaidFence_unchanged', async () => {
      await expectRoundTrip('```mermaid\ngraph TD;\nA-->B;\n```\n');
    });
  });

  describe('colour previews', () => {
    it('renders_aHexColourInInlineCode_withASwatch', async () => {
      await withEditor('Use `#ff8800` here\n', ({ root }): void => {
        const swatch: HTMLElement | null = root.querySelector<HTMLElement>('.color-preview-swatch');
        expect(swatch?.style.backgroundColor).toBe('rgb(255, 136, 0)');
      });
    });

    it('roundTrips_theColourCode_unchanged', async () => {
      await expectRoundTrip('Use `#ff8800` here\n');
    });
  });

  describe('formatting commands', () => {
    it('toggleStrong_onTheSelection_serialisesBoldMarks', async () => {
      await withEditor('make me bold\n', (editor: BootedEditor): void => {
        runOnWholeDocument(editor, callCommand(toggleStrongCommand.key));
        expect(editor.crepe.getMarkdown()).toBe('**make me bold**\n');
      });
    });

    it('insertHr_addsADivider', async () => {
      await withEditor('text\n', (editor: BootedEditor): void => {
        runOnWholeDocument(editor, callCommand(insertHrCommand.key));
        expect(editor.crepe.getMarkdown()).toContain('***');
      });
    });

    it('insertTable_addsAGfmTable', async () => {
      await withEditor('text\n', (editor: BootedEditor): void => {
        runOnWholeDocument(editor, callCommand(insertTableCommand.key));
        expect(editor.crepe.getMarkdown()).toContain('|');
      });
    });

    it('wrapInBulletList_wrapsTheBlock', async () => {
      await withEditor('item\n', (editor: BootedEditor): void => {
        runOnWholeDocument(editor, callCommand(wrapInBulletListCommand.key));
        expect(editor.crepe.getMarkdown()).toContain('* item\n');
      });
    });
  });
});
