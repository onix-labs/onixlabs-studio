import { InjectionToken } from '@angular/core';
import {
  AgentConversationAgentType,
  ConversationContext,
} from '@shared/api/agent-conversation-channels';

/**
 * Resolves the conversation context an agent host belongs to, read at call time so it reflects the
 * current workspace/repository state. Provided by an IDE view (the workspace directory view resolves a
 * `workspace` context, the source-control view a `repository` context); absent for hosts that carry no
 * IDE context.
 */
export type ConversationContextResolver = () => ConversationContext;

/**
 * The injection token an IDE view provides so the agent panels docked inside it resolve their
 * conversation context. {@link import('../agent-conversation/agent-conversation').AgentConversation}
 * injects it optionally and falls back to the global context when it is absent. A specialized host (a
 * file editor's agent panel) instead binds an explicit context signal, which wins over this token.
 */
export const AGENT_CONVERSATION_CONTEXT: InjectionToken<ConversationContextResolver> =
  new InjectionToken<ConversationContextResolver>('AGENT_CONVERSATION_CONTEXT');

/**
 * The context used for conversations that are not tied to any workspace, repository, or file — the
 * standalone "new agent" tab.
 */
export const GLOBAL_CONVERSATION_CONTEXT: ConversationContext = { kind: 'global', key: '' };

/**
 * The injection token an agent host provides to declare the kind of agent it is, recorded on the
 * conversations it creates and shown as their primary metadata chip (Agent, Code, Workspace, Terminal,
 * Review, …). This is informational only — it never scopes which conversations a history panel shows.
 * {@link import('../agent-conversation/agent-conversation').AgentConversation} injects it optionally and
 * falls back to deriving a type from the conversation's context kind when it is absent.
 */
export const AGENT_CONVERSATION_KIND: InjectionToken<AgentConversationAgentType> =
  new InjectionToken<AgentConversationAgentType>('AGENT_CONVERSATION_KIND');

/**
 * Derives a fallback agent type from a conversation's context kind, used for conversations that carry
 * no explicitly-recorded agent type (older records, or hosts that declare none). It maps location to a
 * best-guess type: global → agent, file → code, workspace → workspace, repository → review.
 * @param kind The context kind.
 * @returns Returns the derived agent type.
 */
export function agentTypeFromContextKind(kind: string): AgentConversationAgentType {
  switch (kind) {
    case 'file':
      return 'code';
    case 'workspace':
      return 'workspace';
    case 'repository':
      return 'review';
    default:
      return 'agent';
  }
}
