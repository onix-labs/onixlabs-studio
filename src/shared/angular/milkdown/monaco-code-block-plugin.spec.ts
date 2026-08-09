import { Crepe } from '@milkdown/crepe';
import { createMonacoCodeBlockPlugin, MonacoCodeBlockDeps } from './monaco-code-block-plugin';

/**
 * Builds fake Monaco services for the node view: Monaco never "loads", so the view stays on its
 * placeholder path and never constructs a real editor (which jsdom could not host anyway).
 * @returns Returns the fake dependencies.
 */
function fakeDeps(): MonacoCodeBlockDeps {
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
