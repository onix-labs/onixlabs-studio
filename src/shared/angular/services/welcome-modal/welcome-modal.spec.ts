import { TestBed } from '@angular/core/testing';

import { WelcomeModal } from './welcome-modal';

describe('WelcomeModal', () => {
  let modal: WelcomeModal;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    modal = TestBed.inject(WelcomeModal);
  });

  it('isOpen_beforeAnyInteraction_isFalse', () => {
    expect(modal.isOpen()).toBe(false);
  });

  it('open_whenCalled_showsTheModal', () => {
    modal.open();

    expect(modal.isOpen()).toBe(true);
  });

  it('close_afterOpening_hidesTheModal', () => {
    modal.open();

    modal.close();

    expect(modal.isOpen()).toBe(false);
  });

  it('toggle_whenCalledRepeatedly_flipsTheState', () => {
    modal.toggle();
    expect(modal.isOpen()).toBe(true);

    modal.toggle();
    expect(modal.isOpen()).toBe(false);
  });
});
