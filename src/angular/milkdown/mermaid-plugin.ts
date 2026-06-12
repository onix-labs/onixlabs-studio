/**
 * Milkdown plugin for rendering Mermaid diagrams with click-to-edit behavior.
 *
 * Supports all Mermaid diagram types:
 * - Flowcharts
 * - Sequence diagrams
 * - Class diagrams
 * - State diagrams
 * - Entity Relationship diagrams
 * - Gantt charts
 * - Pie charts
 * - Git graphs
 * - Journey maps
 *
 * When clicked, the rendered diagram switches to editable raw code.
 * When unfocused, the raw code is re-rendered as a diagram.
 */

import { $node, $remark } from '@milkdown/kit/utils';
import type { $Node, $Remark } from '@milkdown/utils';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Node as ProseMirrorNode, NodeType } from '@milkdown/prose/model';
import type { MarkdownNode, NodeSchema, ParserState, SerializerState } from '@milkdown/transformer';
import type { Root, RootContent, Code, Parent } from 'mdast';
import { visit } from 'unist-util-visit';
import mermaid from 'mermaid';

/**
 * Custom mdast node type for mermaid diagram blocks.
 */
interface MermaidDiagramNode {
  type: 'mermaidDiagram';
  value: string;
}

/**
 * Remark plugin that transforms code blocks with language "mermaid"
 * into custom mermaidDiagram mdast nodes.
 */
export const remarkMermaid: $Remark<'remarkMermaid', undefined> = $remark(
  'remarkMermaid',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      visit(
        tree,
        'code',
        (node: Code, index: number | undefined, parent: Parent | undefined): void => {
          if (index === undefined || !parent) return;

          // Check if this is a mermaid code block
          if (node.lang !== 'mermaid') return;

          // Create the mermaid diagram node
          const mermaidNode: MermaidDiagramNode = {
            type: 'mermaidDiagram',
            value: node.value,
          };

          // Replace the code block with our mermaid node
          (parent.children)[index] = mermaidNode as unknown as RootContent;
        },
      );

      return tree;
    },
);

/**
 * Counter for generating unique diagram IDs.
 */
let diagramIdCounter: number = 0;

/**
 * Default font family for mermaid diagrams.
 * Using system fonts that are reliably available.
 */
const MERMAID_FONT: string =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * CSS injected into mermaid diagrams.
 * The foreignObject element has a calculated size that can be slightly too small.
 * Setting overflow:visible allows the text to display fully.
 */
const MERMAID_THEME_CSS: string = `
  foreignObject { overflow: visible; }
  .nodeLabel { overflow: visible; }
`;

/**
 * Base mermaid configuration with settings to prevent text clipping.
 * Key fix: themeCSS ensures consistent font sizing during both measurement and render.
 *
 * @param isDark Whether to use the dark theme variant for the diagram.
 * @returns The mermaid initialization configuration object.
 */
function getMermaidConfig(isDark: boolean): Parameters<typeof mermaid.initialize>[0] {
  return {
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: MERMAID_FONT,
    // Inject CSS to ensure text sizing consistency
    themeCSS: MERMAID_THEME_CSS,
    // Flowchart configuration
    flowchart: {
      useMaxWidth: true,
      padding: 25,
      nodeSpacing: 50,
      rankSpacing: 50,
    },
    // Sequence diagram configuration
    sequence: {
      useMaxWidth: true,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
    },
    // State diagram configuration
    state: {
      useMaxWidth: true,
      padding: 20,
    },
    // Class diagram configuration
    class: {
      useMaxWidth: true,
      padding: 20,
    },
    // ER diagram configuration
    er: {
      useMaxWidth: true,
    },
    // Gantt chart configuration
    gantt: {
      useMaxWidth: true,
    },
    // Pie chart configuration
    pie: {
      useMaxWidth: true,
    },
    // Git graph configuration
    gitGraph: {
      useMaxWidth: true,
    },
    // Journey map configuration
    journey: {
      useMaxWidth: true,
    },
  };
}

/**
 * Initialize mermaid with default configuration.
 */
mermaid.initialize(getMermaidConfig(false));

/**
 * Updates mermaid theme based on the document's resolved colour scheme. The Theme service writes the
 * already-resolved mode (`light` or `dark`, never `system`) to the `data-theme-mode` attribute.
 */
function updateMermaidTheme(): void {
  const isDark: boolean = document.documentElement.getAttribute('data-theme-mode') === 'dark';
  mermaid.initialize(getMermaidConfig(isDark));
}

/**
 * Renders a mermaid diagram and returns the SVG.
 * Waits for document fonts to load before rendering to ensure accurate text measurement.
 *
 * @param code The mermaid diagram code.
 * @param id A unique ID for the diagram.
 * @returns The rendered SVG string, or an error message.
 */
export async function renderMermaidDiagram(code: string, id: string): Promise<string> {
  try {
    // Wait for fonts to load - critical for accurate text measurement
    // Without this, mermaid may calculate bounding boxes with fallback fonts
    // then render with the actual fonts, causing text clipping
    await document.fonts.ready;

    updateMermaidTheme();
    const { svg }: { svg: string } = await mermaid.render(id, code);
    return svg;
  } catch (error) {
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    return `<div class="mermaid-error">Error rendering diagram: ${message}</div>`;
  }
}

/**
 * ProseMirror node schema for Mermaid diagram blocks.
 */
export const mermaidNode: $Node = $node(
  'mermaid_diagram',
  (): NodeSchema => ({
    group: 'block',
    content: '',
    marks: '',
    defining: true,
    isolating: true,
    atom: true,
    attrs: {
      value: { default: '' },
    },
    parseDOM: [
      {
        tag: 'div[data-mermaid-diagram]',
        getAttrs: (dom: HTMLElement): { value: string } => ({
          value: dom.getAttribute('data-value') ?? '',
        }),
      },
    ],
    toDOM: (node: ProseMirrorNode): HTMLElement => {
      const value: string = node.attrs['value'] as string;
      const diagramId: string = `mermaid-${++diagramIdCounter}`;

      // Create wrapper element
      const wrapper: HTMLDivElement = document.createElement('div');
      wrapper.setAttribute('data-mermaid-diagram', 'true');
      wrapper.setAttribute('data-value', value);
      wrapper.className = 'mermaid-block rendered';

      // Create a container for the rendered diagram
      const content: HTMLDivElement = document.createElement('div');
      content.className = 'mermaid-content';
      content.innerHTML = '<div class="mermaid-loading">Loading diagram...</div>';
      wrapper.appendChild(content);

      // Render the diagram asynchronously
      void renderMermaidDiagram(value, diagramId).then((svg: string): void => {
        content.innerHTML = svg;
      });

      return wrapper;
    },
    parseMarkdown: {
      match: (node: MarkdownNode): boolean => {
        // Match our custom mermaidDiagram nodes (transformed from code blocks by remark plugin)
        return node.type === 'mermaidDiagram';
      },
      runner: (state: ParserState, node: MarkdownNode, type: NodeType): void => {
        const mermaidNode: MermaidDiagramNode = node as unknown as MermaidDiagramNode;
        state.addNode(type, { value: mermaidNode.value });
      },
    },
    toMarkdown: {
      match: (node: ProseMirrorNode): boolean => node.type.name === 'mermaid_diagram',
      runner: (state: SerializerState, node: ProseMirrorNode): void => {
        const code: string = node.attrs['value'] as string;
        state.addNode('code', undefined, code, { lang: 'mermaid' });
      },
    },
  }),
);

/**
 * All Mermaid diagram plugins combined.
 */
export const mermaidPlugin: MilkdownPlugin[] = [...remarkMermaid, mermaidNode];
