import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { EditorSearch } from '@shared/angular/components/search-view/editor-search';
import { ApiFind } from '../../api-find/api-find';
import { ApiFindPanel } from './api-find-panel';

describe('ApiFindPanel', () => {
  let fixture: ComponentFixture<ApiFindPanel>;
  let hasTarget: WritableSignal<boolean>;
  let host: HTMLElement;

  beforeEach(async () => {
    hasTarget = signal<boolean>(true);
    const search: EditorSearch = new EditorSearch({
      mainEditor: (): MonacoApi.editor.ICodeEditor | null => null,
      labelOf: (): string => '',
    });
    await TestBed.configureTestingModule({
      imports: [ApiFindPanel],
      providers: [{ provide: ApiFind, useValue: { search, hasTarget } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ApiFindPanel);
    fixture.componentRef.setInput('panel', { id: 'find' });
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  it('render_withABodyToSearch_showsTheSearch', () => {
    expect(host.querySelector('app-search-view:not(.api-find__view--hidden)')).not.toBeNull();
    expect(host.querySelector('.api-find__hint')).toBeNull();
  });

  it('render_withNothingToSearch_saysSo_andKeepsTheSearchMounted', async () => {
    const view: Element | null = host.querySelector('app-search-view');

    hasTarget.set(false);
    await fixture.whenStable();

    expect(host.querySelector('.api-find__hint')?.textContent).toContain('no body open to search');
    expect(host.querySelector('app-search-view.api-find__view--hidden')).toBe(view);
  });
});
