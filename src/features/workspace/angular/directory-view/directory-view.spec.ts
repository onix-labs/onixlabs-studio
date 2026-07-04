import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';

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
});
