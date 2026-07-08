import { InjectionToken } from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';

/**
 * Resolves the conversation context an agent host belongs to, read at call time so it reflects the
 * current workspace/repository state. Provided by an IDE view (the workspace directory view resolves a
 * `workspace` context, the source-control view a `repository` context); absent for hosts that carry no
 * IDE context.
 */
export type ConversationContextResolver = () => ConversationContext;

/**
 * The injection token an IDE view provides so the agent panels docked inside it resolve their
 * conversation context. {@link import('../../components/agent-chat/agent-chat').AgentChat} injects it
 * optionally and falls back to the global context when it is absent. A specialized host (a file
 * editor's agent panel) instead passes an explicit context input, which wins over this token.
 */
export const AGENT_CONVERSATION_CONTEXT: InjectionToken<ConversationContextResolver> =
  new InjectionToken<ConversationContextResolver>('AGENT_CONVERSATION_CONTEXT');

/**
 * The context used for conversations that are not tied to any workspace, repository, or file — the
 * standalone "new agent" tab.
 */
export const GLOBAL_CONVERSATION_CONTEXT: ConversationContext = { kind: 'global', key: '' };
