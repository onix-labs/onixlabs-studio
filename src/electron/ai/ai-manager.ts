import { ipcMain } from 'electron';
import type { AiVerifyResult } from '../../shared/ai-types';
import { IpcChannel } from '../../shared/ipc-channels';
import { AiAuthManager } from './ai-auth-manager';
import { ClaudeAgentProvider } from './claude-agent-provider';

/**
 * Coordinates the agent subsystem in the main process. This first slice owns authentication
 * (delegated to {@link AiAuthManager}) and an end-to-end verification turn (through the
 * {@link ClaudeAgentProvider}); the streaming run/abort/event surface arrives with the agent runtime
 * (#107).
 */
export class AiManager {
  /**
   * Holds the agent credential manager.
   */
  private readonly auth: AiAuthManager = new AiAuthManager();

  /**
   * Holds the Claude provider used to verify authentication.
   */
  private readonly provider: ClaudeAgentProvider = new ClaudeAgentProvider();

  /**
   * Registers the agent IPC handlers (authentication status/key management and verification).
   */
  public register(): void {
    this.auth.register();
    ipcMain.handle(
      IpcChannel.AiVerify,
      (): Promise<AiVerifyResult> => this.provider.verify(this.auth.resolveCredential()),
    );
  }
}
