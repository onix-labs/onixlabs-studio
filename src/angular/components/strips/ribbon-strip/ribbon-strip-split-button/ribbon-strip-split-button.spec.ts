import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripSplitButton } from './ribbon-strip-split-button';
import { Icon } from '../../../../icons/icon';

describe('RibbonStripSplitButton', () => {
  let component: RibbonStripSplitButton;
  let fixture: ComponentFixture<RibbonStripSplitButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripSplitButton],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripSplitButton);
    fixture.componentRef.setInput('icon', Icon.PLAY);
    fixture.componentRef.setInput('label', 'Start');
    fixture.componentRef.setInput('menuLabel', 'Debug');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('action_whenPrimaryClicked_emits', () => {
    let activated: boolean = false;
    component.action.subscribe((): void => {
      activated = true;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.ribbon-split__action')?.click();

    expect(activated).toBe(true);
  });

  it('menu_whenChevronClicked_emits', () => {
    let opened: boolean = false;
    component.menu.subscribe((): void => {
      opened = true;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.ribbon-split__menu')?.click();

    expect(opened).toBe(true);
  });
});
