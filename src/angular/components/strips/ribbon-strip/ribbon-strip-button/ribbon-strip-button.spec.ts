import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripButton } from './ribbon-strip-button';
import { Icon } from '@shared/angular/icons/icon';

describe('RibbonStripButton', () => {
  let component: RibbonStripButton;
  let fixture: ComponentFixture<RibbonStripButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripButton],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripButton);
    fixture.componentRef.setInput('icon', Icon.BUILD);
    fixture.componentRef.setInput('label', 'Build');
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

  it('render_whenDisabled_disablesTheButton', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const button: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>('button');
    expect(button?.disabled).toBe(true);
  });
});
