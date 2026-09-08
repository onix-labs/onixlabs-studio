import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo } from '@shared/api/file-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

import { MarkdownDocumentPanel } from './markdown-document-panel';

describe('MarkdownDocumentPanel', () => {
  beforeAll(() => {
    // jsdom lacks the observers the panel's embedded Crepe editor reaches for; stub them so a boot
    // failure is our bug, not a missing browser API.
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownDocumentPanel],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Crepe editor is not booted:
  // the WYSIWYG editor depends on browser layout APIs that the jsdom test environment does not
  // provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ComponentFixture<MarkdownDocumentPanel> =
      TestBed.createComponent(MarkdownDocumentPanel);
    fixture.componentRef.setInput('documentId', 'test-document');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('openInTab_seedsTheTabFromTheLiveDocument_notFromDisk', () => {
    // The regression: opening in a tab re-read the file over IPC, so a just-created file (still
    // empty on disk) or one holding unsaved edits opened an empty tab. The tab must carry the well
    // document's CURRENT content.
    const documents: Documents = TestBed.inject(Documents);
    const fileInfo: FileInfo = {
      path: '/ws/notes.md',
      name: 'notes.md',
      extension: '.md',
      content: '# Saved content\n',
    };
    const wellId: string = documents.createWellDocument(fileInfo);
    documents.setContent(wellId, '# Edited but unsaved\n');

    const fixture: ComponentFixture<MarkdownDocumentPanel> =
      TestBed.createComponent(MarkdownDocumentPanel);
    fixture.componentRef.setInput('documentId', wellId);
    fixture.detectChanges();

    const button: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Open in Tab"]',
    );
    expect(button).not.toBeNull();
    button?.click();

    const tab: Tab | undefined = TestBed.inject(Tabs).findByResource('markdown', '/ws/notes.md');
    expect(tab).toBeDefined();
    expect(tab?.id).not.toBe(wellId);
    expect(documents.initialContentOf(tab?.id ?? '')).toBe('# Edited but unsaved\n');

    fixture.destroy();
  });

  it('openInTabButton_isHidden_whenTheDocumentHasNoFilePath', () => {
    const documents: Documents = TestBed.inject(Documents);
    documents.ensure('pathless-doc', 'New Document');

    const fixture: ComponentFixture<MarkdownDocumentPanel> =
      TestBed.createComponent(MarkdownDocumentPanel);
    fixture.componentRef.setInput('documentId', 'pathless-doc');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Open in Tab"]'),
    ).toBeNull();
    fixture.destroy();
  });
});
