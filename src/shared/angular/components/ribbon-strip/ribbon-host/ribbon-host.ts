import { Directive } from '@angular/core';

/**
 * Represents the shared host layout applied to every per-tab-type ribbon. It fills the ribbon strip
 * width and stretches its overflow wrapper, which lays the groups out in a row and moves any that do
 * not fit into a dropdown.
 *
 * Applied through `hostDirectives: [RibbonHost]` rather than a stylesheet: a relocated component's
 * `styleUrl` cannot resolve a path alias (see docs/agents.md §8), which is why this identical block
 * was previously copied into each feature ribbon's own `.scss`. Setting the layout via host style
 * bindings keeps it in one shared place with no `styleUrl` to resolve.
 */
@Directive({
  selector: '[appRibbonHost]',
  host: {
    '[style.display]': "'flex'",
    '[style.flex]': "'1'",
    '[style.alignItems]': "'stretch'",
    '[style.minInlineSize]': "'0'",
  },
})
export class RibbonHost {}
