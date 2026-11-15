import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  linkedSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { BinaryEditor, BinaryRange } from '@shared/angular/components/binary-editor/binary-editor';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { DissectedPacket, PacketField, PacketLayer } from '@shared/api/packets/packet-model';

/**
 * One node of the dissection tree: a layer, or one of its fields.
 */
type PacketNode = PacketLayerNode | PacketFieldNode;

/**
 * A layer's row in the dissection tree.
 */
interface PacketLayerNode {
  /**
   * Gets the node's kind.
   */
  readonly kind: 'layer';

  /**
   * Gets the layer.
   */
  readonly layer: PacketLayer;

  /**
   * Gets the bytes the layer was read from.
   */
  readonly range: BinaryRange;
}

/**
 * A field's row in the dissection tree.
 */
interface PacketFieldNode {
  /**
   * Gets the node's kind.
   */
  readonly kind: 'field';

  /**
   * Gets the field.
   */
  readonly field: PacketField;

  /**
   * Gets the tree id of the layer the field belongs to.
   */
  readonly layerId: string;

  /**
   * Gets the bytes the field was read from; at least one, for a field that is a fraction of a byte.
   */
  readonly range: BinaryRange;
}

/**
 * One packet taken apart: each layer, collapsible, with its fields, on the shared tree, beside the
 * packet's bytes on the shared binary editor, read-only. Choosing a layer or a field selects the bytes
 * it was read from, and selecting bytes chooses the narrowest field they lie in, the way Wireshark's
 * panes follow each other.
 */
@Component({
  selector: 'app-packet-details',
  imports: [TreeView, BinaryEditor],
  templateUrl: './packet-details.html',
  styleUrl: './packet-details.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PacketDetails {
  /**
   * Gets the dissected packet, or undefined when none is chosen.
   */
  public readonly packet: InputSignal<DissectedPacket | undefined> = input<
    DissectedPacket | undefined
  >(undefined);

  /**
   * Gets the packet's bytes.
   */
  public readonly data: InputSignal<Uint8Array | undefined> = input<Uint8Array | undefined>(
    undefined,
  );

  /**
   * Holds the layers that are collapsed, by tree id; every layer starts open.
   */
  protected readonly collapsed: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets every node of the dissection, by tree id, in the order the tree shows them.
   */
  protected readonly nodes: Signal<ReadonlyMap<string, PacketNode>> = computed(
    (): ReadonlyMap<string, PacketNode> => {
      const nodes: Map<string, PacketNode> = new Map<string, PacketNode>();
      this.packet()?.layers.forEach((layer: PacketLayer, layerIndex: number): void => {
        const layerId: string = `layer:${layerIndex}`;
        nodes.set(layerId, {
          kind: 'layer',
          layer,
          range: { start: layer.offset, end: layer.offset + layer.length },
        });
        layer.fields.forEach((field: PacketField, fieldIndex: number): void => {
          nodes.set(`${layerId}/field:${fieldIndex}`, {
            kind: 'field',
            field,
            layerId,
            range: { start: field.offset, end: field.offset + Math.max(1, field.length) },
          });
        });
      });
      return nodes;
    },
  );

  /**
   * Gets the tree's visible rows: each layer, and the fields of those that are open.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const collapsed: ReadonlySet<string> = this.collapsed();
    const rows: TreeRow[] = [];
    this.nodes().forEach((node: PacketNode, id: string): void => {
      if (node.kind === 'layer') {
        rows.push({
          id,
          depth: 0,
          expandable: node.layer.fields.length > 0,
          expanded: !collapsed.has(id),
          data: node,
        });
      } else if (!collapsed.has(node.layerId)) {
        rows.push({ id, depth: 1, expandable: false, expanded: false, data: node });
      }
    });
    return rows;
  });

  /**
   * Holds the tree row chosen, cleared when another packet is chosen.
   */
  protected readonly chosenId: WritableSignal<string | null> = linkedSignal<
    Uint8Array | undefined,
    string | null
  >({
    source: this.data,
    computation: (): string | null => null,
  });

  /**
   * Holds the bytes selected, cleared when another packet is chosen.
   */
  protected readonly selection: WritableSignal<BinaryRange | null> = linkedSignal<
    Uint8Array | undefined,
    BinaryRange | null
  >({
    source: this.data,
    computation: (): BinaryRange | null => null,
  });

  /**
   * Holds the byte the bytes view is asked to scroll to, when a choice in the tree selects bytes.
   */
  protected readonly revealOffset: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the count of reveals asked for, so choosing the same bytes again still scrolls to them.
   */
  protected readonly revealVersion: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the reader the bytes view takes the packet's bytes through, replaced with each packet.
   */
  protected readonly byteAt: Signal<(offset: number) => number | null> = computed(
    (): ((offset: number) => number | null) => {
      const data: Uint8Array = this.data() ?? new Uint8Array(0);
      return (offset: number): number | null => data[offset] ?? null;
    },
  );

  /**
   * Gets the layer a tree row stands for.
   * @param row The row.
   * @returns Returns the layer, or undefined for a field's row.
   */
  protected layerOf(row: TreeRow): PacketLayer | undefined {
    const node: PacketNode | undefined = this.nodes().get(row.id);
    return node?.kind === 'layer' ? node.layer : undefined;
  }

  /**
   * Gets the field a tree row stands for.
   * @param row The row.
   * @returns Returns the field, or undefined for a layer's row.
   */
  protected fieldOf(row: TreeRow): PacketField | undefined {
    const node: PacketNode | undefined = this.nodes().get(row.id);
    return node?.kind === 'field' ? node.field : undefined;
  }

  /**
   * Chooses a row: opens or closes a layer, and selects the bytes the row was read from.
   * @param row The row.
   */
  protected choose(row: TreeRow): void {
    const node: PacketNode | undefined = this.nodes().get(row.id);
    if (node === undefined) {
      return;
    }
    if (node.kind === 'layer' && row.expandable) {
      this.collapsed.update((collapsed: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(collapsed);
        if (!next.delete(row.id)) {
          next.add(row.id);
        }
        return next;
      });
    }
    this.chosenId.set(row.id);
    this.selection.set(node.range);
    this.revealOffset.set(node.range.start);
    this.revealVersion.update((version: number): number => version + 1);
  }

  /**
   * Follows a selection made in the bytes: chooses the narrowest field the bytes lie wholly in, or
   * the narrowest layer when they lie in no field shown.
   * @param range The bytes selected.
   */
  protected onBytesSelected(range: BinaryRange): void {
    this.selection.set(range);
    const collapsed: ReadonlySet<string> = this.collapsed();
    let chosen: string | null = null;
    let narrowest: number = Number.POSITIVE_INFINITY;
    for (const [id, node] of this.nodes()) {
      const visible: boolean = node.kind === 'layer' || !collapsed.has(node.layerId);
      const width: number = node.range.end - node.range.start;
      // Fields come after their layer, so a field as wide as its layer still wins the tie.
      if (
        visible &&
        node.range.start <= range.start &&
        node.range.end >= range.end &&
        width <= narrowest
      ) {
        chosen = id;
        narrowest = width;
      }
    }
    this.chosenId.set(chosen);
  }
}
