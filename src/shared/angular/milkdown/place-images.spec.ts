import { Schema } from '@milkdown/kit/prose/model';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { placeImages } from './place-images';

/**
 * A document of paragraphs and inline images, enough for an image to land in.
 */
const schema: Schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', toDOM: (): ['p', 0] => ['p', 0] },
    text: { group: 'inline' },
    image: {
      group: 'inline',
      inline: true,
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: (): ['img'] => ['img'],
    },
  },
});

describe('placeImages', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy();
    }
  });

  /**
   * Builds an editor over an empty document.
   * @returns Returns the editor view.
   */
  function editor(): EditorView {
    const view: EditorView = new EditorView(document.createElement('div'), {
      state: EditorState.create({ schema }),
    });
    views.push(view);
    return view;
  }

  /**
   * Lists the sources of the images in a document.
   * @param view The editor view.
   * @returns Returns the image sources, in document order.
   */
  function imagesIn(view: EditorView): string[] {
    const sources: string[] = [];
    view.state.doc.descendants((node: ProseMirrorNode): void => {
      if (node.type.name === 'image') {
        sources.push(String(node.attrs['src']));
      }
    });
    return sources;
  }

  /**
   * Lets every settled store finish its work.
   * @returns Returns a promise that resolves on the next macrotask.
   */
  async function settled(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  const file: File = new File(['x'], 'shot.png', { type: 'image/png' });

  it('placeImages_insertsTheStoredSource', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();

    placeImages(
      view,
      [file],
      async (): Promise<string> => Promise.resolve('images/shot.png'),
      report,
    );
    await settled();

    expect(imagesIn(view)).toEqual(['images/shot.png']);
    expect(report).not.toHaveBeenCalled();
  });

  it('placeImages_whenStoringRejects_reportsItAndLeavesTheDocumentAlone', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();
    const failure: Error = new Error('disk full');

    placeImages(view, [file], async (): Promise<string> => Promise.reject(failure), report);
    await settled();

    expect(report).toHaveBeenCalledWith(file, failure);
    expect(imagesIn(view)).toEqual([]);
  });

  it('placeImages_whenOneImageFails_stillPlacesTheOthers', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();
    const bad: File = new File(['x'], 'bad.png', { type: 'image/png' });

    placeImages(
      view,
      [bad, file],
      async (image: File): Promise<string> =>
        image === bad ? Promise.reject(new Error('nope')) : Promise.resolve('good.png'),
      report,
    );
    await settled();

    expect(imagesIn(view)).toEqual(['good.png']);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('placeImages_whenTheImageCouldNotBeRead_insertsNoEmptyImage', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();

    placeImages(view, [file], async (): Promise<string> => Promise.resolve(''), report);
    await settled();

    expect(imagesIn(view)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('placeImages_afterTheEditorClosed_insertsNothingAndDoesNotThrow', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();
    let finish: (source: string) => void = (): void => undefined;
    const store: () => Promise<string> = async (): Promise<string> =>
      new Promise<string>((resolve: (source: string) => void): void => {
        finish = resolve;
      });

    placeImages(view, [file], store, report);
    view.destroy();
    finish('late.png');
    await settled();

    expect(report).not.toHaveBeenCalled();
  });

  it('placeImages_atAPositionPastTheEndOfAShrunkDocument_stillLands', async () => {
    const view: EditorView = editor();
    const report: Mock<(file: File, cause: unknown) => void> = vi.fn();

    placeImages(view, [file], async (): Promise<string> => Promise.resolve('a.png'), report, 999);
    await settled();

    expect(imagesIn(view)).toEqual(['a.png']);
  });
});
