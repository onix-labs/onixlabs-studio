import { TestBed } from '@angular/core/testing';
import { HierarchyRouter, HierarchySource } from './hierarchy';

describe('HierarchyRouter (#1153)', () => {
  const SOURCE: HierarchySource = {
    kind: 'types',
    roots: [],
    children: (): Promise<null> => Promise.resolve(null),
  };

  it('showsAHierarchyInTheWorkspaceInFront_andNowhereWithoutOne', () => {
    const router: HierarchyRouter = TestBed.inject(HierarchyRouter);
    const first: HierarchySource[] = [];
    const second: HierarchySource[] = [];
    const reveal: (source: HierarchySource) => number = (source: HierarchySource): number =>
      first.push(source);
    const revealSecond: (source: HierarchySource) => number = (source: HierarchySource): number =>
      second.push(source);

    expect(router.available()).toBe(false);
    expect(router.show(SOURCE)).toBe(false);

    router.register(reveal);
    router.register(revealSecond);
    // Another tab's late unregistration leaves the tab in front registered.
    router.unregister(reveal);

    expect(router.available()).toBe(true);
    expect(router.show(SOURCE)).toBe(true);
    expect(first).toEqual([]);
    expect(second).toEqual([SOURCE]);

    router.unregister(revealSecond);
    expect(router.available()).toBe(false);
  });
});
