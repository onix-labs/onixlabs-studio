import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonCheck } from '../../controls/ribbon-check/ribbon-check';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';

/**
 * Represents the placeholder contextual ribbon shown when a terminal tab is active. The groups and
 * controls are static scaffolding; the final set and their wiring are not yet decided.
 */
@Component({
  selector: 'app-terminal-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonCheck, RibbonField],
  templateUrl: './terminal-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalRibbon {}
