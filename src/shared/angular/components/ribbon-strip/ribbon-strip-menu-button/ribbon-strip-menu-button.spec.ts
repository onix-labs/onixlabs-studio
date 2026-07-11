import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonMenuItem, RibbonStripMenuButton } from './ribbon-strip-menu-button';

/**
 * The dropdown items the chevron opens.
 */
const ITEMS: readonly RibbonMenuItem[] = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'beta', label: 'Beta', icon: Icon.GIT_DIFF },
];

describe('RibbonStripMenuButton', () => {
  let fixture: ComponentFixture<RibbonStripMenuButton>;
  let component: RibbonStripMenuButton;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripMenuButton],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripMenuButton);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('icon', Icon.PLUS);
    fixture.componentRef.setInput('label', 'Insert');
    fixture.componentRef.setInput('items', ITEMS);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('render_showsThePrimaryActionLabel', () => {
    expect(host.querySelector('.ribbon-menu-button__action')?.textContent).toContain('Insert');
  });

  it('onAction_whenThePrimaryActionIsClicked_emitsAction', () => {
    let actions: number = 0;
    component.action.subscribe((): void => {
      actions += 1;
    });

    host.querySelector<HTMLButtonElement>('.ribbon-menu-button__action')!.click();

    expect(actions).toBe(1);
  });

  it('disabled_whenTrue_disablesBothThePrimaryActionAndTheChevron', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(host.querySelector<HTMLButtonElement>('.ribbon-menu-button__action')!.disabled).toBe(
      true,
    );
    expect(host.querySelector<HTMLButtonElement>('.ribbon-menu-button__menu')!.disabled).toBe(true);
  });

  it('onSelect_whenADropdownItemIsChosen_emitsItsId', async () => {
    const selections: string[] = [];
    component.selected.subscribe((id: string): void => {
      selections.push(id);
    });

    host.querySelector<HTMLButtonElement>('.ribbon-menu-button__menu')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // The menu renders into the CDK overlay attached to the document body.
    const items: HTMLButtonElement[] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item'),
    );
    expect(items.length).toBe(2);

    items[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selections).toEqual(['beta']);
  });
});
