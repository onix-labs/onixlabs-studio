import type { AiImageRef } from '@shared/api/ai-types';
import type { AgentItem } from '@shared/angular/services/agent/agent';

// A mock agent conversation holding everything a conversation can render (#855): every transcript
// row kind, every tool state, a sub-agent with its own nested activity, notices, and each prompt card
// both waiting and settled. Ordered to read as a plausible session rather than a list of specimens,
// because spacing and rhythm between rows are part of what is being reviewed.

/**
 * Draws a small stand-in screenshot for the user's attached image, so the fixture carries no blob.
 * @returns Returns the image.
 */
function screenshot(): AiImageRef {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 190;
  const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (context !== null) {
    const fill: CanvasGradient = context.createLinearGradient(0, 0, 320, 190);
    fill.addColorStop(0, '#0d6efd');
    fill.addColorStop(1, '#07b39b');
    context.fillStyle = fill;
    context.fillRect(0, 0, 320, 190);
    context.fillStyle = 'rgba(255, 255, 255, 0.85)';
    context.fillRect(24, 24, 180, 14);
    context.fillRect(24, 50, 260, 10);
    context.fillRect(24, 68, 220, 10);
    context.fillRect(24, 140, 90, 26);
  }
  // Where nothing can be drawn — a test environment has no canvas — a single accent pixel stands in.
  const drawn: string | null = context === null ? null : canvas.toDataURL('image/png');
  return {
    mediaType: 'image/png',
    data:
      drawn?.replace(/^data:image\/png;base64,/, '') ??
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAEdQH+bFhZxgAAAABJRU5ErkJggg==',
    name: 'settings-page.png',
  };
}

/**
 * Builds the conversation.
 * @returns Returns its items, in order.
 */
export function conversationFixture(): readonly AgentItem[] {
  return [
    {
      id: 'u1',
      kind: 'user',
      text: 'The **AI settings** page looks cramped in a narrow window — see the screenshot. Can you tidy the layout, and check nothing else uses those styles?',
      images: [screenshot()],
    },
    {
      id: 't1',
      kind: 'thinking',
      text: 'The user wants the settings page tidied at narrow widths. First I should find the stylesheet and anything else that imports it, then look at how the rows wrap.',
    },
    {
      id: 'a1',
      kind: 'assistant',
      text: "I'll start by finding the stylesheet and everything that shares it.",
    },
    {
      id: 'tool-grep',
      kind: 'tool',
      text: '',
      toolId: 'call-grep',
      toolName: 'Grep',
      toolDetail: 'ai-settings',
      toolState: 'ok',
      toolInput: '{\n  "pattern": "ai-settings",\n  "glob": "*.scss"\n}',
      toolOutput:
        'src/features/settings/angular/settings-view/sections/ai-settings/ai-settings.scss\nsrc/features/settings/angular/settings-view/settings-view.scss',
    },
    {
      id: 'tool-read',
      kind: 'tool',
      text: '',
      toolId: 'call-read',
      toolName: 'Read',
      toolDetail:
        'src/features/settings/angular/settings-view/sections/ai-settings/ai-settings.scss',
      toolState: 'ok',
      toolOutput: '.ai-group {\n  display: flex;\n  flex-direction: column;\n  gap: 0.5rem;\n}',
    },
    // A sub-agent: its own reasoning, tools and answer nest under the Task row that spawned it.
    {
      id: 'tool-task',
      kind: 'tool',
      text: '',
      toolId: 'call-task',
      toolName: 'Task',
      agentType: 'Explore',
      toolDetail: 'Find every component that renders inside the AI settings page',
      toolState: 'ok',
    },
    {
      id: 'sub-thinking',
      kind: 'thinking',
      text: 'Looking for components declared in the AI settings section.',
      parentToolId: 'call-task',
    },
    {
      id: 'sub-glob',
      kind: 'tool',
      text: '',
      toolId: 'call-sub-glob',
      toolName: 'Glob',
      toolDetail: 'src/features/settings/**/ai-*.ts',
      toolState: 'ok',
      parentToolId: 'call-task',
      toolOutput: 'ai-settings.ts\nai-connection-editor.ts\nai-tool-policies.ts\nai-write-paths.ts',
    },
    {
      id: 'sub-answer',
      kind: 'assistant',
      text: 'Four components render inside the page: the section itself, the connection editor, the tool policies and the write paths.',
      parentToolId: 'call-task',
    },
    {
      id: 'a2',
      kind: 'assistant',
      text: [
        'The page is built from four components. The cramped look comes from two rules:',
        '',
        '1. `.ai-group` has no wrap point, so its rows never stack.',
        '2. The connection editor fixes its controls at `16rem`.',
        '',
        '| Component | Fixed width | Wraps |',
        '| --- | --- | --- |',
        '| `ai-settings` | none | no |',
        '| `ai-connection-editor` | `16rem` | no |',
        '',
        "Here's the change I'd make:",
        '',
        '```scss',
        '.ai-group {',
        '  display: flex;',
        '  flex-wrap: wrap;',
        '  gap: 0.5rem;',
        '}',
        '```',
        '',
        'See the [layout guide](https://github.com/onix-labs/onixlabs-studio/wiki) for the breakpoints.',
      ].join('\n'),
    },
    {
      id: 'p1',
      kind: 'permission',
      text: '',
      permissionName: 'Bash',
      permissionDetail: 'npm run lint -- src/features/settings',
      permissionState: 'allowed',
      permissionRemember: 'session',
      permissionHasWorkspace: true,
    },
    {
      id: 'tool-lint',
      kind: 'tool',
      text: '',
      toolId: 'call-lint',
      toolName: 'Bash',
      toolDetail: 'npm run lint -- src/features/settings',
      toolState: 'error',
      toolInput: 'npm run lint -- src/features/settings',
      toolOutput:
        'src/features/settings/angular/settings-view/sections/ai-settings/ai-settings.scss\n  12:3  error  Unexpected unknown property "gap-x"  property-no-unknown\n\n✖ 1 problem (1 error, 0 warnings)',
    },
    {
      id: 'q1',
      kind: 'input-request',
      text: '',
      inputQuestion: 'Should the connection editor stack below 400px, or scroll sideways?',
      inputChoices: [
        { label: 'Stack', description: 'controls move under their labels' },
        { label: 'Scroll', description: 'the row keeps its layout and scrolls' },
      ],
      inputState: 'answered',
      inputAnswer: 'Stack',
    },
    {
      id: 'd1',
      kind: 'edit-decision',
      text: '',
      decisionName: 'ai-settings.scss',
      decisionDetail: '+6 lines, −2 characters',
      decisionState: 'applied',
      decisionHasDiff: true,
    },
    {
      id: 'n1',
      kind: 'notice',
      text: 'Background task finished',
      detail: 'npm run test -- --include ai-settings exited with code 0 after 41s.',
    },
    {
      id: 'n2',
      kind: 'notice',
      text: 'Conversation compacted',
    },
    {
      id: 'e1',
      kind: 'error',
      text: 'Request failed with status 529: the model is overloaded.',
      errorProvider: 'Claude (Agent SDK) · claude-opus-5',
      errorDetail: 'Request failed with status 529\n{"type":"overloaded_error"}',
      errorPrompt: 'Now do the same for the terminal settings.',
    },
    {
      id: 'u2',
      kind: 'user',
      text: 'Now do the same for the terminal settings.',
    },
    {
      id: 't2',
      kind: 'thinking',
      text: '',
    },
    {
      id: 'tool-test',
      kind: 'tool',
      text: '',
      toolId: 'call-test',
      toolName: 'Bash',
      toolDetail: 'npm run test:watch',
      toolState: 'backgrounded',
    },
    {
      id: 'tool-edit',
      kind: 'tool',
      text: '',
      toolId: 'call-edit',
      toolName: 'Edit',
      toolDetail:
        'src/features/settings/angular/settings-view/sections/terminal-settings/terminal-settings.scss',
      toolState: 'running',
    },
    {
      id: 'd2',
      kind: 'edit-decision',
      text: '',
      decisionName: 'terminal-settings.scss',
      decisionDetail: '+4 lines, +96 characters',
      decisionState: 'pending',
      decisionHasDiff: true,
    },
    {
      id: 'p2',
      kind: 'permission',
      text: '',
      permissionName: 'hosting_create_pull_request',
      permissionDetail:
        'GitHub: open a pull request “fix(settings): settings pages stack in narrow windows” from fix/settings-narrow into main in onix-labs/onixlabs-studio',
      permissionState: 'pending',
      permissionHasWorkspace: true,
    },
    {
      id: 'q2',
      kind: 'input-request',
      text: '',
      inputQuestion: 'Which branch should the pull request target?',
      inputChoices: [
        { label: 'main', description: 'the default branch' },
        { label: 'release/2026.10', description: 'the current release branch' },
      ],
      inputState: 'pending',
    },
  ];
}
