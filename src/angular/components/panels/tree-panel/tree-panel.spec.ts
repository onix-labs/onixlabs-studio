import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '../../../services/dock/dock-panel';
import { Icon } from '../../../icons/icon';

import { TreePanel } from './tree-panel';

describe('TreePanel', () => {
  let component: TreePanel;
  let fixture: ComponentFixture<TreePanel>;

  const panel: DockPanel = {
    id: 'files',
    title: 'File Explorer',
    icon: Icon.FILE_EXPLORER,
    role: 'tool',
    component: TreePanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(TreePanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoWorkspaceOpen_showsEmptyState', () => {
    fixture.detectChanges();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Open Folder');
  });

  it('iconFor_whenTypeScriptFile_returnsTypeScriptIcon', () => {
    expect(
      component.iconFor({
        name: 'main.ts',
        path: '/ws/main.ts',
        type: 'file',
        expanded: false,
        loading: false,
        children: null,
      }),
    ).toBe(Icon.FILE_TYPESCRIPT);
  });

  it('iconFor_whenExpandedDirectory_returnsOpenFolder', () => {
    expect(
      component.iconFor({
        name: 'src',
        path: '/ws/src',
        type: 'directory',
        expanded: true,
        loading: false,
        children: null,
      }),
    ).toBe(Icon.FOLDER_OPEN);
  });
});
