import { ContributionOrigin, GrantDecision, PermissionId } from './permission';

/**
 * Decides whether a declared permission is granted, keyed on the requesting contribution's origin —
 * the main-process analog of the agent's per-tool policy plus posture. Kept an interface so richer
 * policies (a persisted, user-driven `StoredGrantPolicy` backed by a grants file, arriving with the
 * E3 grant prompt #295) drop in without touching the broker.
 */
export interface GrantPolicy {
  /**
   * Decides the grant for a permission.
   * @param origin The requesting contribution's origin.
   * @param permission The permission being requested.
   * @returns Returns the decision.
   */
  decide(origin: ContributionOrigin, permission: PermissionId): GrantDecision;
}

/**
 * The v0 grant policy: our in-bundle first-party contributions are trusted and granted; nothing else
 * is granted yet. `ask` becomes real when the E3 grant prompt (#295) lands and third-party
 * contributions start being tagged `third-party` — this class is then replaced, and nothing else in
 * the permission model changes.
 */
export class DefaultGrantPolicy implements GrantPolicy {
  /**
   * Grants any permission to a first-party contribution and denies everything else.
   * @param origin The requesting contribution's origin.
   * @returns Returns `allow` for first-party contributions; otherwise `deny`.
   */
  public decide(origin: ContributionOrigin): GrantDecision {
    return origin === 'first-party' ? 'allow' : 'deny';
  }
}
