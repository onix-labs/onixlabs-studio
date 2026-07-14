// Shared AI-agent contract between the Electron (back-end) and Angular (front-end) processes. This is
// a barrel re-exporting the per-concern type modules under `./ai/` so consumers keep a single stable
// import path (`@shared/api/ai-types`) while each concern lives in its own file. Keep the whole surface
// platform-neutral (types and constants only — no Node or DOM dependencies), so both compilation
// targets can import it.

export {
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  EDIT_ACTIVE_DOCUMENT,
  INSERT_ACTIVE_DOCUMENT,
  READ_TERMINAL_OUTPUT,
  WRITE_TERMINAL_INPUT,
  READ_BINARY_OVERVIEW,
  READ_BINARY_BYTES,
  READ_BINARY_SELECTION,
  READ_BINARY_DISASSEMBLY,
  PATCH_BINARY_BYTES,
  INSERT_BINARY_BYTES,
  DELETE_BINARY_BYTES,
  WRITE_BINARY_ASSEMBLY,
  ASK_USER,
  PREVIEW_ACTIVE_DOCUMENT_EDIT,
  COMMIT_EDIT_PREVIEW,
  CANCEL_EDIT_PREVIEW,
} from './ai/ai-tool-surface';
export type { AgentSurface, InsertPlacement } from './ai/ai-tool-surface';
export type {
  AiAuthSource,
  AiAuthStatus,
  AiVerifyResult,
  AiConnectionAuthRequest,
  AiSetConnectionKeyRequest,
} from './ai/ai-auth-types';
export type { AiProviderId, AiModelInfo, AiProviderInfo } from './ai/ai-provider-types';
export type { AiProviderKind, AiAuthKind, AiConnection } from './ai/ai-connection-types';
export {
  SEED_CONNECTIONS,
  CLAUDE_CONNECTION_ID,
  ANTHROPIC_KEY_CONNECTION_ID,
  OLLAMA_CONNECTION_ID,
  DEFAULT_CONNECTION_ID,
} from './ai/ai-seed-connections';
export type {
  AiPermissionPosture,
  AiRunRequest,
  AiImageRef,
  AgentMode,
  AgentContextRef,
} from './ai/ai-run-types';
export type {
  AiRunState,
  AiEventBase,
  AiTextEvent,
  AiThinkingEvent,
  AiToolStartEvent,
  AiToolEndEvent,
  AiPermissionEvent,
  AiInputChoice,
  AiInputRequestEvent,
  AiEditDecisionEvent,
  AiStatusEvent,
  AiUsageEvent,
  AiEvent,
} from './ai/ai-event-types';
export type {
  AiBridgeRequest,
  AiBridgeReply,
  AiPermissionReply,
  AiPermissionRemember,
  AiInputReply,
  AiEditDecision,
  AiEditDecisionReply,
  AiSteerRequest,
} from './ai/ai-bridge-types';
