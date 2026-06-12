import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { StatusBar, StatusSegment } from '../status-bar/status-bar';

/**
 * Holds the identifier of the cursor-position status segment.
 */
const CURSOR_SEGMENT_ID: string = 'code-cursor';

/**
 * Describes a one-based cursor position within the editor.
 */
export interface CursorPosition {
  /**
   * Gets the one-based line number.
   */
  readonly line: number;

  /**
   * Gets the one-based column number.
   */
  readonly column: number;
}

/**
 * Publishes the active code editor's cursor position to the status strip.
 *
 * The active editor pushes its cursor position here; an effect projects it as a leading status
 * segment, clearing it when no code editor is active (the position is null). The leading slot is used
 * so the cursor position never collides with the terminal's trailing working-directory segment.
 */
@Service()
export class CodeStatus {
  /**
   * Holds the status bar the cursor position is published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active editor's cursor position, or null when no code editor is active.
   */
  private readonly positionSignal: WritableSignal<CursorPosition | null> =
    signal<CursorPosition | null>(null);

  /**
   * Initializes the service, projecting the cursor position as a leading status segment.
   */
  public constructor() {
    effect((): void => {
      const position: CursorPosition | null = this.positionSignal();
      const segments: readonly StatusSegment[] =
        position === null
          ? []
          : [{ id: CURSOR_SEGMENT_ID, text: `Ln ${position.line}, Col ${position.column}` }];
      this.statusBar.setLeading(segments);
    });
  }

  /**
   * Sets the active editor's cursor position.
   * @param position The cursor position, or null to clear it.
   */
  public setPosition(position: CursorPosition | null): void {
    this.positionSignal.set(position);
  }
}
