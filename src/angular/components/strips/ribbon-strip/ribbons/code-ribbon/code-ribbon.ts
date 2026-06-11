import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonCheck } from '../../controls/ribbon-check/ribbon-check';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';

/**
 * Represents the placeholder contextual ribbon shown when a code tab is active. The groups and
 * controls are static scaffolding; the final set and their wiring are not yet decided.
 */
@Component({
  selector: 'app-code-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonCheck],
  templateUrl: './code-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeRibbon {}
