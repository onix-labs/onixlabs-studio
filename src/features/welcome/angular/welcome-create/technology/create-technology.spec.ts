import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateTechnology } from './create-technology';
import { Technology } from './technology-catalogue';

/**
 * Builds a technology.
 * @param id Its id.
 * @param name Its name.
 * @param category Its category.
 * @param aliases Its aliases.
 * @returns Returns it.
 */
function technology(
  id: string,
  name: string,
  category: Technology['category'],
  aliases: readonly string[] = [],
): Technology {
  return { id, name, category, description: `About ${name}`, aliases, local: false };
}

const CATALOGUE: readonly Technology[] = [
  technology('csharp', 'C#', 'languages'),
  technology('go', 'Go', 'languages', ['golang']),
  technology('postgresql', 'PostgreSQL', 'databases', ['postgres']),
  technology('redis', 'Redis', 'caching'),
];

describe('CreateTechnology', () => {
  let fixture: ComponentFixture<CreateTechnology>;
  let host: HTMLElement;
  let toggled: string[];
  let added: string[];

  beforeEach(async () => {
    toggled = [];
    added = [];
    await TestBed.configureTestingModule({ imports: [CreateTechnology] }).compileComponents();
    fixture = TestBed.createComponent(CreateTechnology);
    fixture.componentRef.setInput('technologies', CATALOGUE);
    fixture.componentRef.setInput('selected', new Set<string>(['csharp']));
    fixture.componentInstance.toggled.subscribe((id: string): void => {
      toggled.push(id);
    });
    fixture.componentInstance.added.subscribe((text: string): void => {
      added.push(text);
    });
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Gets the group headings and the chips under each, in order.
   * @returns Returns them.
   */
  function shown(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.tech__group')).map(
      (group: HTMLElement): string =>
        `${group.querySelector('.tech__group-title')?.textContent?.trim() ?? '—'}: ${Array.from(
          group.querySelectorAll('.tech__chip'),
        )
          .map((chip: Element): string => chip.textContent.trim())
          .join(', ')}`,
    );
  }

  /**
   * Types into a field.
   * @param label The field's accessible label.
   * @param text The text.
   */
  async function type(label: string, text: string): Promise<void> {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /**
   * Picks a dropdown option.
   * @param label The dropdown's accessible label.
   * @param value The option's value.
   */
  async function choose(label: string, value: string): Promise<void> {
    const select: HTMLSelectElement = host.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  it('groupsTheCatalogueByCategory_inCategoryOrder', () => {
    expect(shown()).toEqual(['Languages: C#, Go', 'Databases: PostgreSQL', 'Caching: Redis']);
  });

  it('marksTheSelected', () => {
    const chips: NodeListOf<HTMLElement> = host.querySelectorAll<HTMLElement>('.tech__chip');
    expect(chips[0].classList).toContain('tech__chip--on');
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].classList).not.toContain('tech__chip--on');
  });

  it('searchesNamesAndAliases', async () => {
    await type('Search technologies', 'golang');
    expect(shown()).toEqual(['Languages: Go']);
  });

  it('filtersByCategory_andSortsByName', async () => {
    await choose('Category', 'databases');
    expect(shown()).toEqual(['Databases: PostgreSQL']);

    await choose('Category', '');
    await choose('Sort', 'name');
    expect(shown()).toEqual(['—: C#, Go, PostgreSQL, Redis']);
  });

  it('showsOnlyTheSelected_whenAsked', async () => {
    host.querySelector<HTMLInputElement>('.tech__only input[type="checkbox"]')!.click();
    await fixture.whenStable();
    expect(shown()).toEqual(['Languages: C#']);
  });

  it('togglingAChip_tellsTheWizard', () => {
    host.querySelectorAll<HTMLButtonElement>('.tech__chip')[1].click();
    expect(toggled).toEqual(['go']);
  });

  it('addingOneThatIsNotListed_handsItOn_andClearsTheField', async () => {
    const ask: HTMLButtonElement = host.querySelector<HTMLButtonElement>('.tech__ask')!;
    expect(ask.disabled).toBe(true);

    await type('Add a technology', '  Marten ');
    ask.click();
    await fixture.whenStable();

    expect(added).toEqual(['Marten']);
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Add a technology"]')!.value,
    ).toBe('');
  });
});
