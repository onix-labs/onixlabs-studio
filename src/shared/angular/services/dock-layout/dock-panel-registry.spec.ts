import { TestBed } from '@angular/core/testing';
import { DockPanelPlaceholder } from '../../components/dock-layout/dock-panel-placeholder/dock-panel-placeholder';
import { Icon } from '@shared/angular/icons/icon';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockNode, mkStack } from './dock-node';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';

/**
 * A blueprint cataloguing a couple of tool panels, standing in for a real tab's panel set. The
 * registry seeds itself from whichever blueprint its host tab provides, so a test provides one too.
 */
const TEST_BLUEPRINT: DockBlueprint = {
  key: 'test',
  createLayout: (): DockNode => mkStack('tool', ['files']),
  panels: [
    {
      id: 'files',
      title: 'File Explorer',
      icon: Icon.FILE_EXPLORER,
      role: 'tool',
      component: DockPanelPlaceholder,
      ownsToolStrip: true,
    },
    {
      id: 'output',
      title: 'Output',
      icon: Icon.OUTPUT,
      role: 'tool',
      component: DockPanelPlaceholder,
    },
  ],
};

describe('DockPanelRegistry', () => {
  let registry: DockPanelRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_BLUEPRINT }],
    });
    registry = TestBed.inject(DockPanelRegistry);
  });

  it('should create', () => {
    expect(registry).toBeTruthy();
  });

  it('get_whenCataloguedPanelRequested_returnsItFromTheBlueprint', () => {
    const panel: DockPanel | undefined = registry.get('files');

    expect(panel?.title).toBe('File Explorer');
    expect(panel?.role).toBe('tool');
    expect(panel?.component).toBe(DockPanelPlaceholder);
  });

  it('get_whenPanelNotRegistered_returnsUndefined', () => {
    expect(registry.get('toolbox')).toBeUndefined();
  });

  it('register_whenDocumentPanelRegistered_reportsTheDocumentRole', () => {
    registry.register({
      id: 'doc-1',
      title: 'main.ts',
      icon: Icon.CODE,
      role: 'document',
      component: DockPanelPlaceholder,
    });
    expect(registry.get('doc-1')?.role).toBe('document');
  });

  it('has_whenPanelCatalogued_returnsTrue', () => {
    expect(registry.has('output')).toBe(true);
    expect(registry.has('absent')).toBe(false);
  });

  it('register_whenCalled_replacesAnExistingRegistration', () => {
    registry.register({
      id: 'files',
      title: 'Renamed',
      icon: Icon.SETTINGS,
      role: 'tool',
      component: DockPanelPlaceholder,
    });

    expect(registry.get('files')?.title).toBe('Renamed');
  });
});
