import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  Type,
} from '@angular/core';
import { FeatureRegistry } from '@shared/angular/services/feature-registry';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockState } from '../../../services/dock/dock-state';
import { findStackOfPanel } from '../../../services/dock/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';

/**
 * Feature type used for markdown documents in the well.
 */
const MARKDOWN_TYPE: string = 'markdown';

/**
 * Feature type used for every other (code) document in the well.
 */
const CODE_TYPE: string = 'code';

/**
 * Hosts an open file inside a workspace's document well. The dock panel id is the document id; this
 * resolves the right editor surface for it by the document's feature type. Each feature contributes a
 * lean document panel through the {@link FeatureRegistry}, which is mounted here; a type with no
 * registered document panel renders nothing. The dock keeps every well panel mounted, so this passes
 * the well's active state through to drive the editor's relayout and focus.
 */
@Component({
  selector: 'app-document-panel',
  imports: [NgComponentOutlet],
  templateUrl: './document-panel.html',
  styleUrl: './document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPanel {
  /**
   * Gets the dock panel descriptor; its id is the document id this panel hosts.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the registry of features, consulted first so a migrated feature's document panel is mounted
   * from its own descriptor.
   */
  protected readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the document model backing the hosted editor.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the dock layout used to derive whether this document is the active one in its well.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Gets the hosted document's id.
   */
  public readonly documentId: Signal<string> = computed((): string => this.panel().id);

  /**
   * Gets whether the hosted file is markdown (and so uses the Milkdown editor).
   */
  public readonly isMarkdown: Signal<boolean> = computed(
    (): boolean => this.documents.get(this.panel().id)?.language() === MARKDOWN_TYPE,
  );

  /**
   * Gets the feature type of the hosted document, used to resolve its document panel from the
   * registry.
   */
  protected readonly documentType: Signal<string> = computed((): string =>
    this.isMarkdown() ? MARKDOWN_TYPE : CODE_TYPE,
  );

  /**
   * Gets the registered document-panel component for the hosted document's type, or undefined when
   * its feature has not contributed one (rendering nothing).
   */
  protected readonly documentPanel: Signal<Type<unknown> | undefined> = computed(
    (): Type<unknown> | undefined => this.registry.documentPanelFor(this.documentType()),
  );

  /**
   * Gets whether this document is the active one in its well, so the editor relayouts and focuses.
   */
  public readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });
}
