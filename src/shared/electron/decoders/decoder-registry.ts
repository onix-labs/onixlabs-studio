import { resolveForFormat } from '@shared/api/format-slot';
import { logger } from '../logger';
import { DecoderDescriptor } from './decoder-descriptor';

/**
 * Holds the decoders registered for this session, and answers which one fills a format's slot.
 *
 * Studio ships no decoder of its own, so this is empty until plugins are installed — including for
 * native machine code. That is the point of the model rather than a gap in it: an empty registry is
 * how "nothing installed" is expressed, and the panel turns it into an offer to install rather than a
 * blank pane.
 *
 * Registration order is meaningful: it breaks ties between decoders of equal priority, so the default
 * for a format is deterministic.
 */
export class DecoderRegistry {
  /**
   * Holds the registered decoders in registration order.
   */
  private readonly descriptors: DecoderDescriptor[] = [];

  /**
   * Holds the user's chosen decoder per format, for formats they have expressed a preference for.
   */
  private selection: Readonly<Record<string, string>> = {};

  /**
   * Registers a decoder, replacing any earlier registration of the same identifier in place so a
   * re-registration cannot change the tie-breaking order.
   * @param descriptor The decoder to register.
   */
  public register(descriptor: DecoderDescriptor): void {
    const existing: number = this.descriptors.findIndex(
      (candidate: DecoderDescriptor): boolean => candidate.id === descriptor.id,
    );
    if (existing === -1) {
      this.descriptors.push(descriptor);
      logger.debug(
        'DecoderRegistry',
        `Registered decoder '${descriptor.id}' for ${descriptor.formats.join(', ')}`,
      );
      return;
    }
    this.descriptors[existing] = descriptor;
    logger.debug('DecoderRegistry', `Replaced decoder '${descriptor.id}'`);
  }

  /**
   * Removes a decoder, so uninstalling a plugin stops it being offered.
   * @param id The decoder identifier.
   */
  public unregister(id: string): void {
    const index: number = this.descriptors.findIndex(
      (candidate: DecoderDescriptor): boolean => candidate.id === id,
    );
    if (index !== -1) {
      this.descriptors.splice(index, 1);
      logger.debug('DecoderRegistry', `Unregistered decoder '${id}'`);
    }
  }

  /**
   * Replaces the user's per-format decoder choices.
   * @param selection The chosen decoder identifier per format key.
   */
  public setSelection(selection: Readonly<Record<string, string>>): void {
    this.selection = selection;
  }

  /**
   * Gets every registered decoder, in registration order.
   * @returns Returns the decoders.
   */
  public all(): readonly DecoderDescriptor[] {
    return [...this.descriptors];
  }

  /**
   * Gets the decoders able to decode a format, in registration order. More than one is a choice the
   * user makes; none means no decoder for that format is installed.
   * @param format The canonical format key.
   * @returns Returns the candidates.
   */
  public candidatesFor(format: string): readonly DecoderDescriptor[] {
    return this.descriptors.filter((descriptor: DecoderDescriptor): boolean =>
      descriptor.formats.includes(format),
    );
  }

  /**
   * Resolves which decoder fills a format's slot — the user's choice when they made one and it is
   * still registered, otherwise the highest-priority candidate with ties broken by registration order.
   * @param format The canonical format key.
   * @returns Returns the decoder, or null when nothing decodes the format.
   */
  public resolve(format: string): DecoderDescriptor | null {
    const id: string | null = resolveForFormat(format, this.descriptors, this.selection);
    if (id === null) {
      return null;
    }
    return (
      this.descriptors.find((descriptor: DecoderDescriptor): boolean => descriptor.id === id) ??
      null
    );
  }
}
