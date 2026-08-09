import { ContributionContext, MainContribution } from './main-contribution';

/**
 * The channel the {@link sampleContribution} answers, namespaced by its id. Kept local rather than
 * promoted to the shared IPC contract because this contribution exists only to prove the seam is live;
 * it is removed once a real backend (P3's Docker Engine contribution, #391) takes its place in the
 * manifest.
 */
export const SAMPLE_PING_CHANNEL: string = 'contribution:sample:ping';

/**
 * A no-op sample contribution that proves the main-process contribution seam end to end: it activates
 * through the registry, registers one invoke channel over the context (so the renderer can round-trip
 * it), and needs no explicit teardown — the registry removes the channel it registered on dispose.
 * This is the P1 north-star at runtime; it declares no permissions and touches nothing else.
 */
export const sampleContribution: MainContribution = {
  id: 'sample',

  activate(context: ContributionContext): void {
    context.log.info('sample contribution activated');
    context.handle(SAMPLE_PING_CHANNEL, (): string => 'pong');
  },
};
