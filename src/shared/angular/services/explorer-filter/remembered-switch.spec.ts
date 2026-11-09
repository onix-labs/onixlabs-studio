import { RememberedSwitch } from './remembered-switch';

describe('RememberedSwitch', () => {
  const KEY: string = 'spec.remembered-switch';

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('startsAsItIsToldTo_untilSomethingIsRemembered', () => {
    expect(new RememberedSwitch(KEY, true).on()).toBe(true);
    expect(new RememberedSwitch(KEY, false).on()).toBe(false);
  });

  it('staysAsItWasLeft_acrossInstances', () => {
    new RememberedSwitch(KEY, true).toggle();

    expect(new RememberedSwitch(KEY, true).on()).toBe(false);
  });
});
