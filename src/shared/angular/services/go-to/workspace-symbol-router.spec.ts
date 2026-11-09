import { TestBed } from '@angular/core/testing';
import { WorkspaceSymbolRouter } from './workspace-symbol-router';

describe('WorkspaceSymbolRouter (#1146)', () => {
  it('opensInTheWorkspaceInFront_andNowhereOnceItHasGone', () => {
    const router: WorkspaceSymbolRouter = TestBed.inject(WorkspaceSymbolRouter);
    const opened: string[] = [];
    const first: () => void = (): void => void opened.push('first');
    const second: () => void = (): void => void opened.push('second');

    router.open();
    expect(router.available()).toBe(false);

    router.register(first);
    router.register(second);
    router.unregister(first);
    router.open();
    expect(router.available()).toBe(true);

    router.unregister(second);
    router.open();

    expect(opened).toEqual(['second']);
    expect(router.available()).toBe(false);
  });
});
