import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '../../../services/dock/dock-panel';
import { StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { firstStackOfRole } from '../../../services/dock/dock-tree';
import { Documents } from '../../../services/documents/documents';
import { FileInfo } from '../../../../shared/studio-api';
import { Icon } from '@shared/angular/icons/icon';

import { DocumentPanel } from './document-panel';

/**
 * Builds a dock panel descriptor for a document id.
 */
function panelFor(id: string): DockPanel {
  return { id, title: id, icon: Icon.CODE, role: 'document', component: DocumentPanel };
}

/**
 * Builds a file with the given name/extension.
 */
function fileInfo(path: string, extension: string): FileInfo {
  return { path, name: path.split('/').pop() ?? path, extension, content: 'x' };
}

describe('DocumentPanel', () => {
  let component: DocumentPanel;
  let fixture: ComponentFixture<DocumentPanel>;
  let documents: Documents;
  let dockState: DockState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentPanel],
    }).compileComponents();

    documents = TestBed.inject(Documents);
    dockState = TestBed.inject(DockState);
    fixture = TestBed.createComponent(DocumentPanel);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('panel', panelFor('doc-x'));
    expect(component).toBeTruthy();
  });

  it('isMarkdown_whenMarkdownDocument_returnsTrue', () => {
    const id: string = documents.createWellDocument(fileInfo('/ws/a.md', '.md'));
    fixture.componentRef.setInput('panel', panelFor(id));
    expect(component.isMarkdown()).toBe(true);
  });

  it('isMarkdown_whenCodeDocument_returnsFalse', () => {
    const id: string = documents.createWellDocument(fileInfo('/ws/a.ts', '.ts'));
    fixture.componentRef.setInput('panel', panelFor(id));
    expect(component.isMarkdown()).toBe(false);
  });

  it('isActive_whenActiveInTheWell_returnsTrue', () => {
    const id: string = documents.createWellDocument(fileInfo('/ws/a.ts', '.ts'));
    const well: StackNode | null = firstStackOfRole(dockState.layout(), 'document');
    dockState.tabInto(well!.id, id);
    fixture.componentRef.setInput('panel', panelFor(id));
    expect(component.isActive()).toBe(true);
  });
});
