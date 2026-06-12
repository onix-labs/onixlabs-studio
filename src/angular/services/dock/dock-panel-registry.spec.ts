import { TestBed } from '@angular/core/testing';
import { DockPanelPlaceholder } from '../../components/dock/dock-panel-placeholder/dock-panel-placeholder';
import { TreePanel } from '../../components/panels/tree-panel/tree-panel';
import { DockPanel } from './dock-panel';
import { DockPanelRegistry } from './dock-panel-registry';

describe('DockPanelRegistry', () => {
  let registry: DockPanelRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(DockPanelRegistry);
  });

  it('should create', () => {
    expect(registry).toBeTruthy();
  });

  it('get_whenExplorerPanelRequested_returnsItWithTheTreePanelComponent', () => {
    const panel: DockPanel | undefined = registry.get('solution');

    expect(panel?.title).toBe('Solution Explorer');
    expect(panel?.role).toBe('tool');
    expect(panel?.component).toBe(TreePanel);
  });

  it('get_whenPlaceholderPanelRequested_returnsItWithThePlaceholderComponent', () => {
    expect(registry.get('output')?.component).toBe(DockPanelPlaceholder);
  });

  it('get_whenDocumentPanelRequested_reportsTheDocumentRole', () => {
    expect(registry.get('doc1')?.role).toBe('document');
  });

  it('has_whenPanelRegistered_returnsTrue', () => {
    expect(registry.has('output')).toBe(true);
    expect(registry.has('absent')).toBe(false);
  });

  it('register_whenCalled_replacesAnExistingRegistration', () => {
    registry.register({
      id: 'solution',
      title: 'Renamed',
      icon: 'ti ti-star',
      role: 'tool',
      component: DockPanelPlaceholder,
    });

    expect(registry.get('solution')?.title).toBe('Renamed');
  });
});
