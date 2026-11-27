import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ActivationFocus } from './activation-focus';

describe('ActivationFocus', () => {
  it('allowsFocus_untilAHostSaysWhatToFollow', () => {
    expect(TestBed.inject(ActivationFocus).allowed()).toBe(true);
  });

  it('follow_answersFromTheSource_andFollowsTheSignalsItReads', () => {
    const focus: ActivationFocus = TestBed.inject(ActivationFocus);
    const quiet: WritableSignal<boolean> = signal<boolean>(true);

    focus.follow((): boolean => !quiet());
    expect(focus.allowed()).toBe(false);

    quiet.set(false);
    expect(focus.allowed()).toBe(true);
  });
});
