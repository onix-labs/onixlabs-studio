import { MainContribution } from './main-contribution';
import { sampleContribution } from './sample-contribution';

/**
 * The static, in-bundle manifest of main-process contributions the application activates at startup —
 * the backend analog of the renderer's `config.ts` provider list, and the extension point of this
 * phase. A backend is added by appending here, never by editing the application's construction logic.
 *
 * It starts with the no-op {@link sampleContribution} so the seam is exercised live; a real backend
 * (P3's Docker Engine contribution, #391) is added by appending its contribution and dropping the
 * sample. When runtime discovery of third-party extensions lands (#295), the registry is constructed
 * from this manifest *plus* the discovered contributions — the same type, an extra source.
 */
export const mainContributions: readonly MainContribution[] = [sampleContribution];
