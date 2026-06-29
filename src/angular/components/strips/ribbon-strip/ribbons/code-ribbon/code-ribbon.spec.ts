import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Documents } from '../../../../../services/documents/documents';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { CodeRibbon } from './code-ribbon';

/**
 * Exposes the protected members the language field is wired to, so the picker behaviour can be
 * exercised directly.
 */
interface CodeRibbonInternals {
  onLanguageChange(name: string): void;
  languageName(): string;
}

describe('CodeRibbon', () => {
  let component: CodeRibbon;
  let internals: CodeRibbonInternals;
  let fixture: ComponentFixture<CodeRibbon>;
  let documents: Documents;
  let tabs: Tabs;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeRibbon],
    }).compileComponents();

    documents = TestBed.inject(Documents);
    tabs = TestBed.inject(Tabs);
    fixture = TestBed.createComponent(CodeRibbon);
    component = fixture.componentInstance;
    internals = component as unknown as CodeRibbonInternals;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('onLanguageChange_whenLanguagePicked_setsActiveDocumentLanguage', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);

    internals.onLanguageChange('TypeScript');

    expect(documents.get(tab.id)?.language()).toBe('typescript');
  });

  it('languageName_whenDocumentCreatedAfterFirstRead_reflectsItsLanguage', () => {
    const tab: Tab = tabs.open('code');
    // The ribbon renders before the code view materialises the document, so the field starts on the
    // plain-text fallback; it must then track the lazily-created document and its language.
    expect(internals.languageName()).toBe('Plain Text');

    documents.ensure(tab.id);
    documents.setLanguage(tab.id, 'typescript');

    expect(internals.languageName()).toBe('TypeScript');
  });
});
