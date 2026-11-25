import { Settings } from '@shared/angular/services/settings/settings';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import {
  BinaryEditOp,
  BinaryEditor,
  BinaryRange,
  BinaryVisibleRange,
} from '@shared/angular/components/binary-editor/binary-editor';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DockTemplatePanel } from '@shared/angular/components/dock-layout/dock-template-panel/dock-template-panel';
import { dockProviders } from '@shared/angular/services/dock-layout/dock-providers';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import {
  createDockTabRegistrar,
  DockTabRegistrar,
} from '@shared/angular/services/dock-layout/dock-tab-registration';
import { linkDockPanel } from '@shared/angular/services/dock-layout/link-dock-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockSides } from '@shared/angular/services/dock-layout/dock-sides';
import type { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Log } from '@shared/angular/services/log/log';
import type * as MonacoApi from 'monaco-editor';
import { EditorSearch } from '@shared/angular/components/search-view/editor-search';
import { EditorSearchPanel } from '@shared/angular/components/search-view/editor-search-panel';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';
import { FIND_HOST, FindHost } from '@shared/angular/services/find-router/find-host';
import {
  BinaryDocumentEntry,
  BinaryDocuments,
  BinarySelection,
} from '../binary-document/binary-document';
import {
  BINARY_AGENT_PANEL_ID,
  BINARY_DISASSEMBLY_PANEL_ID,
  BINARY_DOCK_BLUEPRINT,
  BINARY_EDITOR_PANEL_ID,
  BINARY_FIND_PANEL_ID,
  BINARY_INSPECTOR_PANEL_ID,
} from '../binary-dock-blueprint';
import { describeFormat } from '../binary-format/binary-format';
import { BinaryDisasmPanel } from '../binary-disasm-panel/binary-disasm-panel';
import { BinaryInspector } from '../binary-inspector/binary-inspector';
import { BinaryStatus } from '../binary-status/binary-status';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';

/**
 * The number of bytes decoded before the focus offset in the disassembly window, giving the listing a
 * little context above the focused instruction.
 */
const DISASM_WINDOW_LEAD: number = 256;

/**
 * The length, in bytes, of the disassembly window decoded around the focus offset. Bounded so the
 * listing stays a screenful — a focus deep inside a multi-gigabyte file decodes only its neighbourhood
 * rather than everything from the file start.
 */
const DISASM_WINDOW_SPAN: number = 2048;

/**
 * A decoded byte window: its start offset and length.
 */
interface DisasmWindow {
  /**
   * Gets the window's start offset.
   */
  readonly offset: number;

  /**
   * Gets the window's length in bytes.
   */
  readonly length: number;
}

/**
 * Represents the binary editor's tab view: the shared {@link BinaryEditor} grid in the main group
 * of a dock, with Disassembly, Inspector, Agent and Find panels that dock around it. It owns the
 * binary-tab concerns the grid does not — resolving the backing document, loading the visible byte
 * window and its disassembly, and the status segment. Read-only for this phase.
 */
@Component({
  selector: 'app-binary-view',
  imports: [
    AgentConversationPanel,
    BinaryDisasmPanel,
    BinaryEditor,
    BinaryInspector,
    DockContainer,
    DockTemplatePanel,
    EditorSearchPanel,
  ],
  // The tab's agent and conversation live on the VIEW, not the docked agent panel: the dock draws the
  // panel only while it shows, and the conversation (and an in-flight run) must outlive it — and register
  // with Mission Control whether or not the panel was opened.
  providers: [
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'code' },
    ...dockProviders(BINARY_DOCK_BLUEPRINT),
    // One per binary tab: the status strip reads this view's own context through its injector.
    BinaryStatus,
    // The tab answers ⌘F in its disassembly with its own Find panel (#1007).
    { provide: FIND_HOST, useExisting: forwardRef((): unknown => BinaryView) },
  ],
  templateUrl: './binary-view.html',
  styleUrl: './binary-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BinaryView implements OnInit, OnDestroy, FindHost {
  /**
   * Holds the binary document registry the view resolves its document from.
   */
  private readonly binaryDocuments: BinaryDocuments = inject(BinaryDocuments);

  /**
   * Holds the status service the active view publishes its cursor/selection/size to.
   */
  private readonly binaryStatus: BinaryStatus = inject(BinaryStatus);

  /**
   * Holds what opens the dock's panels wherever they are.
   */
  protected readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Exposes the sides a panel may dock to to the template.
   */
  protected readonly DockSides: typeof DockSides = DockSides;

  /**
   * Gets the identifier of the bytes' panel.
   */
  protected readonly editorPanel: string = BINARY_EDITOR_PANEL_ID;

  /**
   * Gets the identifier of the disassembly panel.
   */
  protected readonly disassemblyPanel: string = BINARY_DISASSEMBLY_PANEL_ID;

  /**
   * Gets the identifier of the data inspector's panel.
   */
  protected readonly inspectorPanel: string = BINARY_INSPECTOR_PANEL_ID;

  /**
   * Gets the identifier of the agent panel.
   */
  protected readonly agentPanel: string = BINARY_AGENT_PANEL_ID;

  /**
   * Gets the identifier of the Find panel.
   */
  protected readonly findPanel: string = BINARY_FIND_PANEL_ID;

  /**
   * Holds the structured logger for the binary view.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the settings, which say what a double-click selects.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds whether the inspector decodes multi-byte values little-endian.
   */
  protected readonly littleEndian: WritableSignal<boolean> = signal<boolean>(
    this.settings.get('binaryEditor.inspectorEndian') === 'little',
  );

  /**
   * Holds whether the inspector's integer interpretations are signed.
   */
  protected readonly signed: WritableSignal<boolean> = signal<boolean>(
    this.settings.get('binaryEditor.inspectorSign') === 'signed',
  );

  /**
   * Holds this tab's Find, over the disassembly listing ⌘F was pressed in. The listing is read-only,
   * so it finds without replacing; it has no main editor of its own to search.
   */
  protected readonly editorSearch: EditorSearch = new EditorSearch({
    mainEditor: (): MonacoApi.editor.ICodeEditor | null => null,
    labelOf: (): string => 'Disassembly',
  });

  /**
   * Holds the byte window currently decoded into the disassembly listing, or null before the first
   * window is cut. The window follows the focus (cursor), not the hex viewport, and is re-cut only when
   * the focus leaves it — so the disassembly panel owns where it looks and does not churn as the cursor
   * moves within the shown code.
   */
  private disasmWindow: DisasmWindow | null = null;

  /**
   * Gets the identifier of the tab this view represents.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether this view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Publishes this view's injector so the shell's status strip can mount the binary status component
   * inside it. Finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers this tab's live agent with Mission Control and the requests inbox for the tab's whole
   * life, service-only — the docked agent panel mounts lazily on first show, so registration cannot
   * be left to its chat. Finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    context: (): ConversationContext | undefined => this.fileContext(),
    surface: 'binary',
  });

  /**
   * Registers this tab's dock, so the ribbon can open and close its panels. Finalised in
   * {@link ngOnInit} once the tab id is readable.
   */
  private readonly dockTab: DockTabRegistrar = createDockTabRegistrar();

  /**
   * Holds the resolved binary document, or undefined when the tab has none.
   */
  protected readonly document: Signal<BinaryDocumentEntry | undefined> = computed(
    (): BinaryDocumentEntry | undefined => this.binaryDocuments.get(this.tabId()),
  );

  /**
   * Gets the agent's conversation context: the binary file's path when known, else undefined so the
   * conversation falls back to its workspace or global context.
   */
  private readonly fileContext: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const path: string | undefined = this.document()?.path;
      return path === undefined ? undefined : { kind: 'file', key: path };
    },
  );

  /**
   * Gets the random-access byte accessor handed to the editor, reading the document's block cache.
   */
  protected readonly byteAt: (offset: number) => number | null = (offset: number): number | null =>
    this.document()?.byteAt(offset) ?? null;

  /**
   * Initializes the view: loads disassembly for the visible range and publishes status while active.
   */
  public constructor() {
    linkDockPanel(
      BINARY_FIND_PANEL_ID,
      (): boolean => this.editorSearch.visible(),
      (open: boolean): void => {
        if (!open) {
          this.editorSearch.close();
        }
      },
    );

    // Decode a bounded window of instructions around the focus — the cursor, which the entry-point jump
    // on open, the go-to-offset action, and clicking a byte or a disassembly line all set. The panel
    // owns where it looks rather than mirroring the hex viewport's scroll, so the entry jump reliably
    // decodes and centres the code. Re-runs when the format resolves and when freshly-loaded bytes
    // arrive (so a window awaiting its bytes decodes once they land); the window is re-cut only when the
    // focus leaves it, and loadDisassembly caches by range, so this settles to a cache hit.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        return;
      }
      document.format();
      document.loadedVersion();
      const focus: number = document.cursor() ?? 0;
      let active: DisasmWindow | null = this.disasmWindow;
      if (active === null || focus < active.offset || focus >= active.offset + active.length) {
        const offset: number = Math.max(0, focus - DISASM_WINDOW_LEAD);
        active = { offset, length: DISASM_WINDOW_SPAN };
        this.disasmWindow = active;
        document.ensureRange(offset, DISASM_WINDOW_SPAN);
      }
      document.loadDisassembly(active.offset, active.length);
    });

    // Keep this view's context current for its status strip. Activation is not consulted: the strip
    // mounts this view's status component only while the view is active, and destroys it on tab
    // switch, so an inactive view's context is never on screen to go stale.
    effect((): void => {
      const document: BinaryDocumentEntry | undefined = this.document();
      if (document === undefined) {
        this.binaryStatus.clear();
        return;
      }
      const selection: BinarySelection | null = document.selection();
      this.binaryStatus.publish({
        path: document.path,
        offset: document.cursor(),
        selectionLength: selection === null ? 0 : selection.end - selection.start,
        size: document.size(),
        format: describeFormat(document.format()),
        dirty: document.dirty(),
        insertMode: document.insertMode(),
      });
    });
  }

  /**
   * Finalises the agent-host registration once the required tab-id input is readable.
   */
  public ngOnInit(): void {
    this.log.info('binary.view', 'Binary view opened', this.tabId());
    this.dockTab.register(this.tabId());
    this.agentHost.register(this.tabId());
    this.statusHost.register(this.tabId());
  }

  /**
   * Releases the document when the tab closes. The view's status needs no clearing: the strip's status
   * component is scoped to this view and is destroyed with it.
   */
  public ngOnDestroy(): void {
    this.log.info('binary.view', 'Binary view closed', this.tabId());
    this.binaryDocuments.release(this.tabId());
  }

  /**
   * Opens this tab's Find panel as a request asks, over the disassembly it came from (#1007).
   * @param request The find to open.
   * @param editor The disassembly editor ⌘F was pressed in, or null when the request names none.
   */
  public openFind(request: FindRequest, editor: MonacoApi.editor.ICodeEditor | null): void {
    this.log.debug('binary.view', 'Open find panel', this.tabId(), request.mode);
    this.editorSearch.open(request, editor);
    // The listing is what is searched, so it stays in sight.
    this.dockReveal.openClearOf(BINARY_FIND_PANEL_ID, BINARY_DISASSEMBLY_PANEL_ID);
  }

  /**
   * Moves an open search to the disassembly's editor, which is a new one each time the dock draws the
   * panel.
   * @param editor The editor.
   */
  protected onDisassemblyEditor(editor: MonacoApi.editor.ICodeEditor): void {
    if (untracked(this.editorSearch.visible)) {
      this.editorSearch.retarget(editor);
    }
  }

  /**
   * Ends the search when the Find panel asks to close.
   */
  protected onFindClosed(): void {
    this.editorSearch.close();
  }

  /**
   * Loads the byte window the editor reports visible, and remembers it so disassembly reloads when the
   * format resolves.
   * @param range The visible byte window.
   */
  protected onVisibleRange(range: BinaryVisibleRange): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    document.ensureRange(range.offset, range.length);
  }

  /**
   * Records the selection reported by the editor onto the document, so the disassembly and inspector
   * cross-highlight follows it.
   * @param range The new selection.
   */
  protected onSelectionChange(range: BinaryRange): void {
    this.document()?.selection.set({ start: range.start, end: range.end });
  }

  /**
   * Records the cursor reported by the editor onto the document.
   * @param offset The cursor's byte offset.
   */
  protected onCursorChange(offset: number): void {
    this.document()?.cursor.set(offset);
  }

  /**
   * Snaps the selection to the whole instruction containing a double-clicked byte, so a double-click
   * selects an instruction, or to the byte alone when Double-Click Selects says so. Falls back to the
   * single byte when no instruction covers the offset.
   * @param offset The double-clicked byte offset.
   */
  protected onUnitSelect(offset: number): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    const range: BinarySelection | null =
      this.settings.get('binaryEditor.doubleClickSelects') === 'instruction'
        ? document.instructionRangeAt(offset)
        : { start: offset, end: offset + 1 };
    if (range !== null) {
      document.selection.set(range);
      document.cursor.set(range.start);
    }
  }

  /**
   * Applies a typed edit — overwrite, insert, or delete — to the document.
   * @param op The edit reported by the editor.
   */
  protected onOp(op: BinaryEditOp): void {
    const document: BinaryDocumentEntry | undefined = this.document();
    if (document === undefined) {
      return;
    }
    switch (op.kind) {
      case 'overwrite':
        this.log.info('binary.view', `Overwrite byte at 0x${op.offset.toString(16)}`, this.tabId());
        document.overwrite(op.offset, op.value);
        break;
      case 'insert':
        this.log.info('binary.view', `Insert byte at 0x${op.offset.toString(16)}`, this.tabId());
        document.insertByte(op.offset, op.value);
        break;
      case 'delete':
        this.log.info(
          'binary.view',
          `Delete ${op.count} byte(s) at 0x${op.offset.toString(16)}`,
          this.tabId(),
        );
        document.deleteBytes(op.offset, op.count);
        break;
    }
  }
}
