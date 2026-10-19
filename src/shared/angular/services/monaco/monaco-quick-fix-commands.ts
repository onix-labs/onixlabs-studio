import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY, focusedEditor } from './monaco-find-commands';

/**
 * Lists every Monaco command that opens Monaco's code-action widget, or asks for code actions to apply
 * (#1016): Quick Fix (⌘.), the generic code-action command, Refactor (⌃⇧R), Source Action, Organize
 * Imports (⌥⇧O), Auto Fix (⌥⇧.) and Fix All. Each has all of its default chords removed, on every
 * platform; Studio's Quick Fix takes ⌘. (Ctrl+.) instead. The commands themselves stay: Code Cleanup
 * still organises imports through Monaco's own command.
 */
export const MONACO_CODE_ACTION_COMMANDS: readonly string[] = [
  'editor.action.quickFix',
  'editor.action.codeAction',
  'editor.action.refactor',
  'editor.action.sourceAction',
  'editor.action.organizeImports',
  'editor.action.autoFix',
  'editor.action.fixAll',
];

/**
 * Names Studio's Quick Fix command, bound to ⌘. (Ctrl+.) in every editor, on every platform.
 */
export const STUDIO_QUICK_FIX_COMMAND: string = 'studio.quickFix';

/**
 * Names the editor contribution behind Monaco's code actions: every route to Monaco's code-action
 * widget — its chords, the lightbulb, the "Quick Fix…" link in a problem's hover — ends in one of its
 * methods.
 */
export const CODE_ACTION_CONTRIBUTION: string = 'editor.contrib.codeActionController';

/**
 * Holds the editor options that keep Monaco's lightbulb off in every editor (#1016): Studio draws its
 * own fix icon. With the lightbulb off Monaco never looks for code actions on its own either. Applied
 * to every editor as it is created, and to the options every editor is created with.
 */
export const QUICK_FIX_EDITOR_OPTIONS: MonacoApi.editor.IEditorOptions = {
  // `ShowLightbulbIconMode.Off`, written as its value: the enum is not loaded here.
  lightbulb: { enabled: 'off' as MonacoApi.editor.ShowLightbulbIconMode },
};

/**
 * The part of Monaco's code-action contribution Studio replaces: each way it opens its widget, and
 * the editor it belongs to.
 */
interface CodeActionContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Gets the editor the contribution belongs to.
   */
  readonly _editor?: MonacoApi.editor.ICodeEditor;

  /**
   * Asks for code actions at the caret: the end of Monaco's code-action commands.
   */
  manualTriggerAtCurrentPosition?: (
    notAvailableMessage: string,
    triggerAction: unknown,
    filter?: { readonly include?: unknown },
    autoApply?: string,
  ) => void;

  /**
   * Opens Monaco's widget with a set of actions — what the "Quick Fix…" link in a problem's hover
   * runs.
   */
  showCodeActions?: (trigger: unknown, actions: MonacoCodeActionSet, at: unknown) => unknown;

  /**
   * Opens Monaco's widget from its lightbulb.
   */
  showCodeActionsFromLightbulb?: (actions: MonacoCodeActionSet, at: unknown) => Promise<void>;

  /**
   * Opens Monaco's widget: where every other route to it ends.
   */
  showCodeActionList?: (actions: MonacoCodeActionSet, at: unknown, options: unknown) => unknown;
}

/**
 * The part of Monaco's set of code actions the takeover reads: where the problem they fix is, and how
 * to release them.
 */
interface MonacoCodeActionSet {
  /**
   * Gets the actions that can run, each with the problems it fixes.
   */
  readonly validActions?: readonly {
    readonly action?: { readonly diagnostics?: readonly MonacoApi.IRange[] };
  }[];

  /**
   * Releases the set.
   */
  dispose?(): void;
}

/**
 * Removes the chords of Monaco's code-action commands from a Monaco instance and binds Studio's Quick
 * Fix to ⌘. (Ctrl+.) in their place (#1016), turns Monaco's lightbulb off in every editor the instance
 * creates, and makes sure Monaco's code-action widget can never open: each of the code-action
 * contribution's ways into it — once for the instance, on its class — opens Studio's menu instead.
 * Each instance (the main window's, and each child window's) has its own keybinding service and its
 * own classes, so each is prepared once, as it loads.
 *
 * A request for one kind of action to apply straight away — Code Cleanup organising imports — still
 * goes through Monaco's command: it applies without a widget, and if it would show one, Studio's menu
 * opens instead.
 *
 * A markdown code fence sets the find passthrough context key, and ⌘. passes through it as the find,
 * go-to and navigation chords do: a fence is a few lines inside a document, with nothing to fix.
 * @param monaco The Monaco instance.
 * @param onQuickFix Receives the editor when ⌘. or any route to Monaco's code-action widget runs.
 */
export function installQuickFixCommands(
  monaco: typeof MonacoApi,
  onQuickFix: (editor: MonacoApi.editor.ICodeEditor) => void,
): void {
  monaco.editor.registerCommand(STUDIO_QUICK_FIX_COMMAND, (): void => {
    const focused: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
    if (focused !== undefined) {
      onQuickFix(focused);
    }
  });
  monaco.editor.addKeybindingRules([
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    ...MONACO_CODE_ACTION_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
    {
      // ⌘ on macOS and Ctrl elsewhere: Monaco reads CtrlCmd per platform.
      keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
      command: STUDIO_QUICK_FIX_COMMAND,
      when: `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`,
    },
  ]);
  let replaced: boolean = false;
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    editor.updateOptions(QUICK_FIX_EDITOR_OPTIONS);
    if (!replaced) {
      replaced = takeOverCodeActions(editor, onQuickFix);
    }
  });
}

/**
 * Replaces each way Monaco's code-action contribution opens its widget with Studio's Quick Fix, on its
 * class, so every editor of the instance — those made before and after — sends its code actions to
 * Studio. Done through the prototype once, rather than per editor, as Rename Symbol's takeover is.
 * @param editor An editor of the instance, whose contribution reaches the class.
 * @param onQuickFix Receives the editor the widget would have opened in.
 * @returns Returns true when the class was reached and its ways into the widget replaced.
 */
export function takeOverCodeActions(
  editor: MonacoApi.editor.ICodeEditor,
  onQuickFix: (editor: MonacoApi.editor.ICodeEditor) => void,
): boolean {
  const contribution: CodeActionContribution | null =
    editor.getContribution<CodeActionContribution>(CODE_ACTION_CONTRIBUTION);
  const prototype: CodeActionContribution | null =
    contribution === null ? null : (Object.getPrototypeOf(contribution) as CodeActionContribution);
  if (
    prototype === null ||
    typeof prototype.showCodeActionList !== 'function' ||
    typeof prototype.manualTriggerAtCurrentPosition !== 'function'
  ) {
    return false;
  }
  const trigger: NonNullable<CodeActionContribution['manualTriggerAtCurrentPosition']> =
    prototype.manualTriggerAtCurrentPosition;
  prototype.manualTriggerAtCurrentPosition = function (
    this: CodeActionContribution,
    notAvailableMessage: string,
    triggerAction: unknown,
    filter?: { readonly include?: unknown },
    autoApply?: string,
  ): void {
    // One kind to apply straight away (organise imports) is Monaco's to run: no widget opens.
    if (filter?.include !== undefined || autoApply !== undefined) {
      trigger.call(this, notAvailableMessage, triggerAction, filter, autoApply);
      return;
    }
    onQuickFix(this._editor ?? editor);
  };
  prototype.showCodeActionList = function (this: CodeActionContribution): Promise<void> {
    onQuickFix(this._editor ?? editor);
    return Promise.resolve();
  };
  prototype.showCodeActions = function (
    this: CodeActionContribution,
    _trigger: unknown,
    actions: MonacoCodeActionSet,
  ): Promise<void> {
    // The hover's link is over a problem the caret may not be on: Studio's menu opens at the caret,
    // so the caret goes to the problem first.
    const target: MonacoApi.editor.ICodeEditor = this._editor ?? editor;
    const problem: MonacoApi.IRange | undefined = actions.validActions?.find(
      (entry: NonNullable<MonacoCodeActionSet['validActions']>[number]): boolean =>
        (entry.action?.diagnostics?.length ?? 0) > 0,
    )?.action?.diagnostics?.[0];
    if (problem !== undefined) {
      target.setPosition({ lineNumber: problem.startLineNumber, column: problem.startColumn });
    }
    actions.dispose?.();
    onQuickFix(target);
    return Promise.resolve();
  };
  prototype.showCodeActionsFromLightbulb = function (
    this: CodeActionContribution,
    actions: MonacoCodeActionSet,
  ): Promise<void> {
    actions.dispose?.();
    onQuickFix(this._editor ?? editor);
    return Promise.resolve();
  };
  return true;
}
