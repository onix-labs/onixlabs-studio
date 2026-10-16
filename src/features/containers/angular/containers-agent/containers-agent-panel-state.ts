import { Service } from '@angular/core';
import { ToolViewAgentPanelState } from '@shared/angular/components/panels/tool-view-agent-panel/tool-view-agent-panel-state';

/**
 * Whether the Containers view's docked agent is showing (#969), shared by the view and its ribbon.
 */
@Service()
export class ContainersAgentPanelState extends ToolViewAgentPanelState {}
