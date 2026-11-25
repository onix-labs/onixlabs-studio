import { effect, inject, untracked } from '@angular/core';
import { DockReveal } from './dock-reveal';

/**
 * Ties a panel of a view's dock to something else that says whether it is open: the panel opens and
 * closes as that changes, and that is told when the panel is opened or closed in the dock. Call in an
 * injection context of a component providing a dock.
 * @param panelId The identifier of the panel.
 * @param isOpen Reads whether it should be open. Reads signals, whose changes are followed.
 * @param setOpen Told when the dock opens or closes it.
 */
export function linkDockPanel(
  panelId: string,
  isOpen: () => boolean,
  setOpen: (open: boolean) => void,
): void {
  const reveal: DockReveal = inject(DockReveal);
  // What the two last agreed on, so each effect acts on its own side's change and not on the other's.
  let agreed: boolean = untracked((): boolean => reveal.isOpen(panelId));

  effect((): void => {
    const wanted: boolean = isOpen();
    untracked((): void => {
      if (wanted === agreed) {
        return;
      }
      agreed = wanted;
      if (wanted) {
        reveal.open(panelId);
      } else {
        reveal.close(panelId);
      }
    });
  });

  effect((): void => {
    const open: boolean = reveal.isOpen(panelId);
    untracked((): void => {
      if (open !== agreed) {
        agreed = open;
        setOpen(open);
      }
    });
  });
}
