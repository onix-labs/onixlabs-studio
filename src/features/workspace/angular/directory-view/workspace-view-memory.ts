import { Service } from '@angular/core';
import type { TrustChange, TrustScanRequest } from '@shared/api/trust-channels';

/**
 * Remembers which requests a workspace's views have already acted on, for as long as its tab is open.
 * A view made again when its tab moves to another window (#1587) reads the same requests as the view
 * before it, and must not act on them twice: scan the folder again, say, or pull the Logs panel
 * forward for a request answered long ago.
 */
@Service({ autoProvided: false })
export class WorkspaceViewMemory {
  /**
   * Holds the trust scan last started, or null for none.
   */
  public scan: TrustScanRequest | null = null;

  /**
   * Holds the trust decision last acted on, or null for none.
   */
  public trustChange: TrustChange | null = null;

  /**
   * Holds how many requests to show a log had been answered.
   */
  public showRequests: number = 0;
}
