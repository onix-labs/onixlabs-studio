import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';

import { MarkdownEditor } from './markdown-editor';

/**
 * Boots a markdown-editor fixture with the given content and waits for its Crepe editor to become
 * ready, counting ready emissions and captured content changes for the assertions.
 * @param content The initial markdown content.
 * @returns Returns the fixture and the captured output events.
 */
async function bootEditor(content: string): Promise<{
  fixture: ComponentFixture<MarkdownEditor>;
  readyCount: () => number;
  contentChanges: string[];
  saveRequests: () => number;
}> {
  const fixture: ComponentFixture<MarkdownEditor> = TestBed.createComponent(MarkdownEditor);
  fixture.componentRef.setInput('content', content);
  let ready: number = 0;
  let saves: number = 0;
  const contentChanges: string[] = [];
  fixture.componentInstance.ready.subscribe((): void => {
    ready++;
  });
  fixture.componentInstance.contentChange.subscribe((markdown: string): void => {
    contentChanges.push(markdown);
  });
  fixture.componentInstance.saveRequested.subscribe((): void => {
    saves++;
  });
  fixture.detectChanges();
  await vi.waitFor((): void => {
    expect(ready).toBeGreaterThan(0);
  });
  return {
    fixture,
    readyCount: (): number => ready,
    contentChanges,
    saveRequests: (): number => saves,
  };
}

/**
 * Waits long enough for the listener plugin's debounced `markdownUpdated` to have fired, so a test
 * can assert an emission did NOT happen.
 * @returns Returns a promise resolving after the debounce window.
 */
function afterDebounce(): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, 500);
  });
}

describe('MarkdownEditor', () => {
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

    // jsdom's Range has no client-rect geometry; the virtual-cursor plugin asks for it whenever the
    // selection moves with focus. Empty rects keep it happy without layout.
    Object.assign(Range.prototype, {
      getClientRects: (): DOMRectList => [] as unknown as DOMRectList,
      getBoundingClientRect: (): DOMRect => new DOMRect(0, 0, 0, 0),
    });
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownEditor],
    }).compileComponents();
  });

  it('create_whenConstructed_returnsComponent', () => {
    const component: MarkdownEditor = TestBed.createComponent(MarkdownEditor).componentInstance;
    expect(component).toBeTruthy();
    expect(component.getCrepe()).toBeNull();
    expect(component.getEditorView()).toBeNull();
    expect(component.getMarkdown()).toBe('');
  });

  it('boot_emitsReady_andServesTheContent', async () => {
    const { fixture, readyCount } = await bootEditor('# Title\n\nBody\n');
    expect(readyCount()).toBe(1);
    expect(fixture.componentInstance.getMarkdown()).toBe('# Title\n\nBody\n');
    expect(fixture.componentInstance.getEditorView()).not.toBeNull();
    fixture.destroy();
  });

  it('boot_withNormalisingContent_doesNotReportAFalseEdit', async () => {
    // Parsing `- one` restyles the marker to `* one`. The debounced init update carries that
    // normalised serialisation after creation; reporting it would falsely dirty the document and
    // rewrite the file on a no-edit save.
    const { fixture, contentChanges } = await bootEditor('- one\n- two\n');
    await afterDebounce();
    expect(contentChanges).toEqual([]);
    // The editor appends an empty trailing paragraph below the list (the click target below the
    // content), which serialises as a trailing blank line; the content itself must be unchanged.
    expect(fixture.componentInstance.getMarkdown().trimEnd()).toBe('* one\n* two');
    fixture.destroy();
  });

  it('edit_emitsTheSerialisedMarkdown_withoutRecreatingTheEditor', async () => {
    const { fixture, readyCount, contentChanges } = await bootEditor('start\n');
    fixture.componentInstance.getCrepe()?.editor.action((ctx: Ctx): void => {
      const view: EditorView = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText('typed ', 1));
    });
    await vi.waitFor((): void => {
      expect(contentChanges).toEqual(['typed start\n']);
    });
    // The host writes the emitted markdown back into the content input; the handshake must swallow
    // that echo instead of destroying and recreating the editor mid-typing.
    fixture.componentRef.setInput('content', 'typed start\n');
    fixture.detectChanges();
    await afterDebounce();
    expect(readyCount()).toBe(1);
    fixture.destroy();
  });

  it('externalContentChange_recreatesTheEditor_withTheNewContent', async () => {
    const { fixture, readyCount } = await bootEditor('original\n');
    fixture.componentRef.setInput('content', 'replaced\n');
    fixture.detectChanges();
    await vi.waitFor((): void => {
      expect(readyCount()).toBe(2);
    });
    expect(fixture.componentInstance.getMarkdown()).toBe('replaced\n');
    fixture.destroy();
  });

  it('saveChord_emitsSaveRequested_andConsumesTheEvent', async () => {
    const { fixture, saveRequests } = await bootEditor('content\n');
    const container: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.editor-container',
    );
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    container?.querySelector('.ProseMirror')?.dispatchEvent(event);
    expect(saveRequests()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    fixture.destroy();
  });

  it('replaceAll_swapsTheDocument_inOneUndoableStep', async () => {
    const { fixture } = await bootEditor('before\n');
    fixture.componentInstance.replaceAll('# After\n');
    expect(fixture.componentInstance.getMarkdown()).toBe('# After\n');
    fixture.destroy();
  });
});
