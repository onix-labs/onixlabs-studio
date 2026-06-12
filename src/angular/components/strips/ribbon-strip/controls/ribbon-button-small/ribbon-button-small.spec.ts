import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonButtonSmall } from './ribbon-button-small';
import { Icon } from '../../../../../icons/icon';

describe('RibbonButtonSmall', () => {
  let component: RibbonButtonSmall;
  let fixture: ComponentFixture<RibbonButtonSmall>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonButtonSmall],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonButtonSmall);
    fixture.componentRef.setInput('icon', Icon.COPY);
    fixture.componentRef.setInput('label', 'Copy');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('action_whenButtonClicked_emits', () => {
    let activated: boolean = false;
    component.action.subscribe((): void => {
      activated = true;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('button')?.click();

    expect(activated).toBe(true);
  });

  it('render_whenNotToggle_omitsAriaPressed', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const button: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>('button');
    expect(button?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('render_whenTogglePressed_setsAriaPressedTrue', () => {
    fixture.componentRef.setInput('toggle', true);
    fixture.componentRef.setInput('pressed', true);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const button: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });
});
