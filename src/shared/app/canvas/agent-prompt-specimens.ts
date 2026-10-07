import type { AgentItem } from '@shared/angular/services/agent/agent';
import { AgentEditDecisionCard } from '@shared/angular/components/agent-cards/agent-edit-decision-card/agent-edit-decision-card';
import { AgentErrorCard } from '@shared/angular/components/agent-cards/agent-error-card/agent-error-card';
import { AgentPermissionCard } from '@shared/angular/components/agent-cards/agent-permission-card/agent-permission-card';
import { AgentQuestionCard } from '@shared/angular/components/agent-cards/agent-question-card/agent-question-card';
import { CanvasConversation } from './canvas-conversation';
import type { SpecimenPage } from './specimen';

// The agent conversation's prompt cards in every state (#855, #856). Fixtures are written as an agent
// would produce them — real tool names, real lengths — because the faults worth finding are the ones
// real content causes: a long command, a long repository name, a narrow panel.

/**
 * A permission prompt, pending, for the given tool.
 * @param name The tool.
 * @param detail What it would do.
 * @param extra Anything else.
 * @returns Returns the item.
 */
function permission(name: string, detail: string, extra: Partial<AgentItem> = {}): AgentItem {
  return {
    id: 'permission',
    kind: 'permission',
    text: '',
    permissionName: name,
    permissionDetail: detail,
    permissionState: 'pending',
    permissionHasWorkspace: true,
    ...extra,
  };
}

const QUESTION: AgentItem = {
  id: 'question',
  kind: 'input-request',
  text: '',
  inputQuestion: 'Which database should the order service use?',
  inputChoices: [
    { label: 'orders-db', description: 'the store the order service already uses' },
    { label: 'shared-postgres', description: 'the cluster every other service is moving to' },
    { label: 'Ask me later' },
  ],
  inputState: 'pending',
};

const DECISION: AgentItem = {
  id: 'decision',
  kind: 'edit-decision',
  text: '',
  decisionName: 'agent-chat.scss',
  decisionDetail: '+12 −4 lines',
  decisionState: 'pending',
  decisionHasDiff: true,
};

const ERROR: AgentItem = {
  id: 'error',
  kind: 'error',
  text: 'Request failed with status 529: the model is overloaded.',
  errorProvider: 'Claude (Agent SDK) · claude-opus-5',
  errorDetail: 'Request failed with status 529\n{"type":"overloaded_error","message":"Overloaded"}',
  errorPrompt: 'Refactor the settings page',
};

/**
 * The agent prompts page.
 */
export const AGENT_PROMPT_SPECIMENS: SpecimenPage = {
  title: 'Agent prompts',
  specimens: [
    {
      name: 'Permission',
      component: AgentPermissionCard,
      outputs: ['respond'],
      states: [
        { name: 'Pending', inputs: { item: permission('Bash', 'npm run build') } },
        {
          name: 'Pending · long command',
          inputs: {
            item: permission(
              'Bash',
              'git -C /Users/matthew/Development/ONIXLabs/onixlabs-studio rebase --onto origin/main 9dc80503 feat/866-model-list-updates && npm run test:coverage -- --reporter=verbose',
            ),
          },
        },
        {
          name: 'Pending · hosting write',
          inputs: {
            item: permission(
              'hosting_create_issue',
              'GitHub: open an issue “Saved AI provider configurations keep the model list they were created with” in onix-labs/onixlabs-studio',
            ),
          },
        },
        {
          name: 'Pending · no workspace',
          inputs: {
            item: permission('WebFetch', 'https://docs.github.com/en/rest', {
              permissionHasWorkspace: false,
            }),
          },
        },
        {
          name: 'Allowed',
          inputs: { item: permission('Bash', 'npm run build', { permissionState: 'allowed' }) },
        },
        {
          name: 'Allowed for this workspace',
          inputs: {
            item: permission('Bash', 'npm run build', {
              permissionState: 'allowed',
              permissionRemember: 'workspace',
            }),
          },
        },
        {
          name: 'Denied',
          inputs: { item: permission('Bash', 'rm -rf dist', { permissionState: 'denied' }) },
        },
        {
          name: 'Answered on another device',
          inputs: {
            item: permission('Bash', 'npm run build', { permissionState: 'dismissed' }),
          },
        },
      ],
    },
    {
      name: 'Question',
      component: AgentQuestionCard,
      outputs: ['answer'],
      states: [
        { name: 'Pending · suggestions', inputs: { item: QUESTION } },
        {
          name: 'Pending · free-form',
          inputs: {
            item: {
              ...QUESTION,
              inputQuestion: 'What should the new setting be called?',
              inputChoices: [],
            },
          },
        },
        {
          name: 'Answered',
          inputs: { item: { ...QUESTION, inputState: 'answered', inputAnswer: 'orders-db' } },
        },
        { name: 'Not answered', inputs: { item: { ...QUESTION, inputState: 'dismissed' } } },
      ],
    },
    {
      name: 'Edit decision',
      component: AgentEditDecisionCard,
      outputs: ['decide'],
      states: [
        { name: 'Pending · with diff', inputs: { item: DECISION } },
        {
          name: 'Pending · as Studio words it',
          inputs: { item: { ...DECISION, decisionDetail: '+3 lines, −120 characters' } },
        },
        {
          name: 'Pending · summary only',
          inputs: {
            item: {
              ...DECISION,
              decisionName: 'the active document',
              decisionDetail: 'Replace the introduction with a two-sentence summary.',
              decisionHasDiff: false,
            },
          },
        },
        { name: 'Applied', inputs: { item: { ...DECISION, decisionState: 'applied' } } },
        {
          name: 'Applied · auto-accepting',
          inputs: { item: { ...DECISION, decisionState: 'applied', decisionAuto: true } },
        },
        { name: 'Rejected', inputs: { item: { ...DECISION, decisionState: 'rejected' } } },
      ],
    },
    {
      name: 'Error',
      component: AgentErrorCard,
      outputs: ['retry'],
      states: [
        { name: 'Retryable', inputs: { item: ERROR } },
        { name: 'Retry held while a turn runs', inputs: { item: ERROR, busy: true } },
        {
          name: 'With a failing tool',
          inputs: { item: { ...ERROR, errorToolContext: 'Bash: npm: command not found' } },
        },
        { name: 'Retried', inputs: { item: { ...ERROR, errorRetried: true } } },
        {
          name: 'Not retryable',
          inputs: {
            item: {
              id: 'error',
              kind: 'error',
              text: 'No agent plugin runs this configuration.',
            },
          },
        },
      ],
    },
  ],
};

/**
 * A whole conversation, once per pane: every row a conversation can render, at the window's width.
 */
export const CONVERSATION_SPECIMENS: SpecimenPage = {
  title: 'Conversation',
  layout: 'single',
  specimens: [
    {
      name: 'Conversation',
      component: CanvasConversation,
      outputs: [],
      states: [{ name: 'Everything a conversation renders', inputs: {} }],
    },
  ],
};

/**
 * Every page of the canvas, in tab order.
 */
export const SPECIMEN_PAGES: readonly SpecimenPage[] = [
  AGENT_PROMPT_SPECIMENS,
  CONVERSATION_SPECIMENS,
];
