import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { ApiExplorerCommands } from '@features/api-explorer/angular/api-explorer-commands/api-explorer-commands';
import { ApiExplorerRibbon } from './api-explorer-ribbon';

/**
 * Exposes the protected members the Save menu button is wired to, so its dropdown variants can be
 * exercised without opening the overlay.
 */
interface ApiExplorerRibbonInternals {
  onSaveVariant(id: string): void;
}

describe('ApiExplorerRibbon', () => {
  let component: ApiExplorerRibbon;
  let internals: ApiExplorerRibbonInternals;
  let fixture: ComponentFixture<ApiExplorerRibbon>;
  let host: HTMLElement;
  let menu: AppMenu;
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

  beforeEach(async () => {
    calls = [];
    const commandsStub: Partial<ApiExplorerCommands> = {
      send: (): void => void calls.push('send'),
      saveDocument: (): void => void calls.push('save'),
      saveDocumentAs: (): void => void calls.push('saveAs'),
      newRequest: (): void => void calls.push('newRequest'),
      newCollection: (): void => void calls.push('newCollection'),
      newEnvironment: (): void => void calls.push('newEnvironment'),
      cycleEnvironment: (): void => void calls.push('cycleEnvironment'),
    };

    await TestBed.configureTestingModule({
      imports: [ApiExplorerRibbon],
      providers: [{ provide: ApiExplorerCommands, useValue: commandsStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiExplorerRibbon);
    component = fixture.componentInstance;
    internals = component as unknown as ApiExplorerRibbonInternals;
    host = fixture.nativeElement as HTMLElement;
    menu = TestBed.inject(AppMenu);
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.tick();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('buttons_whenPressed_addTheChosenKindOfDocument', () => {
    button('Request').click();
    button('Collection').click();
    button('Environment').click();

    expect(calls).toEqual(['newRequest', 'newCollection', 'newEnvironment']);
  });

  it('saveVariant_whenSaveAsIsChosen_promptsForADestination', () => {
    internals.onSaveVariant('save-as');

    expect(calls).toEqual(['saveAs']);
  });

  it('saveVariant_whenAnUnknownVariantIsChosen_savesInPlace', () => {
    // The dropdown is authored alongside the handler, so an unrecognised id means a plain save rather
    // than nothing happening.
    internals.onSaveVariant('something-else');

    expect(calls).toEqual(['save']);
  });

  it('menu_whenACommandIsChosen_runsTheSameHandlerAsTheRibbon', () => {
    menu.dispatch('api.save');
    menu.dispatch('api.newRequest');
    menu.dispatch('api.newCollection');
    menu.dispatch('api.newEnvironment');

    expect(calls).toEqual(['save', 'newRequest', 'newCollection', 'newEnvironment']);
  });
});
