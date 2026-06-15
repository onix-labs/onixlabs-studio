import { TestBed } from '@angular/core/testing';
import { LspIndicator, LspStatus } from './lsp-status';

describe('LspStatus', () => {
  let status: LspStatus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    status = TestBed.inject(LspStatus);
  });

  it('indicator_whenNoServers_isNull', () => {
    expect(status.indicator()).toBeNull();
  });

  it('indicator_whenServerStarting_showsStartingState', () => {
    status.report('/root::java', 'java', 'starting');

    const indicator: LspIndicator | null = status.indicator();
    expect(indicator?.state).toBe('starting');
    expect(indicator?.label).toContain('Java');
    expect(indicator?.label).toContain('starting');
  });

  it('indicator_whenServerReady_showsReadyState', () => {
    status.report('/root::typescript', 'typescript', 'ready');

    const indicator: LspIndicator | null = status.indicator();
    expect(indicator?.state).toBe('ready');
    expect(indicator?.label).toContain('TypeScript');
  });

  it('indicator_prefersStartingOverReady', () => {
    status.report('/root::typescript', 'typescript', 'ready');
    status.report('/root::java', 'java', 'starting');

    expect(status.indicator()?.state).toBe('starting');
  });

  it('indicator_prefersReadyOverUnavailable', () => {
    status.report('/root::java', 'java', 'unavailable');
    status.report('/root::typescript', 'typescript', 'ready');

    expect(status.indicator()?.state).toBe('ready');
  });

  it('indicator_whenOnlyUnavailable_showsUnavailableState', () => {
    status.report('/root::java', 'java', 'unavailable');

    expect(status.indicator()?.state).toBe('unavailable');
  });

  it('indicator_whenUnavailableWithReason_showsTheReason', () => {
    status.report('/root::java', 'java', 'unavailable', 'Java 21+ runtime not found');

    expect(status.indicator()?.label).toBe('Java 21+ runtime not found');
  });

  it('remove_clearsTheContribution', () => {
    status.report('/root::java', 'java', 'ready');
    status.remove('/root::java');

    expect(status.indicator()).toBeNull();
  });
});
