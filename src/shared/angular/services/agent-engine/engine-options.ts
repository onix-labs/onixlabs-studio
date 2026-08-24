import type { Signal } from '@angular/core';
import type { AiModelInfo, AiProviderId, AiProviderInfo } from '@shared/api/ai-types';
import type { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';

/**
 * Separates the provider id from the model id in an engine option value, which names a provider/model
 * pair rather than a model alone (the same model id can be offered by more than one connection).
 * Connection ids are seed slugs or generated as `kind-N` and so never contain this sequence: splitting
 * on its first occurrence recovers the pair exactly, leaving model ids — which are provider-authored
 * and may themselves contain punctuation, such as `llama3.1:8b` — untouched.
 */
const ENGINE_SEPARATOR: string = '::';

/**
 * Names the row shown beneath a provider that offers no models, so a connection that is registered but
 * has yet to discover its models stays visible in the picker rather than silently absent.
 */
const NO_MODELS_LABEL: string = 'No models available';

/**
 * Represents a provider/model pair recovered from an engine option value.
 */
export interface EngineSelection {
  /**
   * Gets the provider (connection) id.
   */
  readonly providerId: AiProviderId;

  /**
   * Gets the model id, empty for a provider that offers none.
   */
  readonly modelId: string;
}

/**
 * Represents something whose provider/model selection an engine picker drives — an {@link Agent} (one
 * conversation) or {@link AgentSessions} (whichever agent tab is active). Both expose the same three
 * members, so the pick is applied identically for either.
 */
export interface EngineSelectionTarget {
  /**
   * Gets the connection the target's runs currently go through.
   */
  readonly provider: Signal<AiProviderId>;

  /**
   * Selects the connection the target's runs go through, resetting its model to that connection's
   * default.
   * @param id The connection id.
   */
  setProvider(id: AiProviderId): void;

  /**
   * Selects the model the target's runs go through.
   * @param id The model id.
   */
  setModel(id: string): void;
}

/**
 * Composes the engine option value naming a provider/model pair.
 * @param providerId The provider (connection) id.
 * @param modelId The model id, empty for a provider that offers none.
 * @returns Returns the composed option value.
 */
export function engineOptionValue(providerId: AiProviderId, modelId: string): string {
  return `${providerId}${ENGINE_SEPARATOR}${modelId}`;
}

/**
 * Projects the registered providers onto dropdown options: every provider's models, each grouped under
 * its provider's label. Provider and model are offered as one field rather than two because the pair is
 * a single decision — picking a model implies the connection it runs through, and two fields could
 * otherwise be left momentarily disagreeing.
 * @param providers The registered providers, in display order.
 * @returns Returns the options, grouped by provider.
 */
export function engineOptions(providers: readonly AiProviderInfo[]): readonly DropdownOption[] {
  return providers.flatMap((provider: AiProviderInfo): readonly DropdownOption[] =>
    provider.models.length === 0
      ? [
          {
            value: engineOptionValue(provider.id, ''),
            label: NO_MODELS_LABEL,
            group: provider.label,
            disabled: true,
          },
        ]
      : provider.models.map(
          (model: AiModelInfo): DropdownOption => ({
            value: engineOptionValue(provider.id, model.id),
            label: model.label,
            group: provider.label,
          }),
        ),
  );
}

/**
 * Recovers the provider/model pair an engine option value names.
 * @param value The option value.
 * @returns Returns the pair, or null when the value does not name one.
 */
export function parseEngineOption(value: string): EngineSelection | null {
  const separator: number = value.indexOf(ENGINE_SEPARATOR);
  if (separator < 0) {
    return null;
  }
  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + ENGINE_SEPARATOR.length),
  };
}

/**
 * Applies a picked engine option to the given target. The provider is set first and only when it
 * actually changes: setting it resets the target's model to that provider's default, so the picked
 * model must be applied after, and re-setting the provider a pick did not change would needlessly
 * discard a model choice. Values naming an unregistered provider are ignored.
 * @param value The option value emitted by the picker.
 * @param providers The registered providers, used to reject a stale value.
 * @param target The selection the pick drives.
 */
export function applyEngineOption(
  value: string,
  providers: readonly AiProviderInfo[],
  target: EngineSelectionTarget,
): void {
  const selection: EngineSelection | null = parseEngineOption(value);
  if (selection === null) {
    return;
  }
  const match: AiProviderInfo | undefined = providers.find(
    (provider: AiProviderInfo): boolean => provider.id === selection.providerId,
  );
  if (match === undefined) {
    return;
  }
  if (match.id !== target.provider()) {
    target.setProvider(match.id);
  }
  target.setModel(selection.modelId);
}
