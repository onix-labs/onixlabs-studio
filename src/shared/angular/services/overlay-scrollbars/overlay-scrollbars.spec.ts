import { TestBed } from '@angular/core/testing';

import { OverlayScrollbars } from './overlay-scrollbars';

describe('OverlayScrollbars', () => {
  let service: OverlayScrollbars;
  let frame: HTMLIFrameElement;

  beforeEach(() => {
    service = TestBed.inject(OverlayScrollbars);
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
  });

  afterEach(() => {
    frame.remove();
  });

  /**
   * Gets the child document, as a pop-out or modal window's would be.
   * @returns Returns it.
   */
  function child(): Document {
    return frame.contentDocument!;
  }

  it('drawsOverTheMainWindow_fromTheStart', () => {
    expect(document.querySelectorAll('.app-scrollbars')).toHaveLength(1);
  });

  it('drawsOverAChildWindow_onceAttached', () => {
    service.attach(child());
    service.attach(child());

    expect(child().querySelectorAll('.app-scrollbars')).toHaveLength(1);
  });

  it('ignoresADocumentWithNoWindow', () => {
    const detached: Document = document.implementation.createHTMLDocument('detached');

    service.attach(detached);

    expect(detached.querySelector('.app-scrollbars')).toBeNull();
  });

  it('stopsDrawingOverAChildWindow_whenDetached', () => {
    service.attach(child());

    service.detach(child());

    expect(child().querySelector('.app-scrollbars')).toBeNull();
  });

  it('stopsDrawingEverywhere_withTheInjector', () => {
    service.attach(child());

    TestBed.resetTestingModule();

    expect(document.querySelector('.app-scrollbars')).toBeNull();
    expect(child().querySelector('.app-scrollbars')).toBeNull();
  });
});
