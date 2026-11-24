import {
  computed,
  effect,
  inject,
  linkedSignal,
  Service,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';
import { EditorSearch } from '@shared/angular/components/search-view/editor-search';
import { DockFloating, FloatWindow } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockNode, isStackNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import {
  collectPanelIds,
  findNode,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { FindHost } from '@shared/angular/services/find-router/find-host';
import { Log } from '@shared/angular/services/log/log';
import { ApiRequest } from '@shared/api/api-client-types';
import { ApiWorkspace } from '../api-workspace/api-workspace';

/**
 * Identifies the explorer's Find panel in its dock.
 */
export const API_FIND_PANEL_ID: string = 'find';

/**
 * A body's editor, and the request it belongs to.
 */
interface BodyEditor {
  /**
   * Gets the request's id.
   */
  readonly requestId: string;

  /**
   * Gets the editor.
   */
  readonly editor: MonacoApi.editor.ICodeEditor;
}

/**
 * The API Explorer's Find & Replace (#1564): one for the whole explorer, shown by a panel of its dock as
 * the workspace's is, over the body of the request in front.
 *
 * ⌘F in a body reveals the panel over that body. From then on it follows the request in front: to the
 * body last searched in it, or else the one the user can edit, or else its response.
 *
 * Provided per view, so what it holds outlives the panel, which the dock creates afresh whenever it
 * moves, floats or comes back from behind another tab.
 */
@Service()
export class ApiFind implements FindHost {
  /**
   * Holds the API workspace, which names the requests.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the dock's layout.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds which of the dock's groups has focus.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock's floating panels.
   */
  private readonly dockFloating: DockFloating = inject(DockFloating);

  /**
   * Holds the panels in windows of their own.
   */
  private readonly popoutPanels: PopoutPanels = inject(PopoutPanels);

  /**
   * Holds the reveal that brings the panel forward wherever it lives.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the bodies' editors that are open, in the order they were created.
   */
  private readonly bodies: WritableSignal<readonly BodyEditor[]> = signal<readonly BodyEditor[]>(
    [],
  );

  /**
   * Holds the editor last searched in each request.
   */
  private readonly lastSearched: WritableSignal<ReadonlyMap<string, MonacoApi.editor.ICodeEditor>> =
    signal<ReadonlyMap<string, MonacoApi.editor.ICodeEditor>>(
      new Map<string, MonacoApi.editor.ICodeEditor>(),
    );

  /**
   * Gets the request in front: the focused document group's, or else the first group's.
   */
  private readonly frontRequest: Signal<string | null> = computed((): string | null => {
    const layout: DockNode = this.dockState.layout();
    const focusedId: string | null = this.dockFocus.focusedStackId();
    const focused: DockNode | null = focusedId === null ? null : findNode(layout, focusedId);
    const well: StackNode | null =
      focused !== null && isStackNode(focused) && focused.role === 'document'
        ? focused
        : firstStackOfRole(layout, 'document');
    return well?.active ?? null;
  });

  /**
   * Holds the request searched: the one in front, or the one ⌘F was last pressed in, which may be in
   * another group or window, until another comes to the front.
   */
  private readonly searchedRequest: WritableSignal<string | null> = linkedSignal<string | null>(
    (): string | null => this.frontRequest(),
  );

  /**
   * Gets the editor searched, or null when the request has no body open.
   */
  private readonly target: Signal<MonacoApi.editor.ICodeEditor | null> = computed(
    (): MonacoApi.editor.ICodeEditor | null => {
      const requestId: string | null = this.searchedRequest();
      if (requestId === null) {
        return null;
      }
      const editors: readonly MonacoApi.editor.ICodeEditor[] = this.bodies()
        .filter((body: BodyEditor): boolean => body.requestId === requestId)
        .map((body: BodyEditor): MonacoApi.editor.ICodeEditor => body.editor);
      const last: MonacoApi.editor.ICodeEditor | undefined = this.lastSearched().get(requestId);
      return (
        editors.find((editor: MonacoApi.editor.ICodeEditor): boolean => editor === last) ??
        editors.find((editor: MonacoApi.editor.ICodeEditor): boolean => !isReadOnly(editor)) ??
        editors[0] ??
        null
      );
    },
  );

  /**
   * Gets the search the panel shows.
   */
  public readonly search: EditorSearch = new EditorSearch({
    mainEditor: (): MonacoApi.editor.ICodeEditor | null => untracked(this.target),
    labelOf: (editor: MonacoApi.editor.ICodeEditor): string => this.labelOf(editor),
  });

  /**
   * Gets whether there is a body to search.
   */
  public readonly hasTarget: Signal<boolean> = computed((): boolean => this.target() !== null);

  public constructor() {
    effect((): void => {
      const target: MonacoApi.editor.ICodeEditor | null = this.target();
      untracked((): void => this.search.retarget(target));
    });
  }

  /**
   * Adds a body's editor to those that can be searched, until it is disposed.
   * @param requestId The id of the request the body belongs to.
   * @param editor The editor.
   */
  public attach(requestId: string, editor: MonacoApi.editor.ICodeEditor): void {
    this.bodies.update((bodies: readonly BodyEditor[]): readonly BodyEditor[] => [
      ...bodies,
      { requestId, editor },
    ]);
    editor.onDidDispose((): void => this.detach(editor));
  }

  /**
   * Opens Find over a body, revealing the panel.
   * @param request The find to open.
   * @param editor The body's editor, or null when the request names none.
   */
  public openFind(request: FindRequest, editor: MonacoApi.editor.ICodeEditor | null): void {
    const body: BodyEditor | undefined = this.bodies().find(
      (candidate: BodyEditor): boolean => candidate.editor === editor,
    );
    this.log.debug('api-explorer.find', 'Open find', body?.requestId, request.mode);
    if (body !== undefined) {
      this.searchedRequest.set(body.requestId);
      this.lastSearched.update(
        (
          last: ReadonlyMap<string, MonacoApi.editor.ICodeEditor>,
        ): ReadonlyMap<string, MonacoApi.editor.ICodeEditor> =>
          new Map<string, MonacoApi.editor.ICodeEditor>(last).set(body.requestId, body.editor),
      );
    }
    this.search.open(request, body?.editor ?? null);
    this.reveal();
  }

  /**
   * Brings the panel forward wherever it lives, adding it beside the Agent the first time, as the
   * workspace adds its own: you search while looking at the request, not instead of it.
   */
  private reveal(): void {
    const layout: DockNode = this.dockState.layout();
    const shown: boolean =
      collectPanelIds(layout).includes(API_FIND_PANEL_ID) ||
      this.popoutPanels.isPopped(API_FIND_PANEL_ID) ||
      this.dockFloating
        .floats()
        .some((float: FloatWindow): boolean => float.panelId === API_FIND_PANEL_ID);
    if (!shown) {
      const beside: StackNode | null = findStackOfPanel(layout, 'agent');
      if (beside === null) {
        this.dockState.dockEdge(API_FIND_PANEL_ID, 'right');
      } else {
        this.dockState.tabInto(beside.id, API_FIND_PANEL_ID);
      }
    }
    this.dockReveal.reveal(API_FIND_PANEL_ID);
  }

  /**
   * Lets go of an editor that has been disposed.
   * @param editor The editor.
   */
  private detach(editor: MonacoApi.editor.ICodeEditor): void {
    this.bodies.update((bodies: readonly BodyEditor[]): readonly BodyEditor[] =>
      bodies.filter((body: BodyEditor): boolean => body.editor !== editor),
    );
    this.lastSearched.update(
      (
        last: ReadonlyMap<string, MonacoApi.editor.ICodeEditor>,
      ): ReadonlyMap<string, MonacoApi.editor.ICodeEditor> =>
        new Map<string, MonacoApi.editor.ICodeEditor>(
          [...last].filter(
            (entry: [string, MonacoApi.editor.ICodeEditor]): boolean => entry[1] !== editor,
          ),
        ),
    );
  }

  /**
   * Names a body in the results: which body it is, and of which request.
   * @param editor The body's editor.
   * @returns Returns the name.
   */
  private labelOf(editor: MonacoApi.editor.ICodeEditor): string {
    const body: string = isReadOnly(editor) ? 'Response Body' : 'Request Body';
    const requestId: string | undefined = untracked(this.bodies).find(
      (candidate: BodyEditor): boolean => candidate.editor === editor,
    )?.requestId;
    const request: ApiRequest | undefined = untracked(this.workspace.requests).find(
      (candidate: ApiRequest): boolean => candidate.id === requestId,
    );
    return request === undefined ? body : `${request.name} — ${body}`;
  }
}

/**
 * Determines whether an editor can only be read.
 * @param editor The editor.
 * @returns Returns true when it can only be read.
 */
function isReadOnly(editor: MonacoApi.editor.ICodeEditor): boolean {
  return editor.getRawOptions().readOnly === true;
}
