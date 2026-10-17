import { Service } from '@angular/core';
import { ToolViewAgentPanelState } from '@shared/angular/components/panels/tool-view-agent-panel/tool-view-agent-panel-state';

/**
 * Whether the Plugin Manager's docked agent is showing (#968), shared by the view and its ribbon.
 */
@Service()
export class PluginManagerAgentPanelState extends ToolViewAgentPanelState {}
