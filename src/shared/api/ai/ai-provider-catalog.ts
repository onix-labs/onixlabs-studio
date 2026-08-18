// The presentation catalogue for AI providers: how the settings UI groups connections into per-company
// pages, which authentication methods each company offers (the add-buttons on its page), and how a
// connection is named in the agent provider picker. This is pure, platform-neutral data (no Electron or
// Angular dependency) so both the settings feature and the shared agent picker import it.
//
// A "connection" (see {@link AiConnection}) is still the unit of configuration; this catalogue only
// decides how connections are surfaced. A page shows every connection whose {@link AiConnection.kind}
// is one of its {@link ProviderPage.kinds}, and adding a configuration through one of the page's
// {@link ProviderPage.methods} creates a connection of the page's {@link ProviderPage.createKind} with
// that method's auth kind, default display name, and (for hosted local tiers) base URL.

import type { AiAuthKind, AiProviderKind } from './ai-connection-types';

/**
 * The company name shown for a connection of each kind, used both as the settings page title and as the
 * leading half of the agent picker's `Company (Display Name)` label. The two generic escape-hatch kinds
 * (`openai-compatible` and legacy `custom`) both surface under a single "Custom" company.
 */
export const COMPANY_LABELS: Readonly<Record<AiProviderKind, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  ollama: 'Ollama',
  'openai-compatible': 'Custom',
  custom: 'Custom',
};

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
 * A subscription method reusing the user's local Claude login through the Claude Agent SDK.
 */
const CLAUDE_SUBSCRIPTION: AuthMethod = {
  auth: 'claude-login',
  buttonLabel: 'Subscription',
  defaultDisplayName: 'Claude',
  hint: 'Uses your local Claude login (~/.claude) through the Claude Agent SDK.',
};

/**
 * A subscription method reusing the user's local Codex login through the OpenAI Codex CLI.
 */
const CODEX_SUBSCRIPTION: AuthMethod = {
  auth: 'codex-login',
  buttonLabel: 'Subscription',
  defaultDisplayName: 'Codex',
  hint: 'Uses your local Codex login (~/.codex) through the OpenAI Codex CLI.',
};

/**
 * Builds an API-key method with a company-specific hint.
 * @param company The company name, for the hint.
 * @param displayName The default display name (defaults to "API Key").
 * @returns Returns the method.
 */
function apiKeyMethod(company: string, displayName: string = 'API Key'): AuthMethod {
  return {
    auth: 'api-key',
    buttonLabel: 'API Key',
    defaultDisplayName: displayName,
    hint: `Uses a ${company} API key, stored encrypted on this machine.`,
  };
}

/**
 * The company pages shown in the Providers branch of the AI settings, in display order. This is the
 * single source of truth for the branch's leaves, each page's add-buttons, and the company half of the
 * agent picker label.
 *
 * xAI is API-key only for now: a real Grok subscription would need a dedicated live-harness (like Claude
 * and Codex), which does not yet exist.
 */
export const PROVIDER_PAGES: readonly ProviderPage[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    kinds: ['anthropic'],
    createKind: 'anthropic',
    methods: [CLAUDE_SUBSCRIPTION, apiKeyMethod('Anthropic')],
    description:
      'Run Claude through your Claude subscription (local login) or an Anthropic API key. Add one configuration per account.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kinds: ['openai'],
    createKind: 'openai',
    methods: [CODEX_SUBSCRIPTION, apiKeyMethod('OpenAI')],
    description:
      'Run OpenAI models through your Codex subscription (local login) or an OpenAI API key.',
  },
  {
    id: 'google',
    label: 'Google',
    kinds: ['google'],
    createKind: 'google',
    methods: [apiKeyMethod('Google Gemini')],
    description: 'Run Gemini models through a Google AI API key.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kinds: ['deepseek'],
    createKind: 'deepseek',
    methods: [apiKeyMethod('DeepSeek')],
    description: 'Run DeepSeek models through a DeepSeek API key.',
  },
  {
    id: 'xai',
    label: 'xAI',
    kinds: ['xai'],
    createKind: 'xai',
    methods: [apiKeyMethod('xAI')],
    description: 'Run Grok models through an xAI API key.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kinds: ['ollama'],
    createKind: 'ollama',
    methods: [
      {
        auth: 'none',
        buttonLabel: 'Local',
        defaultDisplayName: 'Local',
        hint: 'Talks to a local Ollama server. No credentials needed.',
      },
      {
        auth: 'api-key',
        buttonLabel: 'Cloud',
        defaultDisplayName: 'Cloud',
        baseUrl: 'https://ollama.com',
        hint: 'Uses the hosted Ollama Cloud tier with an API key.',
      },
    ],
    description:
      'Run local models through Ollama, or the hosted Ollama Cloud tier with an API key.',
  },
  {
    id: 'custom',
    label: 'Custom',
    kinds: ['openai-compatible', 'custom'],
    createKind: 'openai-compatible',
    methods: [
      {
        auth: 'api-key',
        buttonLabel: 'API Key',
        defaultDisplayName: 'Custom',
        hint: 'Any OpenAI-compatible endpoint reached with a base URL and an API key (OpenRouter, a gateway, a proxy).',
      },
      {
        auth: 'none',
        buttonLabel: 'Local',
        defaultDisplayName: 'Local',
        hint: 'A keyless OpenAI-compatible endpoint reached with a base URL (LM Studio, vLLM).',
      },
    ],
    description:
      'Point at any OpenAI-compatible endpoint — a self-hosted server, a gateway, or a third-party service — with its own base URL.',
  },
];

/**
 * Finds the company page a connection kind belongs to.
 * @param kind The connection kind.
 * @returns Returns the page, or undefined when the kind has no page.
 */
export function providerPageForKind(kind: AiProviderKind): ProviderPage | undefined {
  return PROVIDER_PAGES.find((page: ProviderPage): boolean => page.kinds.includes(kind));
}

/**
 * Composes the agent picker's label for a connection: the company name followed by the connection's
 * display name in brackets (for example `Anthropic (Claude)` or `Ollama (Local)`).
 * @param kind The connection kind.
 * @param displayName The connection's display name (its label).
 * @returns Returns the composed label.
 */
export function providerDisplayLabel(kind: AiProviderKind, displayName: string): string {
  const company: string = COMPANY_LABELS[kind];
  const name: string = displayName.trim();
  return name.length > 0 ? `${company} (${name})` : company;
}
