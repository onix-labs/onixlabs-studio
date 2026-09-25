import { FeatureDescriptor, FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';

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
    import('@features/api-explorer/angular/api-explorer.feature'),
  (): Promise<{ descriptor: FeatureDescriptor }> =>
    import('@features/containers/angular/containers.feature'),
  (): Promise<{ descriptor: FeatureDescriptor }> =>
    import('@features/model-manager/angular/model-manager.feature'),
  (): Promise<{ descriptor: FeatureDescriptor }> =>
    import('@features/plugin-manager/angular/plugin-manager.feature'),
  (): Promise<{ descriptor: FeatureDescriptor }> =>
    import('@features/system-monitor/angular/system-monitor.feature'),
];

/**
 * Registers one resolved lazy contribution with the shell: its keybinding catalogue entry first, then
 * the descriptor itself. The order matters — the shell mounts the feature's view as soon as the
 * descriptor lands, and the view registers its accelerators on activation, which the catalogue would
 * skip as unknown ids if the entry were not already in it.
 * @param descriptor The descriptor the contribution's thunk resolved to.
 * @param registry The feature registry the shell renders from.
 * @param keybindings The keybinding service the catalogue entry is contributed to.
 */
export function registerFeatureContribution(
  descriptor: FeatureDescriptor,
  registry: FeatureRegistry,
  keybindings: Keybindings,
): void {
  if (descriptor.keybindings !== undefined) {
    keybindings.contribute(descriptor.keybindings);
  }
  registry.register(descriptor);
}
