import { TestBed } from '@angular/core/testing';

import { ModalBackdrop } from './modal-backdrop';

describe('ModalBackdrop', () => {
  let backdrop: ModalBackdrop;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ModalBackdrop] });
    backdrop = TestBed.inject(ModalBackdrop);
  });

  it('should create', () => {
    expect(backdrop).toBeTruthy();
  });

  it('raised_whenNothingRaised_isFalse', () => {
    expect(backdrop.raised()).toBe(false);
  });

  it('raise_whenCalled_raisesUntilLowered', () => {
    const lower: () => void = backdrop.raise();
    expect(backdrop.raised()).toBe(true);

    lower();

    expect(backdrop.raised()).toBe(false);
  });

  it('raise_whenNested_staysRaisedUntilEveryModalCloses', () => {
    const outer: () => void = backdrop.raise();
    const inner: () => void = backdrop.raise();

    inner();
    expect(backdrop.raised()).toBe(true);

    outer();
    expect(backdrop.raised()).toBe(false);
  });

  it('lower_whenCalledTwice_doesNotLowerAnotherModal', () => {
    const first: () => void = backdrop.raise();
    backdrop.raise();

    first();
    first();

    expect(backdrop.raised()).toBe(true);
  });
});
