import { TestBed } from '@angular/core/testing';

import { WorkspaceFind } from './workspace-find';

describe('WorkspaceFind', () => {
  let find: WorkspaceFind;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WorkspaceFind] });
    find = TestBed.inject(WorkspaceFind);
  });

  it('reveal_whenNoHandlerRegistered_isANoOp', () => {
    expect((): void => find.reveal()).not.toThrow();
  });

  it('reveal_whenHandlerRegistered_invokesTheCallback', () => {
    let revealed: number = 0;
    find.register((): void => {
      revealed += 1;
    });

    find.reveal();
    find.reveal();

    expect(revealed).toBe(2);
  });

  it('register_whenCalledAgain_replacesTheCallback', () => {
    let first: number = 0;
    let second: number = 0;
    find.register((): void => {
      first += 1;
    });
    find.register((): void => {
      second += 1;
    });

    find.reveal();

    expect(first).toBe(0);
    expect(second).toBe(1);
  });

  it('unregister_whenGivenTheCurrentCallback_clearsIt', () => {
    let revealed: number = 0;
    const reveal: () => void = (): void => {
      revealed += 1;
    };
    find.register(reveal);

    find.unregister(reveal);
    find.reveal();

    expect(revealed).toBe(0);
  });

  it('unregister_whenGivenADifferentCallback_keepsTheCurrentOne', () => {
    let revealed: number = 0;
    find.register((): void => {
      revealed += 1;
    });

    find.unregister((): void => undefined);
    find.reveal();

    expect(revealed).toBe(1);
  });
});
