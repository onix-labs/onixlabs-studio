import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { Icon } from '../../icons/icon';

/**
 * Defines a single segment of contextual information shown in the status strip.
 */
export interface StatusSegment {
  /**
   * Gets the unique identifier of the segment.
   */
  readonly id: string;

  /**
   * Gets the text of the segment.
   */
  readonly text: string;

  /**
   * Gets the optional icon of the segment.
   */
  readonly icon?: Icon;
}

/**
 * Represents the contextual status bar content, organised into leading and trailing segments that
 * the active view can publish.
 */
@Service()
export class StatusBar {
  /**
   * Holds the leading (start-aligned) status segments.
   */
  private readonly leadingSegments: WritableSignal<readonly StatusSegment[]> = signal<
    readonly StatusSegment[]
  >([]);

  /**
   * Holds the trailing (end-aligned) status segments.
   */
  private readonly trailingSegments: WritableSignal<readonly StatusSegment[]> = signal<
    readonly StatusSegment[]
  >([]);

  /**
   * Gets the leading (start-aligned) status segments.
   */
  public readonly leading: Signal<readonly StatusSegment[]> = this.leadingSegments.asReadonly();

  /**
   * Gets the trailing (end-aligned) status segments.
   */
  public readonly trailing: Signal<readonly StatusSegment[]> = this.trailingSegments.asReadonly();

  /**
   * Sets the leading status segments.
   * @param segments The segments to display at the start of the status strip.
   */
  public setLeading(segments: readonly StatusSegment[]): void {
    this.leadingSegments.set(segments);
  }

  /**
   * Sets the trailing status segments.
   * @param segments The segments to display at the end of the status strip.
   */
  public setTrailing(segments: readonly StatusSegment[]): void {
    this.trailingSegments.set(segments);
  }

  /**
   * Clears all status segments.
   */
  public clear(): void {
    this.leadingSegments.set([]);
    this.trailingSegments.set([]);
  }
}
