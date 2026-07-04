import { fileToDataUrl, installImageResolver } from './media-source';

describe('media-source', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  /**
   * Adds an image with the given source to the container and returns it.
   */
  function addImage(source: string): HTMLImageElement {
    const image: HTMLImageElement = document.createElement('img');
    image.setAttribute('src', source);
    container.appendChild(image);
    return image;
  }

  it('install_whenLocalRelativeSource_rewritesItToTheMediaSchemeAgainstTheDirectory', () => {
    const image: HTMLImageElement = addImage('./pics/photo.png');

    const dispose: () => void = installImageResolver(container, (): string => '/docs/notes');
    dispose();

    const source: string = image.getAttribute('src') ?? '';
    expect(source.startsWith('studio-media://image/?')).toBe(true);
    expect(source).toContain(`dir=${encodeURIComponent('/docs/notes')}`);
    expect(source).toContain(`src=${encodeURIComponent('./pics/photo.png')}`);
  });

  it('install_whenAbsoluteLocalSource_rewritesItToTheMediaScheme', () => {
    const image: HTMLImageElement = addImage('/Users/matthew/pics/logo.png');

    installImageResolver(container, (): string => '')();

    expect(image.getAttribute('src')?.startsWith('studio-media://image/?')).toBe(true);
  });

  it('install_whenAlreadyDisplayableSource_leavesItUntouched', () => {
    const remote: HTMLImageElement = addImage('https://example.com/a.png');
    const data: HTMLImageElement = addImage('data:image/png;base64,AAAA');
    const blob: HTMLImageElement = addImage('blob:abc');

    installImageResolver(container, (): string => '/docs')();

    expect(remote.getAttribute('src')).toBe('https://example.com/a.png');
    expect(data.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(blob.getAttribute('src')).toBe('blob:abc');
  });

  it('install_whenAnImageIsAddedLater_rewritesItToo', async () => {
    const dispose: () => void = installImageResolver(container, (): string => '/docs');

    const image: HTMLImageElement = addImage('./later.png');
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    dispose();

    expect(image.getAttribute('src')?.startsWith('studio-media://image/?')).toBe(true);
  });

  it('fileToDataUrl_whenGivenAFile_resolvesToADataUrl', async () => {
    const file: File = new File(['hello'], 'note.txt', { type: 'text/plain' });

    const url: string = await fileToDataUrl(file);

    expect(url.startsWith('data:')).toBe(true);
  });
});
