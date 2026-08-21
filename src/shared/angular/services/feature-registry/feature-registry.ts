import { inject, Service, signal, Type, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DEFAULT_FEATURE_CHROME, FeatureChrome, FeatureDescriptor } from './feature-descriptor';

/**
 * Holds the features contributed to the application shell, keyed by tab type. The content host,
 * ribbon strip, and chrome gating render from this registry instead of switching on a closed set of
 * tab types, so a feature is wholly described by the {@link FeatureDescriptor} it registers (via
 * {@link provideFeature}) and owns no code in the shell.
 *
 * Registration happens once, at start-up, before the first view renders. The backing map is held in
 * a signal so the shell's templates react if a feature registers after first paint.
 */
@Service()
export class FeatureRegistry {
  /**
   * Holds every registered feature descriptor, keyed by tab type.
   */
  private readonly descriptors: WritableSignal<ReadonlyMap<string, FeatureDescriptor>> = signal(
    new Map<string, FeatureDescriptor>(),
  );

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Registers a feature's contribution to the shell. Re-registering a type replaces the previous
   * descriptor.
   * @param descriptor The feature descriptor to register.
   */
  public register(descriptor: FeatureDescriptor): void {
    this.descriptors.update(
      (current: ReadonlyMap<string, FeatureDescriptor>): ReadonlyMap<string, FeatureDescriptor> => {
        const next: Map<string, FeatureDescriptor> = new Map<string, FeatureDescriptor>(current);
        next.set(descriptor.type, descriptor);
        return next;
      },
    );
    this.log.info('FeatureRegistry', `Feature registered '${descriptor.type}'`);
  }

  /**
   * Gets the view component registered for a tab type.
   * @param type The tab type, or undefined when no tab is active.
   * @returns Returns the view component, or undefined when the type has no registered feature.
   */
  public viewFor(type: string | undefined): Type<unknown> | undefined {
    return type === undefined ? undefined : this.descriptors().get(type)?.view;
  }

  /**
   * Gets the contextual ribbon component registered for a tab type.
   * @param type The tab type, or undefined when no tab is active.
   * @returns Returns the ribbon component, or undefined when the type has no registered feature or
   * the feature contributes no ribbon.
   */
  public ribbonFor(type: string | undefined): Type<unknown> | undefined {
    return type === undefined ? undefined : this.descriptors().get(type)?.ribbon;
  }

  /**
   * Gets the status component registered for a tab type, shown in the status strip while a tab of
   * that type is active.
   * @param type The tab type, or undefined when no tab is active.
   * @returns Returns the status component, or undefined when the type has no registered feature or
   * the feature contributes no status.
   */
  public statusFor(type: string | undefined): Type<unknown> | undefined {
    return type === undefined ? undefined : this.descriptors().get(type)?.status;
  }

  /**
   * Gets the document-panel component registered for a feature type, mounted in a workspace document
   * well to display an open document of that type.
   * @param type The feature type, or undefined when none resolves.
   * @returns Returns the document-panel component, or undefined when the type has no registered
   * feature or the feature contributes no document panel.
   */
  public documentPanelFor(type: string | undefined): Type<unknown> | undefined {
    return type === undefined ? undefined : this.descriptors().get(type)?.documentPanel;
  }

  /**
   * Gets the chrome policy for a tab type, with any unset fields defaulted to visible.
   * @param type The tab type, or undefined when no tab is active.
   * @returns Returns the resolved chrome policy; both strips are visible for an unregistered type.
   */
  public chromeFor(type: string | undefined): FeatureChrome {
    const chrome: Partial<FeatureChrome> | undefined =
      type === undefined ? undefined : this.descriptors().get(type)?.chrome;
    return { ...DEFAULT_FEATURE_CHROME, ...chrome };
  }
}
