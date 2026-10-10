import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiHistoryEntry, HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';
import { ApiHttp } from '../../api-http/api-http';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../../api-workspace/api-workspace';
import { ApiHistoryPanel } from './api-history-panel';

/**
 * A stand-in engine that answers every send with an empty 200, so no test reaches a socket.
 */
class FakeHttp {
  /**
   * Resolves an empty response for any send.
   * @returns Returns a stubbed outcome.
   */
  public send(): Promise<HttpOutcome> {
    return Promise.resolve({
      kind: 'response',
      id: '',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '',
      sizeBytes: 0,
      finalUrl: '',
      redirected: false,
      timings: { firstByteMs: 0, totalMs: 0 },
    } as HttpOutcome);
  }

  /**
   * Records nothing: no test cancels.
   */
  public cancel(): void {
    // Intentionally empty.
  }

  /**
   * Never called; present so the fake satisfies the client's shape.
   * @param request The resolved request.
   * @returns Returns the request, unused.
   */
  public resolve(request: ResolvedHttpRequest): ResolvedHttpRequest {
    return request;
  }
}

describe('ApiHistoryPanel (#882)', () => {
  let fixture: ComponentFixture<ApiHistoryPanel>;
  let workspace: ApiWorkspace;

  /**
   * Reads the panel's protected members, which are what the template binds to.
   */
  interface PanelInternals {
    readonly query: { set: (value: string) => void };
    readonly entries: () => readonly ApiHistoryEntry[];
  }

  /**
   * Gets the panel's internals for assertion.
   * @returns Returns the panel, typed to its protected surface.
   */
  function panel(): PanelInternals {
    return fixture.componentInstance as unknown as PanelInternals;
  }

  /**
   * Finds the strip's Clear button.
   * @returns Returns the button.
   */
  function clearButton(): HTMLButtonElement {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    return host.querySelector('app-panel-toolbar app-button button')!;
  }

  /**
   * Adds a request and sends it, so it lands in the history.
   * @param name The request's name.
   * @param url The request's address.
   */
  async function send(name: string, url: string): Promise<void> {
    const parent: string = workspace.folders()[0].id;
    await workspace.send(workspace.addRequest(parent, { name, url }).id);
  }

  beforeEach(async () => {
    globalThis.localStorage?.clear();
    await TestBed.configureTestingModule({
      imports: [ApiHistoryPanel],
      providers: [
        ApiWorkspace,
        { provide: ApiHttp, useClass: FakeHttp },
        { provide: ApiRequestOpener, useValue: { open: (): void => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiHistoryPanel);
    workspace = TestBed.inject(ApiWorkspace);
    fixture.componentRef.setInput('panel', {
      id: 'history',
      title: 'History',
      icon: Icon.API_HISTORY,
      role: 'tool',
      component: ApiHistoryPanel,
    } satisfies DockPanel);
    fixture.detectChanges();
  });

  it('drawsItsStrip_evenBeforeAnythingIsSent_withClearDisabled', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-panel-toolbar app-text-field[kind="search"]')).not.toBeNull();
    expect(clearButton().disabled).toBe(true);
  });

  it('filtersTheSends_byNameOrAddress_ignoringCase', async () => {
    await send('List users', 'https://api.test/users');
    await send('Get order', 'https://api.test/orders/1');

    panel().query.set('USERS');
    expect(
      panel()
        .entries()
        .map((entry: ApiHistoryEntry): string => entry.name),
    ).toEqual(['List users']);

    panel().query.set('order');
    expect(
      panel()
        .entries()
        .map((entry: ApiHistoryEntry): string => entry.name),
    ).toEqual(['Get order']);

    panel().query.set('  ');
    expect(panel().entries()).toHaveLength(2);
  });

  it('clear_emptiesTheHistory', async () => {
    await send('List users', 'https://api.test/users');
    fixture.detectChanges();

    expect(clearButton().disabled).toBe(false);
    clearButton().click();

    expect(workspace.history()).toEqual([]);
  });
});
