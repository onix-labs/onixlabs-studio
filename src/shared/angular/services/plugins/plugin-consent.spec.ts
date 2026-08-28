import { TestBed } from '@angular/core/testing';
import { PluginSummary } from '@shared/api/plugin-channels';
import { PluginConsent } from './plugin-consent';

/**
 * Builds a plugin summary.
 * @param id The plugin identifier.
 * @returns Returns the summary.
 */
function plugin(id: string): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state: 'available',
    contributions: [],
    version: '1.0.0',
    detail: null,
    origin: null,
    installedVersion: null,
  };
}

describe('PluginConsent', () => {
  let consent: PluginConsent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    consent = TestBed.inject(PluginConsent);
  });

  it('request_putsThePluginUp_andAcceptResolvesTrue', async () => {
    const answer: Promise<boolean> = consent.request(plugin('pyright'));

    expect(consent.pending()?.id).toBe('pyright');
    consent.accept();

    expect(await answer).toBe(true);
    expect(consent.pending()).toBeNull();
  });

  it('decline_resolvesFalse_andClearsTheQuestion', async () => {
    const answer: Promise<boolean> = consent.request(plugin('pyright'));
    consent.decline();

    expect(await answer).toBe(false);
    expect(consent.pending()).toBeNull();
  });

  it('request_whileAnotherIsBeingAsked_isRefused', async () => {
    // A second dialog appearing the moment the first is answered invites a reflex click; one
    // question at a time.
    const first: Promise<boolean> = consent.request(plugin('pyright'));
    const second: Promise<boolean> = consent.request(plugin('ty'));

    expect(await second).toBe(false);
    expect(consent.pending()?.id).toBe('pyright');
    consent.accept();
    expect(await first).toBe(true);
  });

  it('acceptOrDecline_withNothingAsked_isANoOp', () => {
    consent.accept();
    consent.decline();

    expect(consent.pending()).toBeNull();
  });
});
