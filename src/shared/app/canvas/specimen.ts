import type { Type } from '@angular/core';

// The design canvas's vocabulary (#855). A page groups specimens; a specimen is one component shown
// in each of its states; a state is the inputs it is rendered with. Adding a component to the canvas
// is adding a page or a specimen here — the canvas itself never changes.

/**
 * Describes one state of a specimen: what it is called, and the inputs it is rendered with.
 */
export interface SpecimenState {
  /**
   * Gets the state's name, such as `Pending, long command`.
   */
  readonly name: string;

  /**
   * Gets the component's inputs in this state.
   */
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Describes one component shown in each of its states.
 */
export interface Specimen {
  /**
   * Gets the specimen's name.
   */
  readonly name: string;

  /**
   * Gets the component.
   */
  readonly component: Type<unknown>;

  /**
   * Gets the outputs the canvas listens to, so what a click would do is shown rather than lost.
   */
  readonly outputs: readonly string[];

  /**
   * Gets its states, in the order they are shown.
   */
  readonly states: readonly SpecimenState[];
}

/**
 * Describes a page of the canvas.
 */
export interface SpecimenPage {
  /**
   * Gets the page's title.
   */
  readonly title: string;

  /**
   * Gets how the page is laid out: each state at every canvas width (`grid`, the default), or each
   * specimen once at the pane's own width (`single`) — for something reviewed by resizing the window.
   */
  readonly layout?: 'grid' | 'single';

  /**
   * Gets its specimens.
   */
  readonly specimens: readonly Specimen[];
}
