import { Service } from '@angular/core';
import { ToolViewAgentPanelState } from '@shared/angular/components/panels/tool-view-agent-panel/tool-view-agent-panel-state';

/**
 * Whether the AI Manager's docked agent is showing (#967), shared by the view and its ribbon.
 */
@Service()
export class AiManagerAgentPanelState extends ToolViewAgentPanelState {}
