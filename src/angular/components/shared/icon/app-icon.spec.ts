import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppIcon } from './app-icon';
import { Icon } from '../../../icons/icon';

describe('AppIcon', () => {
  let component: AppIcon;
  let fixture: ComponentFixture<AppIcon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppIcon],
    }).compileComponents();

    fixture = TestBed.createComponent(AppIcon);
    fixture.componentRef.setInput('icon', Icon.SETTINGS);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenGivenAnIcon_appliesItsClassList', () => {
    const glyph: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector('i');

    expect(glyph?.className).toBe(Icon.SETTINGS.classList);
  });

  it('render_whenSizeOmitted_leavesFontSizeInherited', () => {
    const glyph: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector('i');

    expect(glyph?.style.fontSize).toBe('');
  });

  it('render_whenSizeGiven_setsFontSizeInRem', () => {
    fixture.componentRef.setInput('size', 1.5);
    fixture.detectChanges();

    const glyph: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector('i');

    expect(glyph?.style.fontSize).toBe('1.5rem');
  });

  it('render_whenNotRotated_leavesTransformUnset', () => {
    const glyph: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector('i');

    expect(glyph?.style.transform).toBe('');
  });

  it('render_whenRotated_appliesRotateTransform', () => {
    fixture.componentRef.setInput('rotation', 90);
    fixture.detectChanges();

    const glyph: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector('i');

    expect(glyph?.style.transform).toBe('rotate(90deg)');
  });
});
