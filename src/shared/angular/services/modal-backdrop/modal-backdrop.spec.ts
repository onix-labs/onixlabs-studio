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

  it('requestDismiss_asksTheTopmostModalOnly', () => {
    const asked: string[] = [];
    backdrop.raise((): void => {
      asked.push('outer');
    });
    backdrop.raise((): void => {
      asked.push('inner');
    });

    backdrop.requestDismiss();

    expect(asked).toEqual(['inner']);
  });

  it('requestDismiss_afterTheTopmostClosed_asksTheOneBeneath', () => {
    const asked: string[] = [];
    backdrop.raise((): void => {
      asked.push('outer');
    });
    const lowerInner: () => void = backdrop.raise((): void => {
      asked.push('inner');
    });

    lowerInner();
    backdrop.requestDismiss();

    expect(asked).toEqual(['outer']);
  });

  it('requestDismiss_whenTheModalOffersNoDismissal_doesNothing', () => {
    backdrop.raise();

    expect((): void => backdrop.requestDismiss()).not.toThrow();
    expect(backdrop.raised()).toBe(true);
  });

  it('requestDismiss_whenNothingIsRaised_doesNothing', () => {
    expect((): void => backdrop.requestDismiss()).not.toThrow();
  });

  it('lower_whenCalledTwice_doesNotLowerAnotherModal', () => {
    const first: () => void = backdrop.raise();
    backdrop.raise();

    first();
    first();

    expect(backdrop.raised()).toBe(true);
  });
});
