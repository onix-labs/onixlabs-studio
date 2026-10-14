import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AGENT_SURFACE_LABELS, AGENT_SURFACES } from '@shared/api/ai-types';
import { PromptProfiles } from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { drainMilkdownTimers } from '@shared/angular/testing/drain-milkdown-timers';
import { stubCrepeEnvironment } from '@shared/angular/testing/stub-crepe-environment';
import { AiLibraryCommands } from '../ai-library-commands/ai-library-commands';
import { PromptProfilesSection } from './prompt-profiles';

describe('PromptProfilesSection', () => {
  let fixture: ComponentFixture<PromptProfilesSection>;
  let service: PromptProfiles;

  // A selected profile mounts a markdown field, a Crepe editor: jsdom needs the browser
  // surface Crepe reaches for, and the watchdogs Crepe arms must fire before the environment goes.
  beforeAll(stubCrepeEnvironment);
  afterAll(drainMilkdownTimers);

  afterEach(() => {
    fixture.destroy();
  });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PromptProfilesSection] }).compileComponents();
    fixture = TestBed.createComponent(PromptProfilesSection);
    service = TestBed.inject(PromptProfiles);
    await fixture.whenStable();
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Gets the side panel's entries.
   * @returns Returns the entry buttons.
   */
  function entries(): HTMLButtonElement[] {
    return [...element().querySelectorAll<HTMLButtonElement>('.category-list__item')];
  }

  /**
   * Selects the first profile in the side panel and lets its editor render.
   * @returns Resolves once the editor is rendered.
   */
  async function selectFirst(): Promise<void> {
    entries()[0]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('render_whenEmpty_saysSo_andOffersNewProfile', () => {
    fixture.detectChanges();

    expect(element().querySelector('.library__empty-text')?.textContent).toContain(
      'No prompt profiles yet',
    );
    expect(element().querySelector('.library__editor')).toBeNull();
    expect(element().querySelector('.library__empty button')?.textContent).toContain('New Profile');
  });

  it('add_fromTheRibbon_createsAProfileAndOpensItsEditor', async () => {
    fixture.detectChanges();

    TestBed.inject(AiLibraryCommands).add('profiles');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(service.profiles()).toHaveLength(1);
    expect(entries()).toHaveLength(1);
    expect(entries()[0].classList.contains('category-list__item--selected')).toBe(true);
    // One text: the profile's instructions. The hidden per-message layer is gone (#948).
    expect(element().querySelectorAll('.library__editor app-markdown-field')).toHaveLength(1);
  });

  it('sidePanel_listsTheProfiles_dimsThoseSwitchedOff_andSearchNarrowsThem', () => {
    service.create('House style');
    service.update(service.create('Terse').id, { enabled: false });
    fixture.detectChanges();

    expect(entries().map((entry) => entry.textContent?.trim())).toEqual(['House style', 'Terse']);
    expect(entries()[1].classList.contains('category-list__item--muted')).toBe(true);

    const search: HTMLInputElement = element().querySelector('.category-list__search input')!;
    search.value = 'ters';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(entries().map((entry) => entry.textContent?.trim())).toEqual(['Terse']);
  });

  it('select_showsItsSurfacesInTheScopePicker', async () => {
    service.update(service.create('One').id, { scope: { surfaces: ['terminal'], languages: [] } });
    fixture.detectChanges();
    await selectFirst();

    // The surfaces picker is the first multi-select in the editor; its face names what is ticked.
    const faces: NodeListOf<HTMLButtonElement> = element().querySelectorAll<HTMLButtonElement>(
      '.library__editor app-multi-select .multi-select',
    );
    expect(faces).toHaveLength(2);
    expect(faces[0].textContent?.trim()).toBe(AGENT_SURFACE_LABELS.terminal);

    faces[0].click();
    TestBed.tick();
    expect(document.querySelectorAll('.multi-select__option')).toHaveLength(AGENT_SURFACES.length);
  });

  it('delete_fromTheBinOnItsEntry_asksFirst_andOnlyRemovesOnConfirm', async () => {
    service.create('One');
    fixture.detectChanges();
    await selectFirst();
    const dialog: { deleteTarget(): unknown; confirmDelete(): void; cancelDelete(): void } =
      fixture.componentInstance as unknown as {
        deleteTarget(): unknown;
        confirmDelete(): void;
        cancelDelete(): void;
      };
    // No Delete at the foot of the editor any more; it is the bin on the entry.
    expect(element().querySelector('.library__footer')).toBeNull();

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    expect(dialog.deleteTarget()).not.toBeNull();
    dialog.cancelDelete();
    expect(service.profiles()).toHaveLength(1);

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    dialog.confirmDelete();
    fixture.detectChanges();

    expect(service.profiles()).toHaveLength(0);
    expect(element().querySelector('.library__editor')).toBeNull();
  });
});
