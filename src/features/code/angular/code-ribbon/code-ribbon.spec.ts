import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MenuContribution, MenuEntry } from '@shared/angular/services/app-menu/app-menu-model';
import { Documents } from '@shared/angular/services/documents/documents';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { Printing } from '@shared/angular/services/printing/printing';
import type { PrintResult } from '@shared/api/print-channels';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { CodeAgents } from '@features/code/angular/code-agents/code-agents';
import { CodeRunner } from '@features/code/angular/code-runner/code-runner';
import { Settings } from '@shared/angular/services/settings/settings';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { CodeRibbon } from './code-ribbon';
import { RememberLanguageChoice } from './remember-language-modal/remember-language-choice';
import type { RememberLanguageOffer } from './remember-language-modal/remember-language-offer';

/**
 * Exposes the protected members the language field is wired to, so the picker behaviour can be
 * exercised directly.
 */
interface CodeRibbonInternals {
  onLanguageChange(name: string): void;
  languageName(): string;
  languageOptions(): readonly string[];
  rememberOffer(): RememberLanguageOffer | undefined;
  onRememberChosen(choice: RememberLanguageChoice): void;
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
      goToSymbol: (): void => void calls.push('goToSymbol'),
      goToLine: (): void => void calls.push('goToLine'),
      formatDocument: (): void => void calls.push('format'),
    };
    const printingStub: Partial<Printing> = {
      print: (): Promise<PrintResult> => {
        calls.push('print');
        return Promise.resolve({ success: true });
      },
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
        { provide: ModalWindows, useValue: new FakeModalWindows() },
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

  describe('remembering a language chosen by hand (#1068)', () => {
    /**
     * Opens a file from disk in a code tab, and makes it the active one.
     * @param path The file's path.
     * @returns Returns the tab.
     */
    function openFile(path: string): Tab {
      const name: string = path.split('/').pop() ?? path;
      const dot: number = name.lastIndexOf('.');
      return documents.openFileInfo(
        { path, name, extension: dot > 0 ? name.slice(dot) : '', content: '{}' },
        'code',
      );
    }

    beforeEach((): void => {
      TestBed.inject(Settings).set('textEditor.fileAssociations', []);
    });

    it('offersToRemember_aLanguageTheRulesWouldNotGive', () => {
      const tab: Tab = openFile('/ws/data.foo');

      internals.onLanguageChange('JSON');

      expect(internals.rememberOffer()).toEqual({
        documentId: tab.id,
        path: '/ws/data.foo',
        fileName: 'data.foo',
        language: 'json',
        languageName: 'JSON',
        extensionPattern: '*.foo',
      });
    });

    it('offersNothing_forAnUntitledDocument_orALanguageTheRulesAlreadyGive', () => {
      const untitled: Tab = tabs.open('code');
      documents.ensure(untitled.id);
      internals.onLanguageChange('JSON');
      expect(internals.rememberOffer()).toBeUndefined();

      openFile('/ws/app.ts');
      internals.onLanguageChange('TypeScript');
      expect(internals.rememberOffer()).toBeUndefined();
    });

    it('thisFile_remembersThePath', () => {
      openFile('/ws/data.foo');
      internals.onLanguageChange('JSON');

      internals.onRememberChosen(RememberLanguageChoice.ThisFile);

      expect(TestBed.inject(Settings).get('textEditor.fileAssociations')).toEqual([
        { pattern: '/ws/data.foo', language: 'json' },
      ]);
      expect(internals.rememberOffer()).toBeUndefined();
    });

    it('extension_remembersTheEnding_inPlaceOfAnEntryForThisFile', () => {
      const settings: Settings = TestBed.inject(Settings);
      settings.set('textEditor.fileAssociations', [
        { pattern: '/ws/data.foo', language: 'yaml' },
        { pattern: 'Jenkinsfile', language: 'groovy' },
      ]);
      openFile('/ws/data.foo');
      internals.onLanguageChange('JSON');

      internals.onRememberChosen(RememberLanguageChoice.Extension);

      expect(settings.get('textEditor.fileAssociations')).toEqual([
        { pattern: 'Jenkinsfile', language: 'groovy' },
        { pattern: '*.foo', language: 'json' },
      ]);
    });

    it('none_remembersNothing_andKeepsTheTabsLanguage', () => {
      const tab: Tab = openFile('/ws/data.foo');
      internals.onLanguageChange('JSON');

      internals.onRememberChosen(RememberLanguageChoice.None);

      expect(TestBed.inject(Settings).get('textEditor.fileAssociations')).toEqual([]);
      expect(documents.get(tab.id)?.language()).toBe('json');
      expect(internals.rememberOffer()).toBeUndefined();
    });

    it('aLanguageOnlyAnAssociationGives_isNamedInTheField_andPlainTextCanBePickedBack', () => {
      // `apex` is not among Studio's own languages, and before Monaco loads it is not in the full
      // list either; the field must still name it rather than call it Plain Text.
      TestBed.inject(Settings).set('textEditor.fileAssociations', [
        { pattern: '*.cls', language: 'apex' },
      ]);
      const tab: Tab = openFile('/ws/Account.cls');
      TestBed.tick();
      expect(documents.get(tab.id)?.language()).toBe('apex');
      expect(internals.languageName()).toBe('apex');
      expect(internals.languageOptions()).toContain('apex');

      internals.onLanguageChange('Plain Text');

      expect(documents.get(tab.id)?.language()).toBe('plaintext');
    });

    it('extension_carriesTheLanguageToOtherOpenFilesWithTheEnding', async () => {
      const other: Tab = openFile('/ws/other.foo');
      openFile('/ws/data.foo');
      internals.onLanguageChange('JSON');

      internals.onRememberChosen(RememberLanguageChoice.Extension);
      await fixture.whenStable();
      TestBed.tick();

      expect(documents.get(other.id)?.language()).toBe('json');
    });
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

  it('goTo_fromTheRibbonOrTheMenu_routesToTheEditorCommands_withoutClaimingAChord', () => {
    // #1009: ⌘⇧O and ⌃G live in the editor; a menu accelerator would take Ctrl+G from a docked
    // terminal or composer.
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    documents.setLanguage(tab.id, 'typescript');
    fixture.detectChanges();
    button('Go to Symbol').click();
    button('Go to Line').click();
    menu.dispatch('code.goToSymbol');
    menu.dispatch('code.goToLine');

    expect(calls).toEqual(['goToSymbol', 'goToLine', 'goToSymbol', 'goToLine']);
    const goTo: readonly MenuEntry[] = menuItems('edit').filter(
      (entry: MenuEntry): boolean => entry.id === 'code.goToSymbol' || entry.id === 'code.goToLine',
    );
    expect(goTo.map((entry: MenuEntry): string | undefined => entry.accelerator)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('goToSymbol_forPlainText_isNotOffered_whileGoToLineIs', () => {
    const tab: Tab = tabs.open('code');
    documents.ensure(tab.id);
    fixture.detectChanges();

    const labels: string[] = Array.from(host.querySelectorAll('button')).map(
      (element: HTMLButtonElement): string => element.textContent.trim(),
    );
    expect(labels).toContain('Go to Line');
    expect(labels).not.toContain('Go to Symbol');
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
