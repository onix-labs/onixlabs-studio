import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { Chip, ChipTone } from './chip';

/**
 * Hosts a chip with a tone, an optional icon and projected text.
 */
@Component({
  imports: [Chip],
  template: `<app-chip [tone]="tone()" [icon]="icon()">Modified</app-chip>`,
})
class ChipHost {
  public readonly tone: WritableSignal<ChipTone> = signal<ChipTone>('neutral');
  public readonly icon: WritableSignal<Icon | undefined> = signal<Icon | undefined>(undefined);
}

describe('Chip (#882)', () => {
  let fixture: ComponentFixture<ChipHost>;

  /**
   * Gets the chip element.
   * @returns Returns it.
   */
  function chip(): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-chip')!;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChipHost] }).compileComponents();
    fixture = TestBed.createComponent(ChipHost);
    fixture.detectChanges();
  });

  it('isNeutral_byDefault_andShowsItsText', () => {
    expect(chip().classList).toContain('chip--neutral');
    expect(chip().textContent?.trim()).toBe('Modified');
    expect(chip().querySelector('app-icon')).toBeNull();
  });

  it('takesEachTone_asItsClass', () => {
    for (const tone of ['accent', 'success', 'warning', 'danger', 'info', 'neutral'] as const) {
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();
      expect(chip().classList).toContain(`chip--${tone}`);
    }
  });

  it('drawsItsIcon_beforeTheText', () => {
    fixture.componentInstance.icon.set(Icon.TAG);
    fixture.detectChanges();

    expect(chip().firstElementChild?.tagName).toBe('APP-ICON');
  });
});
