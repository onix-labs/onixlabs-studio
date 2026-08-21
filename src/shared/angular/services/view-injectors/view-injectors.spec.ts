import { describe, expect, it } from 'vitest';
import { Injector, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ViewInjectors } from './view-injectors';

describe('ViewInjectors', () => {
  let service: ViewInjectors;
  let activeTabId: WritableSignal<string | undefined>;
  let resolved: Signal<Injector | null>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ViewInjectors);
    activeTabId = signal<string | undefined>('tab-1');
    resolved = service.injectorFor(activeTabId);
  });

  it('injectorFor_whenNoViewIsRegistered_resolvesNull', () => {
    expect(resolved()).toBeNull();
  });

  it('injectorFor_resolvesTheRegisteredViewOfTheActiveTab', () => {
    const injector: Injector = Injector.create({ providers: [] });

    service.register('tab-1', injector);

    expect(resolved()).toBe(injector);
  });

  it('injectorFor_whenAnotherTabIsActive_resolvesNull', () => {
    service.register('tab-1', Injector.create({ providers: [] }));

    activeTabId.set('tab-2');

    expect(resolved()).toBeNull();
  });

  it('register_whenCalledForTheSameTab_replacesThePreviousView', () => {
    const successor: Injector = Injector.create({ providers: [] });
    service.register('tab-1', Injector.create({ providers: [] }));

    service.register('tab-1', successor);

    expect(resolved()).toBe(successor);
  });

  it('drop_removesTheRegistration', () => {
    const drop: () => void = service.register('tab-1', Injector.create({ providers: [] }));

    drop();

    expect(resolved()).toBeNull();
  });

  it('drop_whenASuccessorHasAlreadyRegistered_leavesTheSuccessorInPlace', () => {
    // A container tab's sub-views share a tab id: the outgoing checkout's cleanup runs after the
    // incoming one has registered, and must not take the tab's status strip down with it.
    const drop: () => void = service.register('tab-1', Injector.create({ providers: [] }));
    const successor: Injector = Injector.create({ providers: [] });
    service.register('tab-1', successor);

    drop();

    expect(resolved()).toBe(successor);
  });
});
