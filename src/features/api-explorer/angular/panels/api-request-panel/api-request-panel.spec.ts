import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import type { ApiRequest, HttpOutcome, HttpResponse } from '@shared/api/api-client-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../../api-workspace/api-workspace';
import { ApiRequestPanel } from './api-request-panel';

/**
 * The panel's handlers, which its template binds. The template itself is left out: its body editors
 * are Monaco, which jsdom cannot host.
 */
interface PanelHandlers {
  request(): ApiRequest | undefined;
  sending(): boolean;
  outcome(): HttpOutcome | null;
  response(): HttpResponse | null;
  responseVisible(): boolean;
  resolvedUrl(): string;
  send(): void;
  rename(name: string): void;
  updateField(list: string, edit: object): void;
  addField(list: string, row: object): void;
  removeField(list: string, id: string): void;
  setBodyKind(kind: string): void;
  setAuthKind(kind: string): void;
  updateAuth(changes: Record<string, string>): void;
  formatSize(bytes: number): string;
  prettyBody(response: HttpResponse): string;
  setTimeoutChoice(value: string): void;
  setRedirectChoice(value: string): void;
  statusTone(status: number): string;
  headerEntries(response: HttpResponse): readonly (readonly [string, string])[];
  bodyLanguage(kind: string): string;
  responseLanguage(response: HttpResponse): string;
}

/**
 * The workspace, over one request.
 */
class FakeWorkspace {
  public readonly requests: WritableSignal<readonly ApiRequest[]>;
  public readonly inFlight: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  public readonly activeEnvironment: WritableSignal<string | null> = signal<string | null>(null);
  public outcomes: Map<string, HttpOutcome> = new Map<string, HttpOutcome>();
  public sent: string[] = [];
  public cancelled: string[] = [];
  public variables: Map<string, string> = new Map<string, string>();

  public constructor(request: ApiRequest) {
    this.requests = signal<readonly ApiRequest[]>([request]);
  }

  public updateRequest(id: string, changes: Partial<ApiRequest>): void {
    this.requests.update((requests: readonly ApiRequest[]): readonly ApiRequest[] =>
      requests.map((request: ApiRequest): ApiRequest =>
        request.id === id ? { ...request, ...changes } : request,
      ),
    );
  }

  public outcome(id: string): HttpOutcome | null {
    return this.outcomes.get(id) ?? null;
  }

  public substitute(text: string): string {
    return this.variables.get(text) ?? text;
  }

  public async send(id: string): Promise<null> {
    this.sent.push(id);
    return Promise.resolve(null);
  }

  public cancel(id: string): void {
    this.cancelled.push(id);
  }
}

/**
 * A response with the given type and body.
 */
function jsonResponse(body: string, type: string = 'application/json'): HttpResponse {
  return {
    kind: 'response',
    status: 200,
    headers: { 'content-type': type },
    body,
  } as unknown as HttpResponse;
}

describe('ApiRequestPanel', () => {
  const request: ApiRequest = {
    id: 'request-1',
    name: 'Get things',
    method: 'GET',
    url: '{{base}}/things',
    params: [{ id: 'p1', name: 'page', value: '1', enabled: true }],
    headers: [],
    auth: { kind: 'none' },
    body: { kind: 'json', text: '{}', fields: [] },
  } as unknown as ApiRequest;

  let workspace: FakeWorkspace;
  let retitled: string[];
  let fixture: ComponentFixture<ApiRequestPanel>;
  let panel: PanelHandlers;

  beforeEach(() => {
    workspace = new FakeWorkspace(request);
    retitled = [];
    TestBed.overrideComponent(ApiRequestPanel, { set: { template: '', imports: [] } });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiWorkspace, useValue: workspace },
        {
          provide: ApiRequestOpener,
          useValue: { retitle: (_id: string, name: string): void => void retitled.push(name) },
        },
      ],
    });
    fixture = TestBed.createComponent(ApiRequestPanel);
    fixture.componentRef.setInput('panel', { id: 'request-1' });
    panel = fixture.componentInstance as unknown as PanelHandlers;
  });

  describe('sending', () => {
    it('send_sendsTheRequest', () => {
      panel.send();

      expect(workspace.sent).toEqual(['request-1']);
    });

    it('send_whileSending_cancelsInstead', () => {
      workspace.inFlight.set(new Set<string>(['request-1']));

      panel.send();

      expect(workspace.cancelled).toEqual(['request-1']);
      expect(workspace.sent).toEqual([]);
      expect(panel.responseVisible()).toBe(true);
    });

    it('anotherRequestSending_doesNotMarkThisOne', () => {
      workspace.inFlight.set(new Set<string>(['other']));

      expect(panel.sending()).toBe(false);
      expect(panel.responseVisible()).toBe(false);
    });

    it('outcome_refreshesWhenTheSendSettles', () => {
      workspace.inFlight.set(new Set<string>(['request-1']));
      expect(panel.outcome()).toBeNull();

      workspace.outcomes.set('request-1', jsonResponse('{}'));
      workspace.inFlight.set(new Set<string>());

      expect(panel.response()?.status).toBe(200);
    });

    it('aFailure_isNoResponse', () => {
      workspace.outcomes.set('request-1', { kind: 'failure', message: 'refused' } as HttpOutcome);
      workspace.inFlight.set(new Set<string>());

      expect(panel.outcome()).not.toBeNull();
      expect(panel.response()).toBeNull();
    });
  });

  describe('the url preview', () => {
    it('resolvedUrl_showsOnlyWhenAVariableChangedIt', () => {
      expect(panel.resolvedUrl()).toBe('');

      workspace.variables.set(request.url, 'https://x.test/things');
      workspace.activeEnvironment.set('production');

      expect(panel.resolvedUrl()).toBe('https://x.test/things');
    });

    it('resolvedUrl_ofARequestThatHasGone_isEmpty', () => {
      workspace.requests.set([]);

      expect(panel.resolvedUrl()).toBe('');
    });
  });

  describe('editing', () => {
    it('rename_retitlesTheTabToo', () => {
      panel.rename('Renamed');

      expect(panel.request()?.name).toBe('Renamed');
      expect(retitled).toEqual(['Renamed']);
    });

    it('field_edit_changesOnlyWhatChanged', () => {
      panel.updateField('params', { id: 'p1', value: '2' });

      expect(panel.request()?.params[0]).toMatchObject({ name: 'page', value: '2', enabled: true });
    });

    it('field_emptied_isRemoved', () => {
      panel.updateField('params', { id: 'p1', name: '', value: '' });

      expect(panel.request()?.params).toEqual([]);
    });

    it('field_added_isEnabledUnlessSaidOtherwise', () => {
      panel.addField('headers', { id: 'h1', name: 'Accept', value: '*/*' });
      panel.addField('headers', { id: 'h2', name: 'X', value: 'y', enabled: false });

      expect(
        panel.request()?.headers.map((field: { enabled: boolean }): boolean => field.enabled),
      ).toEqual([true, false]);
    });

    it('field_inTheBody_keepsTheRestOfTheBody', () => {
      panel.addField('body', { id: 'b1', name: 'a', value: 'b' });

      expect(panel.request()?.body).toMatchObject({ kind: 'json', text: '{}' });
      expect(panel.request()?.body.fields).toHaveLength(1);

      panel.removeField('body', 'b1');

      expect(panel.request()?.body.fields).toEqual([]);
    });

    it('edits_toARequestThatHasGone_doNothing', () => {
      workspace.requests.set([]);

      panel.addField('params', { id: 'x', name: 'a', value: 'b' });
      panel.setBodyKind('text');
      panel.updateAuth({ token: 'x' });

      expect(workspace.requests()).toEqual([]);
    });

    it('bodyKind_keepsTheTextForSwitchingBack', () => {
      panel.setBodyKind('xml');

      expect(panel.request()?.body).toMatchObject({ kind: 'xml', text: '{}' });
    });

    it('authKind_startsEachSchemeBlank_andAnUnknownOneIsNone', () => {
      panel.setAuthKind('basic');
      expect(panel.request()?.auth).toEqual({ kind: 'basic', username: '', password: '' });

      panel.updateAuth({ username: 'me' });
      expect(panel.request()?.auth).toMatchObject({ kind: 'basic', username: 'me' });

      panel.setAuthKind('nonsense');
      expect(panel.request()?.auth).toEqual({ kind: 'none' });
    });

    it('timeoutChoice_blankMeansTheSetting_zeroMeansNoLimit', () => {
      panel.setTimeoutChoice('0');
      expect(panel.request()?.timeoutSeconds).toBe(0);

      panel.setTimeoutChoice('');
      expect(panel.request()?.timeoutSeconds).toBeUndefined();
    });

    it('redirectChoice_blankMeansTheSetting', () => {
      panel.setRedirectChoice('report');
      expect(panel.request()?.followRedirects).toBe(false);

      panel.setRedirectChoice('follow');
      expect(panel.request()?.followRedirects).toBe(true);

      panel.setRedirectChoice('');
      expect(panel.request()?.followRedirects).toBeUndefined();
    });
  });

  describe('reading a response', () => {
    it('formatSize_picksAUnit', () => {
      expect(panel.formatSize(1023)).toBe('1023 B');
      expect(panel.formatSize(1536)).toBe('1.5 KB');
      expect(panel.formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('statusTone_groupsByClass', () => {
      expect(panel.statusTone(204)).toBe('ok');
      expect(panel.statusTone(304)).toBe('redirect');
      expect(panel.statusTone(500)).toBe('error');
    });

    it('prettyBody_indentsJson', () => {
      vi.spyOn(TestBed.inject(Settings), 'get').mockReturnValue(true);

      expect(panel.prettyBody(jsonResponse('{"a":1}'))).toBe('{\n  "a": 1\n}');
    });

    it('prettyBody_ofBrokenJson_showsItAsItCame', () => {
      vi.spyOn(TestBed.inject(Settings), 'get').mockReturnValue(true);

      expect(panel.prettyBody(jsonResponse('{"a":'))).toBe('{"a":');
    });

    it('prettyBody_leavesOtherTypesAlone_andRespectsTheSetting', () => {
      const get: MockInstance<Settings['get']> = vi
        .spyOn(TestBed.inject(Settings), 'get')
        .mockReturnValue(true);
      expect(panel.prettyBody(jsonResponse('{"a":1}', 'text/plain'))).toBe('{"a":1}');

      get.mockReturnValue(false);

      expect(panel.prettyBody(jsonResponse('{"a":1}'))).toBe('{"a":1}');
    });

    it('prettyBody_withoutAContentType_showsTheBody', () => {
      const response: HttpResponse = { headers: {}, body: '{}' } as unknown as HttpResponse;

      expect(panel.prettyBody(response)).toBe('{}');
    });

    it('languages_followTheContent', () => {
      expect(panel.bodyLanguage('json')).toBe('json');
      expect(panel.responseLanguage(jsonResponse('{}'))).toBe('json');
      expect(panel.headerEntries(jsonResponse('{}'))).toEqual([
        ['content-type', 'application/json'],
      ]);
    });
  });

  describe('teardown', () => {
    it('destroy_releasesTheViewportObserver', () => {
      const disconnect: ReturnType<typeof vi.fn<() => void>> = vi.fn<() => void>();
      class RecordingObserver {
        public observe(): void {
          /* jsdom has no layout to observe */
        }

        public disconnect(): void {
          disconnect();
        }
      }
      vi.stubGlobal('ResizeObserver', RecordingObserver);
      const observed: ComponentFixture<ApiRequestPanel> = TestBed.createComponent(ApiRequestPanel);
      observed.componentRef.setInput('panel', { id: 'request-1' });

      observed.destroy();

      expect(disconnect).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    });
  });
});
