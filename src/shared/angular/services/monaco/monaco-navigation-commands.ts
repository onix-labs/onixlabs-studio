import type * as MonacoApi from 'monaco-editor';
import { FIND_PASSTHROUGH_CONTEXT_KEY, focusedEditor } from './monaco-find-commands';

/**
 * Names where Studio's navigation takes an editor: to the definition of the symbol at the caret, or to
 * the list of every reference to it (#1014).
 */
export type NavigationMode = 'definition' | 'references' | 'implementation' | 'typeDefinition';

/**
 * Lists every Monaco command that goes to a symbol's definition, declaration, type definition,
 * implementation or references (#1014) — each through its own navigation, which opens Monaco's peek
 * widget for several answers and can only open files Monaco holds a model for. Each has all of its
 * default chords removed, on every platform: F12, ⌘F12 / Ctrl+F12, ⌥F12, ⌘K F12, ⇧F12 and the rest.
 * Studio's Go to Definition and Find All References take F12 and ⇧F12 instead.
 */
export const MONACO_NAVIGATION_COMMANDS: readonly string[] = [
  'editor.action.revealDefinition',
  'editor.action.revealDefinitionAside',
  'editor.action.peekDefinition',
  'editor.action.revealDeclaration',
  'editor.action.peekDeclaration',
  'editor.action.goToTypeDefinition',
  'editor.action.peekTypeDefinition',
  'editor.action.goToImplementation',
  'editor.action.peekImplementation',
  'editor.action.goToReferences',
  'editor.action.referenceSearch.trigger',
];

/**
 * Names Studio's Go to Definition command, bound to F12 in every editor.
 */
export const STUDIO_GO_TO_DEFINITION_COMMAND: string = 'studio.goToDefinition';

/**
 * Names Studio's Find All References command, bound to ⇧F12 (Shift+F12) in every editor.
 */
export const STUDIO_FIND_REFERENCES_COMMAND: string = 'studio.findReferences';

/**
 * Names Studio's Go to Implementation (#1142), bound to ⌘F12 (Ctrl+F12) as in Visual Studio and VS
 * Code, in place of Monaco's own, which opened its peek.
 */
export const STUDIO_GO_TO_IMPLEMENTATION_COMMAND: string = 'studio.goToImplementation';

/**
 * Names Studio's Go to Type Definition (#1142). No chord: neither Visual Studio nor VS Code gives it
 * one, so it is reached from the editor's right-click menu.
 */
export const STUDIO_GO_TO_TYPE_DEFINITION_COMMAND: string = 'studio.goToTypeDefinition';

/**
 * Names the editor contribution behind Monaco's ⌘-click (Ctrl-click) on a symbol: it underlines the
 * symbol under the pointer while the modifier is held, and on the click runs Monaco's own go to
 * definition.
 */
export const DEFINITION_LINK_CONTRIBUTION: string = 'editor.contrib.gotodefinitionatposition';

/**
 * Holds the editor options that keep every one of Monaco's go-to navigations off its peek widget: with
 * several answers each goes to the first rather than peeking, and a ⌘-click never opens in peek. Applied
 * to every editor as it is created; Studio's own commands never run these navigations at all, so this
 * is the guarantee for any route still left to them.
 */
export const NAVIGATION_EDITOR_OPTIONS: MonacoApi.editor.IEditorOptions = {
  gotoLocation: {
    multiple: 'goto',
    multipleDefinitions: 'goto',
    multipleTypeDefinitions: 'goto',
    multipleDeclarations: 'goto',
    multipleImplementations: 'goto',
    multipleReferences: 'goto',
  },
  definitionLinkOpensInPeek: false,
};

/**
 * Holds the Monaco mouse-target types a ⌘-click goes to a definition from — the text itself, numbered
 * as Monaco's `MouseTargetType.CONTENT_TEXT` is — as Monaco's own gesture does.
 */
const LINK_TARGETS: ReadonlySet<number> = new Set<number>([6]);

/**
 * The part of the definition-link contribution Studio replaces: the navigation its click runs.
 */
interface DefinitionLinkContribution extends MonacoApi.editor.IEditorContribution {
  /**
   * Runs Monaco's go to definition from a position — the click's.
   */
  gotoDefinition?: (position: MonacoApi.IPosition, openToSide: boolean) => Promise<void>;
}

/**
 * Removes Monaco's definition and references chords from a Monaco instance and binds Studio's Go to
 * Definition (F12) and Find All References (⇧F12) in their place, then takes over ⌘-click (Ctrl-click)
 * in every editor the instance creates. Each instance (the main window's, and each child window's) has
 * its own keybinding service, so each is prepared once, as it loads.
 *
 * A ⌘-click on a symbol runs Studio's Go to Definition. Monaco's underline under the pointer while the
 * modifier is held stays — it is a hint, and opens nothing — but the navigation its click would run is
 * replaced with nothing; where that cannot be done, the contribution is disposed, underline and all.
 *
 * A markdown code fence sets the find passthrough context key, and the chords pass through it as the
 * find and go-to chords do: a fence is a few lines inside a document, with nowhere of its own to go.
 * @param monaco The Monaco instance.
 * @param isMac Whether the host is macOS, which decides the ⌘-click modifier (⌘ there, Ctrl elsewhere).
 * @param onNavigate Receives the editor and the mode when F12, ⇧F12 or a ⌘-click runs.
 */
export function installNavigationCommands(
  monaco: typeof MonacoApi,
  isMac: boolean,
  onNavigate: (editor: MonacoApi.editor.ICodeEditor, mode: NavigationMode) => void,
): void {
  const run: (mode: NavigationMode) => () => void =
    (mode: NavigationMode): (() => void) =>
    (): void => {
      const focused: MonacoApi.editor.ICodeEditor | undefined = focusedEditor(monaco);
      if (focused !== undefined) {
        onNavigate(focused, mode);
      }
    };
  monaco.editor.registerCommand(STUDIO_GO_TO_DEFINITION_COMMAND, run('definition'));
  monaco.editor.registerCommand(STUDIO_FIND_REFERENCES_COMMAND, run('references'));
  monaco.editor.registerCommand(STUDIO_GO_TO_IMPLEMENTATION_COMMAND, run('implementation'));
  monaco.editor.registerCommand(STUDIO_GO_TO_TYPE_DEFINITION_COMMAND, run('typeDefinition'));
  const when: string = `editorFocus && !${FIND_PASSTHROUGH_CONTEXT_KEY}`;
  monaco.editor.addKeybindingRules([
    // A removal with no chord drops every chord the command has, whichever platform Monaco runs on.
    ...MONACO_NAVIGATION_COMMANDS.map((command: string): MonacoApi.editor.IKeybindingRule => ({
      keybinding: 0,
      command: `-${command}`,
    })),
    { keybinding: monaco.KeyCode.F12, command: STUDIO_GO_TO_DEFINITION_COMMAND, when },
    {
      keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F12,
      command: STUDIO_FIND_REFERENCES_COMMAND,
      when,
    },
    {
      keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12,
      command: STUDIO_GO_TO_IMPLEMENTATION_COMMAND,
      when,
    },
  ]);
  monaco.editor.onDidCreateEditor((editor: MonacoApi.editor.ICodeEditor): void => {
    editor.updateOptions(NAVIGATION_EDITOR_OPTIONS);
    takeOverDefinitionClicks(editor, isMac, onNavigate);
  });
}

/**
 * Takes over ⌘-click (Ctrl-click) on a symbol in one editor: Monaco's own navigation from the click is
 * replaced with nothing, and a click with the modifier that lands on the text, not dragged, runs
 * Studio's Go to Definition from where it landed.
 * @param editor The editor, just created.
 * @param isMac Whether the host is macOS, which decides the modifier.
 * @param onNavigate Receives the editor and the mode.
 */
export function takeOverDefinitionClicks(
  editor: MonacoApi.editor.ICodeEditor,
  isMac: boolean,
  onNavigate: (editor: MonacoApi.editor.ICodeEditor, mode: NavigationMode) => void,
): void {
  const contribution: DefinitionLinkContribution | null =
    editor.getContribution<DefinitionLinkContribution>(DEFINITION_LINK_CONTRIBUTION);
  if (contribution !== null) {
    if (typeof contribution.gotoDefinition === 'function') {
      contribution.gotoDefinition = (): Promise<void> => Promise.resolve();
    } else {
      contribution.dispose();
    }
  }
  let pressed: MonacoApi.IPosition | null = null;
  const isLink: (event: MonacoApi.editor.IEditorMouseEvent) => boolean = (
    event: MonacoApi.editor.IEditorMouseEvent,
  ): boolean =>
    event.event.leftButton &&
    !event.event.altKey &&
    (isMac ? event.event.metaKey : event.event.ctrlKey) &&
    LINK_TARGETS.has(event.target.type) &&
    event.target.position !== null;
  editor.onMouseDown((event: MonacoApi.editor.IEditorMouseEvent): void => {
    pressed = isLink(event) ? event.target.position : null;
  });
  editor.onMouseUp((event: MonacoApi.editor.IEditorMouseEvent): void => {
    const start: MonacoApi.IPosition | null = pressed;
    pressed = null;
    const position: MonacoApi.IPosition | null = event.target.position;
    // Only a click: a press dragged elsewhere is a selection, not a request to go anywhere.
    if (
      start === null ||
      position === null ||
      !isLink(event) ||
      start.lineNumber !== position.lineNumber ||
      start.column !== position.column
    ) {
      return;
    }
    editor.setPosition(position);
    onNavigate(editor, 'definition');
  });
}
