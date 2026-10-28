import { Service } from '@angular/core';

/**
 * Attaches the debugger to a running process for a language server (#1150): Roslyn's Debug Test
 * starts the test host and waits in it for a debugger. The workspace in front registers how its
 * debug session attaches, while it is active, so the language-server client never reaches into the
 * workspace feature.
 */
@Service()
export class DebugAttachRouter {
  /**
   * Holds the active workspace's attach, or null when no workspace is in front.
   */
  private handler: ((processId: number, name: string) => Promise<boolean>) | null = null;

  /**
   * Registers the workspace in front.
   * @param handler Attaches its debugger to a process, resolving true once attached.
   */
  public register(handler: (processId: number, name: string) => Promise<boolean>): void {
    this.handler = handler;
  }

  /**
   * Unregisters a workspace, if it is the one registered.
   * @param handler The handler it registered.
   */
  public unregister(handler: (processId: number, name: string) => Promise<boolean>): void {
    if (this.handler === handler) {
      this.handler = null;
    }
  }

  /**
   * Attaches the debugger in the workspace in front to a process.
   * @param processId The process.
   * @param name What is being debugged, as the debug session names it.
   * @returns Returns a promise resolving true once attached, false when nothing could attach.
   */
  public attach(processId: number, name: string): Promise<boolean> {
    return this.handler?.(processId, name) ?? Promise.resolve(false);
  }
}
