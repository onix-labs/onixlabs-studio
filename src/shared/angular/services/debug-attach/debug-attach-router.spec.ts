import { TestBed } from '@angular/core/testing';
import { DebugAttachRouter } from './debug-attach-router';

describe('DebugAttachRouter (#1150)', () => {
  it('attachesInTheWorkspaceInFront_andNowhereOnceItHasGone', async () => {
    const router: DebugAttachRouter = TestBed.inject(DebugAttachRouter);
    const asked: [number, string][] = [];
    const handler: (processId: number, name: string) => Promise<boolean> = (
      processId: number,
      name: string,
    ): Promise<boolean> => {
      asked.push([processId, name]);
      return Promise.resolve(true);
    };

    expect(await router.attach(1, 'Tests')).toBe(false);
    router.register(handler);
    expect(await router.attach(46456, 'Tests')).toBe(true);
    router.unregister(handler);
    expect(await router.attach(2, 'Tests')).toBe(false);

    expect(asked).toEqual([[46456, 'Tests']]);
  });
});
