import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo } from '@shared/api/file-channels';
import { Documents } from '@shared/angular/services/documents/documents';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { drainMilkdownTimers } from '@shared/angular/testing/drain-milkdown-timers';

import { MarkdownDocumentPanel } from './markdown-document-panel';

/**
 * Hosts the panel behind a SCOPED Documents provider, mirroring the workspace view, which provides
 * its own Documents instance for its document well. The scoping is what the open-in-tab regression
 * hid behind: a single-instance test bed cannot tell the scoped instance from the root one.
 */
@Component({
  template: '<app-markdown-document-panel [documentId]="documentId" />',
  imports: [MarkdownDocumentPanel],
  providers: [Documents],
})
class ScopedWorkspaceHost {
  public documentId: string = '';
}

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

  // Milkdown's timer watchdogs cannot be cancelled; let them fire before the environment goes.
  afterAll(drainMilkdownTimers);

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

  it('openInTab_seedsTheRootDocuments_fromTheLiveScopedWellDocument', () => {
    // The regression, both halves. The well lives behind the workspace's SCOPED Documents while a
    // top-level markdown tab's view reads the ROOT instance — seeding the scoped one opened an
    // empty "New Document" tab. And the seed must be the live document's CURRENT content, not a
    // disk re-read, so a just-created file (still empty on disk) or unsaved edits carry over.
    const fixture: ComponentFixture<ScopedWorkspaceHost> =
      TestBed.createComponent(ScopedWorkspaceHost);
    const scopedDocuments: Documents = fixture.debugElement.injector.get(Documents);
    const rootDocuments: Documents = TestBed.inject(Documents);
    expect(scopedDocuments).not.toBe(rootDocuments);

    const fileInfo: FileInfo = {
      path: '/ws/notes.md',
      name: 'notes.md',
      extension: '.md',
      content: '# Saved content\n',
    };
    const wellId: string = scopedDocuments.createWellDocument(fileInfo);
    scopedDocuments.setContent(wellId, '# Edited but unsaved\n');
    fixture.componentInstance.documentId = wellId;
    fixture.detectChanges();

    const button: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Open in Tab"]',
    );
    expect(button).not.toBeNull();
    button?.click();

    const tab: Tab | undefined = TestBed.inject(Tabs).findByResource('markdown', '/ws/notes.md');
    expect(tab).toBeDefined();
    expect(tab?.id).not.toBe(wellId);
    expect(rootDocuments.initialContentOf(tab?.id ?? '')).toBe('# Edited but unsaved\n');

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
