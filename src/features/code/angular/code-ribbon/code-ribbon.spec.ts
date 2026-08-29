import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import { Documents } from '@shared/angular/services/documents/documents';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { Printing } from '@shared/angular/services/printing/printing';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { CodeRunner } from '@features/code/angular/code-runner/code-runner';
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
  let host: HTMLElement;
  let menu: AppMenu;
  let documents: Documents;
  let tabs: Tabs;
  let calls: string[];

  /**
   * Finds a ribbon button by its visible label.
   * @param label The button label.
   * @returns Returns the matching button element.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  /**
   * Reads the entries the ribbon contributes to a menu section.
   * @param id The section id.
   * @returns Returns the section's entries.
   */
  function menuItems(id: string): readonly MenuEntry[] {
    return (
      menu.sections().find((section: MenuContribution): boolean => section.id === id)?.items ?? []
    );
  }

  beforeEach(async () => {
    calls = [];
    const commandsStub: Partial<EditorCommands> = {
      cut: (): void => void calls.push('cut'),
      copy: (): void => void calls.push('copy'),
      paste: (): void => void calls.push('paste'),
      undo: (): void => void calls.push('undo'),
      redo: (): void => void calls.push('redo'),
      find: (): void => void calls.push('find'),
      formatDocument: (): void => void calls.push('format'),
    };
    const printingStub: Partial<Printing> = {
      print: (): void => void calls.push('print'),
      exportPdf: (name: string): Promise<never> => {
        calls.push(`exportPdf:${name}`);
        return Promise.resolve() as Promise<never>;
      },
    };
    const runnerStub: Partial<CodeRunner> = {
      canRun: (language: string): boolean => language.length > 0,
      run: (id: string, language: string): Promise<void> => {
        calls.push(`run:${id}:${language}`);
        return Promise.resolve();
      },
    };
    const terminalsStub: Partial<EditorTerminals> = {
      toggle: (id: string): void => void calls.push(`terminal:${id}`),
    };
    const agentsStub: Partial<CodeAgents> = {
      toggle: (id: string): void => void calls.push(`agent:${id}`),
    };

    await TestBed.configureTestingModule({
      imports: [CodeRibbon],
      providers: [
        { provide: EditorCommands, useValue: commandsStub },
        { provide: Printing, useValue: printingStub },
        { provide: CodeRunner, useValue: runnerStub },
        { provide: EditorTerminals, useValue: terminalsStub },
        { provide: CodeAgents, useValue: agentsStub },
      ],
    }).compileComponents();

    documents = TestBed.inject(Documents);
    tabs = TestBed.inject(Tabs);
    menu = TestBed.inject(AppMenu);
    fixture = TestBed.createComponent(CodeRibbon);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    internals = component as unknown as CodeRibbonInternals;
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
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

  it('buttons_whenPressed_routeToTheEditorCommands', () => {
    button('Cut').click();
    button('Copy').click();
    button('Paste').click();
    button('Undo').click();
    button('Redo').click();
    button('Find').click();
    button('Format').click();
    button('Print').click();

    expect(calls).toEqual(['cut', 'copy', 'paste', 'undo', 'redo', 'find', 'format', 'print']);
  });

  it('menu_whenAnEditCommandIsChosen_runsTheSameHandlerAsTheRibbon', () => {
    // Undo, Redo, Cut, Copy and Paste are deliberately not on the menu: the core carries them as
    // native roles, and a feature entry claiming one of those accelerators takes the chord from
    // every other control on the tab. Guarded by editing-chords.contract.spec.ts.
    menu.dispatch('code.find');
    menu.dispatch('code.format');

    expect(calls).toEqual(['find', 'format']);
  });

  it('menu_whenPrintOrExportIsChosen_reachesPrinting', () => {
    menu.dispatch('code.print');
    menu.dispatch('code.exportPdf');

    expect(calls[0]).toBe('print');
    expect(calls[1]?.startsWith('exportPdf:')).toBe(true);
  });

  it('editMenu_whenContributed_leavesTheClipboardChordsToTheCore', () => {
    // The core binds Cut/Copy/Paste as focus-routed roles; this ribbon must not claim those chords, or
    // pasting into a docked panel on a code tab would land in the editor instead.
    const claimed: readonly (string | undefined)[] = menuItems('edit')
      .filter((entry: MenuEntry): boolean => entry.id?.startsWith('code.') === true)
      .map((entry: MenuEntry): string | undefined => entry.accelerator);

    expect(claimed).not.toContain('CmdOrCtrl+X');
    expect(claimed).not.toContain('CmdOrCtrl+C');
    expect(claimed).not.toContain('CmdOrCtrl+V');
  });

  it('run_whenATabAndDocumentAreActive_runsTheDocument', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setLanguage(tab.id, 'typescript');
    fixture.detectChanges();

    // The Run control is labelled Start, and is disabled for a language the runner cannot run.
    button('Start').click();

    expect(calls).toEqual([`run:${tab.id}:typescript`]);
  });

  it('terminalAndAgent_whenPressed_toggleTheDockedPanelsForTheActiveTab', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    fixture.detectChanges();

    button('Terminal').click();
    button('Agent').click();

    expect(calls).toEqual([`terminal:${tab.id}`, `agent:${tab.id}`]);
  });

  it('save_whenPressed_savesTheActiveDocument', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setContent(tab.id, 'const answer = 42;');
    fixture.detectChanges();

    // Saving an untitled document routes through the save-as prompt rather than writing blind.
    expect((): void => button('Save').click()).not.toThrow();
  });
});
