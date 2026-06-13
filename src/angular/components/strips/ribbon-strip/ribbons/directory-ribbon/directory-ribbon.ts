import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';
import { RibbonSplitButton } from '../../controls/ribbon-split-button/ribbon-split-button';

/**
 * Represents the placeholder contextual ribbon shown when a directory tab is active. The groups and
 * controls are static scaffolding; the final set and their wiring are not yet decided.
 */
@Component({
  selector: 'app-directory-ribbon',
  imports: [
    RibbonGroup,
    RibbonColumn,
    RibbonButton,
    RibbonButtonSmall,
    RibbonField,
    RibbonSplitButton,
  ],
  templateUrl: './directory-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
