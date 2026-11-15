import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { NetworkActivity } from '../network-activity/network-activity';
import { sampleNetwork } from '../network-activity/network-samples.testing';
import { NetworkExplorerCommands } from '../network-explorer-commands/network-explorer-commands';
import { NetworkProbe } from '../network-probe/network-probe';
import { FakeNetworkProbe } from '../network-probe/network-probe.fake';
import { NetworkExplorerView } from './network-explorer-view';

describe('NetworkExplorerView', () => {
  let fixture: ComponentFixture<NetworkExplorerView>;
  let probe: FakeNetworkProbe;
  let commands: NetworkExplorerCommands;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    probe.network = sampleNetwork;
    TestBed.configureTestingModule({
      imports: [NetworkExplorerView],
      providers: [{ provide: NetworkProbe, useValue: probe }],
    });
    commands = TestBed.inject(NetworkExplorerCommands);
    fixture = TestBed.createComponent(NetworkExplorerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    await fixture.whenStable();
  });

  /**
   * Makes the view's tab the active one, or sets it aside.
   * @param active Whether the tab is active.
   */
  async function activate(active: boolean): Promise<void> {
    fixture.componentRef.setInput('isActive', active);
    await fixture.whenStable();
  }

  it('docksTheInterfacesAndConnections_aroundAnEmptyWell', () => {
    const layout: string = JSON.stringify(fixture.debugElement.injector.get(DockState).layout());

    expect(layout).toContain('"interfaces"');
    expect(layout).toContain('"connections"');
    expect(layout).toContain('"document"');
  });

  it('readsTheNetwork_onlyWhileActive', async () => {
    expect(probe.consumers).toBe(0);

    await activate(true);
    expect(probe.consumers).toBe(1);

    await activate(false);
    expect(probe.consumers).toBe(0);
  });

  it('theRibbon_drivesTheActiveView', async () => {
    await activate(true);
    const store: NetworkActivity = fixture.debugElement.injector.get(NetworkActivity);

    commands.toggleLoopback();
    commands.toggleIdleInterfaces();

    expect(store.showLoopback()).toBe(true);
    expect(commands.showIdleInterfaces()).toBe(true);
  });

  it('closing_stopsReadingAndReleasesTheRibbon', async () => {
    await activate(true);

    fixture.destroy();
    commands.toggleLoopback();

    expect(probe.consumers).toBe(0);
    expect(commands.showLoopback()).toBe(false);
  });
});
