import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { RememberLanguageChoice } from './remember-language-choice';
import { RememberLanguageModal } from './remember-language-modal';
import type { RememberLanguageOffer } from './remember-language-offer';

/**
 * An offer for a file with an ending.
 */
const OFFER: RememberLanguageOffer = {
  documentId: 'tab-1',
  path: '/ws/data.foo',
  fileName: 'data.foo',
  language: 'json',
  languageName: 'JSON',
  extensionPattern: '*.foo',
};

describe('RememberLanguageModal', () => {
  let fixture: ComponentFixture<RememberLanguageModal>;
  let windows: FakeModalWindows;
  let answers: RememberLanguageChoice[];

  /**
   * Shows the modal for an offer.
   * @param offer The offer.
   */
  async function show(offer: RememberLanguageOffer): Promise<void> {
    fixture = TestBed.createComponent(RememberLanguageModal);
    fixture.componentRef.setInput('offer', offer);
    fixture.componentInstance.chosen.subscribe((choice: RememberLanguageChoice): void => {
      answers.push(choice);
    });
    await fixture.whenStable();
  }

  /**
   * Finds one of the modal's elements.
   * @param testId Its test id.
   * @returns Returns the element, or null.
   */
  function find(testId: string): HTMLElement | null {
    return windows.contentHost?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
  }

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    answers = [];
    await TestBed.configureTestingModule({
      imports: [RememberLanguageModal],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();
  });

  it('asksAboutTheFileAndTheLanguage', async (): Promise<void> => {
    await show(OFFER);

    expect(find('remember-language-question')?.textContent).toContain('Open data.foo in JSON');
    expect(find('remember-language-question')?.textContent).toContain('every *.foo file');
    expect(find('remember-language-extension')?.textContent).toContain('All *.foo Files');
  });

  it.each([
    ['remember-language-file', RememberLanguageChoice.ThisFile],
    ['remember-language-extension', RememberLanguageChoice.Extension],
    ['remember-language-none', RememberLanguageChoice.None],
  ])('clicking %s_answers %s', async (testId: string, choice: RememberLanguageChoice) => {
    await show(OFFER);

    find(testId)?.querySelector('button')?.click();

    expect(answers).toEqual([choice]);
  });

  it('closingTheWindow_remembersNothing', async (): Promise<void> => {
    await show(OFFER);

    windows.notifyClosed();

    expect(answers).toEqual([RememberLanguageChoice.None]);
  });

  it('theActions_stepDownFromSolidToGhostToNone', async (): Promise<void> => {
    await show(OFFER);

    expect(find('remember-language-file')?.classList.contains('button--solid')).toBe(true);
    expect(find('remember-language-extension')?.classList.contains('button--ghost')).toBe(true);
    expect(find('remember-language-none')?.classList.contains('button--none')).toBe(true);
  });

  it('forAFileWithNoEnding_offersThisFileOnly', async (): Promise<void> => {
    await show({ ...OFFER, fileName: 'Jenkinsfile', extensionPattern: undefined });

    expect(find('remember-language-extension')).toBeNull();
    expect(find('remember-language-question')?.textContent).not.toContain('every');
    expect(find('remember-language-file')).not.toBeNull();
  });
});
