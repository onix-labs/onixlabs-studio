// What a fresh install starts with, which is now **nothing**.
//
// ⛔ This file used to seed four connections — Claude, Codex, an Anthropic API key and Ollama — each
// with a hardcoded model list (`claude-opus-4-8`, `gpt-5.6-sol`, `qwen3:8b`). That made a fresh binary
// ship configurations for providers it had no way to run, which is the inverse of what #653 set out to
// deliver: a binary with no AI providers in core, where installing a plugin is what makes a provider
// available at all.
//
// A configuration is created by the user from a company page, and a company page exists only because an
// installed harness contributes it (manifest 1.12.0). So an empty list here is not a gap to be filled
// later — it is the whole point, and anything added back is core shipping a provider again.

import type { AiConnection } from './ai-connection-types';

/**
 * The connection id a pre-connections upgrade migrates its single stored Anthropic key onto.
 *
 * ⚠️ Kept only for that migration. It names no connection this build creates — the key is carried
 * forward under this id so a user who later creates an Anthropic configuration through the plugin finds
 * their key already there, rather than silently losing it on upgrade.
 */
export const ANTHROPIC_KEY_CONNECTION_ID: string = 'vercel';

/**
 * The connection active by default, which is none.
 *
 * Empty rather than a provider's name: with nothing seeded there is nothing to be active until the user
 * creates a configuration, and naming an absent one would have the picker claim a selection it cannot
 * resolve.
 */
export const DEFAULT_CONNECTION_ID: string = '';

/**
 * The connections a fresh install starts with: none. See the note at the top of this file.
 */
export const SEED_CONNECTIONS: readonly AiConnection[] = [];
