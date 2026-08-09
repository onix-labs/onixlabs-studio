import { FeatureDescriptor } from '@shared/angular/services/feature-registry';

/**
 * The renderer analog of the main process's `mainContributions` manifest: the list of lazily-loaded
 * feature contributions the shell registers at start-up. Each entry is a thunk that dynamic-imports a
 * feature module and yields its {@link FeatureDescriptor} — so the feature's view/ribbon land in their
 * own code-split chunk, resolved at runtime, rather than the initial bundle.
 *
 * This is the seam that lets a feature be added with no edit to any shell component: a new feature
 * appends one thunk here (and creates its slice), and the one-time driver in `config.ts` registers
 * whatever descriptor the thunk resolves to. Eagerly-wired features (the `provideXFeature()` calls in
 * `config.ts`) continue to work unchanged alongside these; this manifest is purely additive.
 *
 * Third-party, discovered contributions (#295) would feed the same driver from an additional source —
 * the same descriptor type, resolved the same way.
 */
export const featureContributions: readonly (() => Promise<{ descriptor: FeatureDescriptor }>)[] = [
  (): Promise<{ descriptor: FeatureDescriptor }> =>
    import('@features/containers/angular/containers.feature'),
];
