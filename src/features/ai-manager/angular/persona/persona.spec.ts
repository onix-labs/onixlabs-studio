import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Persona } from '@shared/angular/services/persona/persona';
import { drainMilkdownTimers } from '@shared/angular/testing/drain-milkdown-timers';
import { stubCrepeEnvironment } from '@shared/angular/testing/stub-crepe-environment';
import { AiLibraryCommands } from '../ai-library-commands/ai-library-commands';
import { PersonaSection } from './persona';
import {
  openSidebarSection,
  PersonaWithSidebar,
} from '../ai-manager-sidebar/ai-manager-sidebar.testing';
import { AiManagerSidebarState } from '../ai-manager-sidebar/ai-manager-sidebar-state';
import { AiManagerNavigation } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';

describe('PersonaSection (#1514)', () => {
  let fixture: ComponentFixture<PersonaWithSidebar>;
  let service: Persona;

  // A selected entry mounts a markdown field, a Crepe editor: jsdom needs the browser surface Crepe
  // reaches for, and the watchdogs Crepe arms must fire before the environment goes.
  beforeAll(stubCrepeEnvironment);
  afterAll(drainMilkdownTimers);

  afterEach(() => {
    fixture.destroy();
  });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PersonaSection] }).compileComponents();
    TestBed.inject(AiManagerNavigation).show('persona');
    fixture = TestBed.createComponent(PersonaWithSidebar);
    service = TestBed.inject(Persona);
    await fixture.whenStable();
    await openSidebarSection(fixture, 'Persona');
  });

  /**
   * Gets the section under test, inside its host.
   * @returns Returns the section, typed loosely so a spec can reach its protected members.
   */
  function section(): never {
    return fixture.debugElement
      .query(By.directive(PersonaSection))
      .injector.get(PersonaSection) as never;
  }

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
   * Gets the side panel's entry labels.
   * @returns Returns the labels.
   */
  function labels(): (string | undefined)[] {
    return entries().map((entry: HTMLButtonElement): string | undefined =>
      entry.textContent?.trim(),
    );
  }

  it('render_whenEmpty_saysSo_showsTheCoreMeter_andOffersBothKinds', () => {
    fixture.detectChanges();

    expect(element().querySelector('.library__empty-text')?.textContent).toContain(
      'Your persona is empty',
    );
    expect(element().querySelector('[data-testid="persona-core-meter"]')?.textContent).toContain(
      'Core: 0 of 12 lines',
    );
    const buttons: string[] = [...element().querySelectorAll('.library__empty button')].map(
      (button: Element): string => button.textContent?.trim() ?? '',
    );
    expect(buttons).toEqual(['New Memory', 'New Core Entry', 'Import']);
  });

  it('add_fromTheRibbon_createsAMemoryOrACoreEntryAndOpensItsEditor', async () => {
    fixture.detectChanges();
    const commands: AiLibraryCommands = TestBed.inject(AiLibraryCommands);

    commands.add('persona');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(service.memories()).toHaveLength(1);
    expect(element().querySelector('[data-testid="persona-editor"]')).not.toBeNull();

    commands.addCore('persona');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(service.core()).toHaveLength(1);
    expect(
      entries().find((entry) => entry.classList.contains('category-list__item--selected'))
        ?.textContent,
    ).toContain('New core entry');
  });

  it('sidePanel_listsTheCoreThenTheMemories_dimsThoseSwitchedOff_andMarksTheLocked', () => {
    service.create({ name: 'Trains', layer: 'memory' });
    service.update(service.create({ name: 'Terse' }).id, { enabled: false });
    service.update(service.create({ name: 'Unlocked', layer: 'memory' }).id, { locked: false });
    fixture.detectChanges();

    expect(labels()).toEqual(['Terse', 'Trains', 'Unlocked']);
    expect(entries()[0].classList.contains('category-list__item--muted')).toBe(true);
    expect(entries()[1].querySelector('.category-list__badge')).not.toBeNull();
    expect(entries()[2].querySelector('.category-list__badge')).toBeNull();
  });

  it('search_matchesTextAndTags_andAHashMatchesOneTagExactly', () => {
    service.create({ name: 'Trains', layer: 'memory', text: 'Prefers trains.', tags: ['travel'] });
    service.create({ name: 'Terse', text: 'Short replies.', tags: ['preferences'] });
    fixture.detectChanges();
    const query: AiManagerSidebarState['query'] =
      fixture.debugElement.injector.get(AiManagerSidebarState).query;

    query.set('short');
    fixture.detectChanges();
    expect(labels()).toEqual(['Terse']);

    query.set('#travel');
    fixture.detectChanges();
    expect(labels()).toEqual(['Trains']);
  });

  it('overview_listsTheTags_andATagNarrowsTheList', () => {
    service.create({ name: 'Trains', layer: 'memory', tags: ['travel'] });
    service.create({ name: 'Flights', layer: 'memory', tags: ['travel'] });
    service.create({ name: 'Terse', tags: ['preferences'] });
    fixture.detectChanges();

    const tags: HTMLButtonElement[] = [
      ...element().querySelectorAll<HTMLButtonElement>('.persona__tag'),
    ];
    expect(tags.map((tag) => tag.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '#travel 2',
      '#preferences 1',
    ]);

    tags[0].click();
    fixture.detectChanges();
    expect(labels()).toEqual(['Flights', 'Trains']);
  });

  it('meter_whenTheCoreIsOverItsLimit_warns', () => {
    service.create({
      name: 'Long',
      text: Array.from(
        { length: 13 },
        (_: unknown, index: number): string => `Rule ${index}.`,
      ).join('\n'),
    });
    fixture.detectChanges();

    const meter: Element | null = element().querySelector('[data-testid="persona-core-meter"]');
    expect(meter?.classList.contains('persona__meter--over')).toBe(true);
    expect(meter?.textContent).toContain('13 of 12 lines');
  });

  it('tags_areWrittenWhenTheFieldIsLeft_notAtEveryKeystroke', async () => {
    const created: { id: string } = service.create({ name: 'One', layer: 'memory' });
    fixture.detectChanges();
    entries()[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    const editor: { typeTags(text: string): void; commitTags(): void } = section();

    editor.typeTags('Travel, ');
    expect(service.find(created.id)?.tags).toEqual([]);
    editor.typeTags('Travel, Trains');
    editor.commitTags();

    expect(service.find(created.id)?.tags).toEqual(['travel', 'trains']);
  });

  it('delete_fromTheBinOnItsEntry_asksFirst_andOnlyRemovesOnConfirm', async () => {
    service.create({ name: 'One' });
    fixture.detectChanges();
    entries()[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog: { deleteTarget(): unknown; confirmDelete(): void; cancelDelete(): void } =
      section();

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    expect(dialog.deleteTarget()).not.toBeNull();
    dialog.cancelDelete();
    expect(service.entries()).toHaveLength(1);

    element().querySelector<HTMLButtonElement>('.category-list__action')?.click();
    dialog.confirmDelete();
    fixture.detectChanges();

    expect(service.entries()).toHaveLength(0);
    expect(element().querySelector('[data-testid="persona-editor"]')).toBeNull();
  });
});
