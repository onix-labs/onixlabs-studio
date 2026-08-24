import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Dropdown, DropdownOption } from './dropdown';

const OPTIONS: readonly DropdownOption[] = [
  { value: 'code', label: 'Code' },
  { value: 'markdown', label: 'Markdown' },
];

describe('Dropdown', () => {
  let component: Dropdown;
  let fixture: ComponentFixture<Dropdown>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dropdown],
    }).compileComponents();

    fixture = TestBed.createComponent(Dropdown);
    fixture.componentRef.setInput('options', OPTIONS);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOptionsSet_rendersAnOptionPerEntry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('option').length).toBe(2);
  });

  it('valueChange_whenSelectionChanged_emitsThePickedValue', () => {
    let emitted: string | undefined;
    component.valueChange.subscribe((value: string): void => {
      emitted = value;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = element.querySelector<HTMLSelectElement>('select');
    if (select !== null) {
      select.value = 'markdown';
      select.dispatchEvent(new Event('change'));
    }

    expect(emitted).toBe('markdown');
  });

  it('value_onInitialRender_selectsTheBoundValueNotTheFirstOption', async () => {
    fixture.componentRef.setInput('value', 'markdown');
    fixture.detectChanges();
    await fixture.whenStable();

    const select: HTMLSelectElement = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    )!;
    expect(select.value).toBe('markdown');
  });

  it('value_whenPickNotAdoptedByParent_reassertsTheBoundValue', async () => {
    fixture.componentRef.setInput('value', 'code');
    fixture.detectChanges();
    await fixture.whenStable();

    const select: HTMLSelectElement = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    )!;

    // The parent ignores the pick (value input unchanged); the select must snap back to it.
    select.value = 'markdown';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(select.value).toBe('code');
  });

  it('disabled_whenOptionDisabled_marksThatOptionDisabled', () => {
    fixture.componentRef.setInput('options', [
      { value: 'code', label: 'Code' },
      { value: 'markdown', label: 'Markdown', disabled: true },
    ]);
    fixture.detectChanges();

    const options: NodeListOf<HTMLOptionElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('option');
    expect(options[0].disabled).toBe(false);
    expect(options[1].disabled).toBe(true);
  });

  it('group_whenOptionsAreUngrouped_rendersNoOptgroup', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('optgroup').length).toBe(0);
  });

  it('group_whenOptionsCarryGroups_wrapsEachRunInALabelledOptgroup', () => {
    fixture.componentRef.setInput('options', [
      { value: 'opus', label: 'Opus 5', group: 'Anthropic' },
      { value: 'sonnet', label: 'Sonnet 5', group: 'Anthropic' },
      { value: 'gpt', label: 'GPT-5', group: 'OpenAI' },
    ]);
    fixture.detectChanges();

    const groups: NodeListOf<HTMLOptGroupElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('optgroup');
    expect(Array.from(groups, (group: HTMLOptGroupElement): string => group.label)).toEqual([
      'Anthropic',
      'OpenAI',
    ]);
    expect(groups[0].querySelectorAll('option').length).toBe(2);
    expect(groups[1].querySelectorAll('option').length).toBe(1);
  });

  it('group_whenGroupedAndUngroupedAreMixed_keepsTheSuppliedOrder', () => {
    fixture.componentRef.setInput('options', [
      { value: 'auto', label: 'Automatic' },
      { value: 'opus', label: 'Opus 5', group: 'Anthropic' },
      { value: 'gpt', label: 'GPT-5', group: 'OpenAI' },
    ]);
    fixture.detectChanges();

    const select: HTMLSelectElement = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    )!;
    // The loose option stays first and outside any group; the grouped ones follow in order.
    expect(Array.from(select.options, (option: HTMLOptionElement): string => option.value)).toEqual(
      ['auto', 'opus', 'gpt'],
    );
    expect(select.querySelector('optgroup')?.previousElementSibling?.tagName).toBe('OPTION');
  });

  it('group_whenTheSameLabelIsNotContiguous_rendersARunPerBlockWithoutReordering', () => {
    fixture.componentRef.setInput('options', [
      { value: 'opus', label: 'Opus 5', group: 'Anthropic' },
      { value: 'gpt', label: 'GPT-5', group: 'OpenAI' },
      { value: 'haiku', label: 'Haiku 4.5', group: 'Anthropic' },
    ]);
    fixture.detectChanges();

    const groups: NodeListOf<HTMLOptGroupElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('optgroup');
    expect(Array.from(groups, (group: HTMLOptGroupElement): string => group.label)).toEqual([
      'Anthropic',
      'OpenAI',
      'Anthropic',
    ]);
  });

  it('group_whenRendered_carriesAVisibleLegendHeading', () => {
    fixture.componentRef.setInput('options', [
      { value: 'opus', label: 'Opus 5', group: 'Anthropic' },
    ]);
    fixture.detectChanges();

    // Base-appearance selects do not paint optgroup's label attribute; the legend is what the user sees.
    const legend: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'optgroup > legend',
    );
    expect(legend?.textContent?.trim()).toBe('Anthropic');
  });

  it('valueChange_whenAGroupedOptionIsPicked_emitsItsValue', () => {
    fixture.componentRef.setInput('options', [
      { value: 'opus', label: 'Opus 5', group: 'Anthropic' },
      { value: 'gpt', label: 'GPT-5', group: 'OpenAI' },
    ]);
    fixture.detectChanges();

    let emitted: string | undefined;
    component.valueChange.subscribe((value: string): void => {
      emitted = value;
    });

    const select: HTMLSelectElement = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    )!;
    select.value = 'gpt';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toBe('gpt');
  });

  it('ariaLabel_whenSet_namesTheUnderlyingSelect', () => {
    fixture.componentRef.setInput('ariaLabel', 'Document type');
    fixture.detectChanges();

    const select: HTMLSelectElement = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    )!;
    expect(select.getAttribute('aria-label')).toBe('Document type');
  });
});
