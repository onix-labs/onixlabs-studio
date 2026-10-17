import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { AiProviderInfo } from '@shared/api/ai-types';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { Search } from '@shared/angular/services/search/search';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { conversationFixture } from './conversation-fixture';

/**
 * The provider the mock conversation runs through, as the composer's picker shows it.
 */
const PROVIDER: AiProviderInfo = {
  id: 'anthropic-1',
  label: 'Claude',
  available: true,
  detail: '',
  defaultModelId: 'opus',
  models: [{ id: 'opus', label: 'Opus 5', contextWindow: 1_000_000 }],
};

/**
 * A stand-in for the agent session (#855): the transcript is the fixture, and everything the user
 * could do to it is accepted and ignored — the canvas is for looking at, not for running agents.
 * @param running Whether a turn is in flight.
 * @returns Returns the session.
 */
function mockAgent(running: boolean): Partial<Agent> {
  const ignore: () => void = (): void => undefined;
  return {
    items: signal<readonly AgentItem[]>(conversationFixture()),
    isRunning: signal<boolean>(running),
    awaitingDecision: signal<boolean>(false),
    pendingInput: signal<AgentItem | undefined>(undefined),
    tasks: signal([]),
    queued: signal([]),
    contextPaths: signal([]),
    contextTokens: signal<number>(184_000),
    pendingContextTokens: signal<number>(0),
    contextWindow: signal<number>(1_000_000),
    costUsd: signal<number>(1.42),
    billedPerToken: signal<boolean>(true),
    provider: signal<string>(PROVIDER.id),
    mode: signal<'agent'>('agent'),
    effort: signal(null),
    needsLogin: signal<boolean>(false),
    discoveredCommands: signal([]),
    send: ignore,
    stop: ignore,
    retry: ignore,
    rewind: ignore,
    respondPermission: ignore,
    respondInput: ignore,
    respondEditDecision: ignore,
    removeContext: ignore,
    attachContext: ignore,
    compact: ignore,
    clear: ignore,
    setMode: ignore,
    setEffort: ignore,
    dismissLoginPrompt: ignore,
    onLoginSucceeded: ignore,
    promptLogin: ignore,
    logout: (): Promise<void> => Promise.resolve(),
    removeQueued: ignore,
    takeQueued: (): null => null,
  };
}

/**
 * Renders a whole agent conversation from a fixture (#855): the real chat and composer, over stand-ins
 * for the session and the services around it. One per pane, at the pane's width, so resizing the
 * window is how its layout is reviewed.
 */
@Component({
  selector: 'app-canvas-conversation',
  imports: [AgentChat],
  template: '<app-agent-chat />',
  styles: ':host { display: flex; flex-direction: column; block-size: 100%; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // Mid-turn, so the live "Working…" row and the composer's Stop are part of what is reviewed.
    { provide: Agent, useFactory: (): Partial<Agent> => mockAgent(true) },
    {
      provide: AgentEngine,
      useValue: {
        providers: signal<readonly AiProviderInfo[]>([PROVIDER]),
        hasNoProviders: signal<boolean>(false),
        provider: signal<string>(PROVIDER.id),
        connection: (): undefined => undefined,
      },
    },
    {
      provide: AgentConversation,
      useValue: {
        draft: signal<string>(''),
        tailRequest: signal<number>(0),
        topRequest: signal<number>(0),
        promptRequest: signal<number>(0),
      },
    },
    { provide: Workspace, useValue: { root: signal<{ path: string } | null>({ path: '/repo' }) } },
    {
      provide: Search,
      useValue: { listFiles: (): Promise<readonly string[]> => Promise.resolve([]) },
    },
  ],
})
export class CanvasConversation {}
