import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TitleStripButton } from './title-strip-button';
import { Icon } from '../../../../icons/icon';

describe('TitleStripButton', () => {
  let component: TitleStripButton;
  let fixture: ComponentFixture<TitleStripButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripButton],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripButton);
    fixture.componentRef.setInput('icon', Icon.GRID_DOTS);
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
