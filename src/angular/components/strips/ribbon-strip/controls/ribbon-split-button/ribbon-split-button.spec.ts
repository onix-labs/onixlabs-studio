import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonSplitButton } from './ribbon-split-button';

describe('RibbonSplitButton', () => {
  let component: RibbonSplitButton;
  let fixture: ComponentFixture<RibbonSplitButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonSplitButton],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonSplitButton);
    fixture.componentRef.setInput('icon', 'ti ti-player-play');
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
