// How the settings UI groups AI connections into per-company pages, which sign-in methods each company
// offers, and how a connection is named in the agent provider picker.
//
// ⛔ **Nothing here names a provider (#653).** This file used to *be* the catalogue: `PROVIDER_PAGES`
// listed Anthropic, OpenAI, Google, DeepSeek, xAI and Ollama with their sign-in methods, and
// `COMPANY_LABELS` mapped every kind to a company name. Both shipped in the binary, so a fresh install
// offered pages for providers it had no way to run and no way to stop offering. The pages are built
// from what is *installed* now — an agent harness declares the providers it offers (manifest 1.12.0),
// and a provider with no installed harness has no page, because there would be nothing behind it.
//
// What is left is the shape of a page and the rules for turning contributions into pages. Pure and
// platform-neutral (no Electron, no Angular) so both the settings feature and the shared agent picker
// import it.

import type { ContributedAiProvider } from '../plugin-channels';
import type { AiModelInfo } from './ai-provider-types';
import type { AiAuthKind, AiProviderKind } from './ai-connection-types';

/**
 * Describes one authentication method a company offers, rendered as an add-button on the company's
 * settings page. Choosing it creates a connection with this {@link auth} kind, {@link defaultDisplayName}
 * label, and optional preset {@link baseUrl} (for a hosted tier reached over HTTP, such as Ollama Cloud).
 */
export interface AuthMethod {
  /**
   * Gets the auth kind a configuration added through this method uses.
   */
  readonly auth: AiAuthKind;

  /**
   * Gets the label shown on the method's add-button (for example `Subscription`, `API Key`, `Local`).
   */
  readonly buttonLabel: string;

  /**
   * Gets the default display name given to a configuration added through this method (the editable
   * {@link AiConnection.label}). It is the trailing half of the picker's `Company (Display Name)` label.
   */
  readonly defaultDisplayName: string;

  /**
   * Gets the base URL preset on a configuration added through this method, for a hosted tier that is not
   * the kind's default endpoint (Ollama Cloud). Absent leaves the connection's base URL unset.
   */
  readonly baseUrl?: string;

  /**
   * Gets a short human-readable description of the method, shown at the top of the configuration's body.
   */
  readonly hint: string;
}

/**
 * Describes one company page in the Providers branch of the AI settings: which connection kinds it
 * manages, the kind a new configuration is created as, the authentication methods it offers, and the
 * blurb shown beneath its "Configurations" heading.
 */
export interface ProviderPage {
  /**
   * Gets the page's stable identifier (the suffix of its `ai-provider-<id>` settings section).
   */
  readonly id: string;

  /**
   * Gets the company name shown as the page title.
   */
  readonly label: string;

  /**
   * Gets the connection kinds whose configurations appear on this page (usually one; the Custom page
   * shows both the generic `openai-compatible` and legacy `custom` kinds).
   */
  readonly kinds: readonly AiProviderKind[];

  /**
   * Gets the kind a configuration added on this page is created as.
   */
  readonly createKind: AiProviderKind;

  /**
   * Gets the authentication methods offered on this page, in button order.
   */
  readonly methods: readonly AuthMethod[];

  /**
   * Gets the blurb shown beneath the page's "Configurations" heading.
   */
  readonly description: string;
}

/**
 * Builds the company pages from the providers installed harnesses contribute.
 *
 * One page per provider `kind`. Two harnesses offering the same kind — an Anthropic subscription from
 * one plugin and an Anthropic API key from another — merge into one page rather than producing two
 * pages with the same title, because the user thinks in companies and a duplicate title is unreadable.
 * The first contribution to name a kind decides the company name and description; the sign-in methods
 * of both appear, in contribution order, de-duplicated by auth kind.
 *
 * ⚠️ Order is the contribution order, which is plugin-install order. Deliberately not sorted
 * alphabetically: a list that reorders itself when a plugin is installed is harder to use than one that
 * appends.
 * @param providers The providers contributed by installed harnesses, in contribution order.
 * @returns Returns the pages, empty when nothing is installed.
 */
export function pagesFromContributions(
  providers: readonly ContributedAiProvider[],
): readonly ProviderPage[] {
  const byKind: Map<string, ProviderPage> = new Map<string, ProviderPage>();
  for (const provider of providers) {
    const existing: ProviderPage | undefined = byKind.get(provider.kind);
    const methods: AuthMethod[] = [...(existing?.methods ?? [])];
    for (const method of provider.authMethods) {
      if (methods.some((candidate: AuthMethod): boolean => candidate.auth === method.auth)) {
        continue;
      }
      methods.push({
        auth: method.auth,
        buttonLabel: method.buttonLabel,
        defaultDisplayName: method.defaultDisplayName,
        hint: method.hint ?? '',
        ...(method.baseUrl === undefined ? {} : { baseUrl: method.baseUrl }),
      });
    }
    byKind.set(provider.kind, {
      id: provider.kind,
      label: existing?.label ?? provider.company,
      kinds: [provider.kind],
      createKind: provider.kind,
      methods,
      description: existing?.description ?? provider.description ?? '',
    });
  }
  return [...byKind.values()];
}

/**
 * Gets the models a new configuration on a page starts with, from the contributions behind it.
 * @param providers The contributed providers.
 * @param kind The provider kind being created.
 * @returns Returns the models, empty when none were contributed.
 */
export function modelsForKind(
  providers: readonly ContributedAiProvider[],
  kind: string,
): readonly AiModelInfo[] {
  const seen: Set<string> = new Set<string>();
  const models: AiModelInfo[] = [];
  for (const provider of providers) {
    if (provider.kind !== kind) {
      continue;
    }
    for (const model of provider.models ?? []) {
      if (seen.has(model.id)) {
        continue;
      }
      seen.add(model.id);
      models.push({ id: model.id, label: model.label, contextWindow: model.contextWindow });
    }
  }
  return models;
}

/**
 * Finds the company page a connection kind belongs to.
 * @param kind The connection kind.
 * @returns Returns the page, or undefined when the kind has no page.
 */
export function providerPageForKind(
  pages: readonly ProviderPage[],
  kind: AiProviderKind,
): ProviderPage | undefined {
  return pages.find((page: ProviderPage): boolean => page.kinds.includes(kind));
}

/**
 * Composes the agent picker's label for a connection: the company name followed by the connection's
 * display name in brackets (for example `Anthropic (Claude)` or `Ollama (Local)`).
 * @param kind The connection kind.
 * @param displayName The connection's display name (its label).
 * @returns Returns the composed label.
 */
export function providerDisplayLabel(
  company: string | undefined,
  kind: AiProviderKind,
  displayName: string,
): string {
  // ⚠️ Falls back to the kind when no installed harness claims it. A connection whose provider plugin
  // was uninstalled still has to be listed and still has to read as something; showing the raw kind is
  // honest about what is known, where a blank company would read as a rendering fault.
  const title: string = company ?? kind;
  const name: string = displayName.trim();
  return name.length > 0 ? `${title} (${name})` : title;
}
