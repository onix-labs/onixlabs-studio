import { describe, expect, it } from 'vitest';
import type { Root, RootContent } from 'mdast';
import { transformCollapseTree } from './collapse-plugin';

/**
 * Builds a root-level raw HTML mdast node.
 * @param value The raw HTML text.
 * @returns Returns the html node.
 */
function html(value: string): RootContent {
  return { type: 'html', value };
}

/**
 * Builds a paragraph mdast node with one text child.
 * @param text The paragraph text.
 * @returns Returns the paragraph node.
 */
function paragraph(text: string): RootContent {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

/**
 * Builds a paragraph wrapping inline HTML nodes — the shape Milkdown's own remark steps hand to
 * plugin transforms for raw HTML blocks.
 * @param values The inline HTML pieces.
 * @returns Returns the paragraph node.
 */
function inlineHtmlParagraph(...values: string[]): RootContent {
  return {
    type: 'paragraph',
    children: values.map((value: string): { type: 'html'; value: string } => ({
      type: 'html',
      value,
    })),
  };
}

/**
 * Builds a root around the given children.
 * @param children The root children.
 * @returns Returns the root.
 */
function root(...children: RootContent[]): Root {
  return { type: 'root', children };
}

/**
 * The loosely-typed view of a transformed collapse node the assertions read.
 */
interface CollapseShape {
  type: string;
  children: { type: string; children?: { type: string; value?: string }[] }[];
}

describe('transformCollapseTree', () => {
  it('groupsOpenTagBodyBlocksAndCloseTag_intoOneCollapseNode', () => {
    const tree: Root = root(
      paragraph('before'),
      html('<details>\n<summary>More info</summary>'),
      paragraph('Hidden body'),
      paragraph('Second paragraph'),
      html('</details>'),
      paragraph('after'),
    );

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual([
      'paragraph',
      'collapse',
      'paragraph',
    ]);
    const collapse: CollapseShape = result.children[1] as unknown as CollapseShape;
    expect(collapse.children[0].type).toBe('collapseSummary');
    expect(collapse.children[0].children?.[0].value).toBe('More info');
    expect(collapse.children.slice(1).map((child): string => child.type)).toEqual([
      'paragraph',
      'paragraph',
    ]);
  });

  it('parsesAWholeDetailsBlockHeldInOneHtmlNode', () => {
    const tree: Root = root(html('<details><summary>Title</summary>Inline body</details>'));

    const result: Root = transformCollapseTree(tree);

    const collapse: CollapseShape = result.children[0] as unknown as CollapseShape;
    expect(collapse.type).toBe('collapse');
    expect(collapse.children[0].children?.[0].value).toBe('Title');
    expect(collapse.children[1].type).toBe('paragraph');
    expect(collapse.children[1].children?.[0].value).toBe('Inline body');
  });

  it('parsesAWholeDetailsBlockWithAnEmptyBody', () => {
    const tree: Root = root(html('<details><summary>Empty</summary></details>'));

    const result: Root = transformCollapseTree(tree);

    const collapse: CollapseShape = result.children[0] as unknown as CollapseShape;
    expect(collapse.type).toBe('collapse');
    expect(collapse.children).toHaveLength(1);
  });

  it('toleratesAttributesOnTheDetailsAndSummaryTags', () => {
    const tree: Root = root(
      html('<details open>\n<summary class="x">Styled</summary>'),
      paragraph('body'),
      html('</details>'),
    );

    const result: Root = transformCollapseTree(tree);

    const collapse: CollapseShape = result.children[0] as unknown as CollapseShape;
    expect(collapse.type).toBe('collapse');
    expect(collapse.children[0].children?.[0].value).toBe('Styled');
  });

  it('leavesAnUnclosedDetailsBlockAlone', () => {
    const tree: Root = root(
      html('<details>\n<summary>Never closed</summary>'),
      paragraph('dangling'),
    );

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual([
      'html',
      'paragraph',
    ]);
  });

  it('groupsParagraphWrappedInlineHtml_theShapeMilkdownProduces', () => {
    // Milkdown's own remark steps wrap raw HTML blocks into paragraphs of inline html nodes before
    // plugin transforms run; the grouping must recognise that shape too.
    const tree: Root = root(
      inlineHtmlParagraph('<details>\n<summary>Wrapped</summary>'),
      paragraph('Body'),
      inlineHtmlParagraph('</details>'),
    );

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual(['collapse']);
    const collapse: CollapseShape = result.children[0] as unknown as CollapseShape;
    expect(collapse.children[0].children?.[0].value).toBe('Wrapped');
    expect(collapse.children[1].type).toBe('paragraph');
  });

  it('leavesParagraphsMixingHtmlAndTextAlone', () => {
    const tree: Root = root({
      type: 'paragraph',
      children: [
        { type: 'html', value: '<details>' },
        { type: 'text', value: 'not just markup' },
      ],
    });

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual(['paragraph']);
  });

  it('leavesUnrelatedHtmlAlone', () => {
    const tree: Root = root(html('<img src="x.png">'), paragraph('text'));

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual([
      'html',
      'paragraph',
    ]);
  });

  it('groupsSeveralDetailsBlocksIndependently', () => {
    const tree: Root = root(
      html('<details>\n<summary>First</summary>'),
      paragraph('one'),
      html('</details>'),
      html('<details>\n<summary>Second</summary>'),
      paragraph('two'),
      html('</details>'),
    );

    const result: Root = transformCollapseTree(tree);

    expect(result.children.map((child: RootContent): string => child.type)).toEqual([
      'collapse',
      'collapse',
    ]);
    const second: CollapseShape = result.children[1] as unknown as CollapseShape;
    expect(second.children[0].children?.[0].value).toBe('Second');
  });

  it('supportsNestedMarkdownBlocksInTheBody', () => {
    const tree: Root = root(
      html('<details>\n<summary>Rich</summary>'),
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Heading' }] },
      {
        type: 'list',
        ordered: false,
        children: [
          {
            type: 'listItem',
            children: [paragraph('item') as never],
          },
        ],
      },
      html('</details>'),
    );

    const result: Root = transformCollapseTree(tree);

    const collapse: CollapseShape = result.children[0] as unknown as CollapseShape;
    expect(collapse.children.slice(1).map((child): string => child.type)).toEqual([
      'heading',
      'list',
    ]);
  });
});
