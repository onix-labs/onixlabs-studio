import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { IssueOpener } from '@shared/angular/services/issues/issue-opener';
import { IssueStore } from '@shared/angular/services/issues/issue-store';

import { DirectoryView } from './directory-view';

const ROOT_LISTING: DirectoryListing = {
  path: '/ws',
  name: 'ws',
  entries: [{ name: 'README.md', path: '/ws/README.md', type: 'file' }],
};

describe('DirectoryView', () => {
  let component: DirectoryView;
  let fixture: ComponentFixture<DirectoryView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DirectoryView],
    }).compileComponents();

    fixture = TestBed.createComponent(DirectoryView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('tabId', 'tab-1');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('init_whenAFolderIsStashedForTheTab_seedsTheScopedWorkspace', () => {
    const workspaces: Workspaces = TestBed.inject(Workspaces);
    workspaces.setInitial('tab-2', ROOT_LISTING);

    const seeded: ComponentFixture<DirectoryView> = TestBed.createComponent(DirectoryView);
    seeded.componentRef.setInput('tabId', 'tab-2');
    seeded.detectChanges();

    // The scoped workspace is the instance provided by this directory view.
    const scopedWorkspace: Workspace = seeded.debugElement.injector.get(Workspace);
    expect(scopedWorkspace.rootName()).toBe('ws');
  });

  // Anything that opens a document reaches for THIS tab's dock. A service left to the root injector
  // gets the root DockState, which no view renders — so the tab opens where nobody can see it, and
  // the click looks like it did nothing. The pairs below must be scoped here, together.
  const perTabServices: readonly [string, unknown][] = [
    ['Diffs', Diffs],
    ['DiffOpener', DiffOpener],
    ['IssueStore', IssueStore],
    ['IssueOpener', IssueOpener],
    ['DockState', DockState],
    ['DockPanelRegistry', DockPanelRegistry],
  ];

  for (const [name, token] of perTabServices) {
    it(`providers_${name}_isScopedToTheTabNotTheRoot`, () => {
      const scoped: unknown = fixture.debugElement.injector.get(token as never);
      expect(scoped).not.toBe(TestBed.inject(token as never));
    });
  }
});
