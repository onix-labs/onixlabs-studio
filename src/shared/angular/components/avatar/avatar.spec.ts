import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Avatar, AVATAR_HUES, hueOf, monogramOf } from './avatar';

/**
 * Hosts an avatar with writable inputs.
 */
@Component({
  imports: [Avatar],
  template: `<app-avatar [name]="name()" seed="ada" [ariaLabel]="label()" />`,
})
class Host {
  public readonly name: WritableSignal<string> = signal<string>('Ada Lovelace');
  public readonly label: WritableSignal<string | undefined> = signal<string | undefined>(undefined);
}

describe('monogramOf', () => {
  it('takesTheFirstLettersOfTheFirstTwoWords', () => {
    expect(monogramOf('Ada Lovelace')).toBe('AL');
    expect(monogramOf('  grace   brewster murray hopper ')).toBe('GB');
    expect(monogramOf('Linus')).toBe('L');
  });

  it('keepsASurrogatePairWhole', () => {
    expect(monogramOf('\u{1F600} Smile')).toBe('\u{1F600}S');
  });

  it('fallsBackToAQuestionMark', () => {
    expect(monogramOf('   ')).toBe('?');
  });
});

describe('hueOf', () => {
  it('isStable_andOneOfTheHues', () => {
    expect(hueOf('3f2b9c1e')).toBe(hueOf('3f2b9c1e'));
    expect(AVATAR_HUES).toContain(hueOf('anything'));
  });

  it('spreadsSeedsAcrossTheHues', () => {
    const seen: Set<string> = new Set<string>(
      Array.from({ length: 60 }, (_value: unknown, index: number): string =>
        hueOf(`agent-${index}`),
      ),
    );
    expect(seen.size).toBeGreaterThan(AVATAR_HUES.length / 2);
  });
});

describe('Avatar', () => {
  let fixture: ComponentFixture<Host>;

  /**
   * Gets the avatar element.
   * @returns Returns it.
   */
  function avatar(): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-avatar')!;
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('showsTheMonogram_inTheSeedsHue_hiddenFromAssistiveTech', () => {
    expect(avatar().textContent).toBe('AL');
    expect(avatar().getAttribute('data-hue')).toBe(hueOf('ada'));
    expect(avatar().getAttribute('aria-hidden')).toBe('true');
  });

  it('keepsItsHue_whenTheNameChanges', () => {
    fixture.componentInstance.name.set('Countess of Lovelace');
    fixture.detectChanges();

    expect(avatar().textContent).toBe('CO');
    expect(avatar().getAttribute('data-hue')).toBe(hueOf('ada'));
  });

  it('becomesAnImage_whenLabelled', () => {
    fixture.componentInstance.label.set('Ada Lovelace');
    fixture.detectChanges();

    expect(avatar().getAttribute('role')).toBe('img');
    expect(avatar().getAttribute('aria-label')).toBe('Ada Lovelace');
    expect(avatar().getAttribute('aria-hidden')).toBeNull();
  });
});
