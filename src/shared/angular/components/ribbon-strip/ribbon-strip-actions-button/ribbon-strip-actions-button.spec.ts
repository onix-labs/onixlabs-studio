import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonMenuItem } from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripActionsButton } from './ribbon-strip-actions-button';

/**
 * The rows the button's dropdown opens: a running one (red, stop glyph) and a stopped one (green,
 * start glyph), mirroring the run-configuration list this button was built for.
 */
const ITEMS: readonly RibbonMenuItem[] = [
  { id: 'app', label: 'Application', status: '(running)', icon: Icon.STOP, tone: 'danger' },
  { id: 'build', label: 'Build', status: '(stopped)', icon: Icon.PLAY, tone: 'success' },
];

describe('RibbonStripActionsButton', () => {
  let fixture: ComponentFixture<RibbonStripActionsButton>;
  let component: RibbonStripActionsButton;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripActionsButton],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripActionsButton);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('icon', Icon.ROCKET_LAUNCH);
    fixture.componentRef.setInput('label', 'Actions');
    fixture.componentRef.setInput('items', ITEMS);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('render_showsTheLabelAndACaret', () => {
    expect(host.querySelector('.ribbon-actions__label')?.textContent).toContain('Actions');
    expect(host.querySelector('.ribbon-actions__caret')).not.toBeNull();
  });

  it('disabled_whenTrue_disablesTheTrigger', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(host.querySelector<HTMLButtonElement>('.ribbon-actions')!.disabled).toBe(true);
  });

  it('open_showsARowPerItemColouredByTone_andEmitsTheChosenId', async () => {
    const selections: string[] = [];
    component.selected.subscribe((id: string): void => {
      selections.push(id);
    });

    host.querySelector<HTMLButtonElement>('.ribbon-actions')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // The menu renders into the CDK overlay attached to the document body.
    const rows: HTMLButtonElement[] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-menu-panel__item'),
    );
    expect(rows.length).toBe(2);
    expect(rows[0].classList).toContain('app-menu-panel__item--tone-danger');
    expect(rows[1].classList).toContain('app-menu-panel__item--tone-success');
    // The name is the label; the state rides on a separate muted status beside it.
    expect(rows[0].querySelector('.app-menu-panel__item-label')?.textContent).toContain(
      'Application',
    );
    expect(rows[0].querySelector('.app-menu-panel__item-status')?.textContent).toContain(
      '(running)',
    );

    rows[0].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selections).toEqual(['app']);
  });
});
