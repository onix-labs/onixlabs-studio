/**
 * The origin of a contribution, which the grant policy keys its decision on. Every entry in the
 * static in-bundle `mainContributions` manifest is `first-party` (we shipped it); the loader that
 * discovers third-party extensions (#295) will tag those `third-party`.
 */
export type ContributionOrigin = 'first-party' | 'third-party';

/**
 * The grant decision for a requested permission — the same three values as the agent's per-tool
 * policy (`ai/tool-policy.ts`), deliberately: this is the same allow/ask/deny permission model applied
 * to main-process contributions. `ask` is reserved for the E3 grant prompt (#295) and never returned
 * by the v0 policy.
 */
export type GrantDecision = 'allow' | 'ask' | 'deny';

/**
 * A privileged permission a contribution can declare and the broker can grant. The catalogue is a
 * closed union — widened as brokers are added — so a manifest can only ever name a permission the host
 * actually knows how to broker. v0 is the single container engine socket.
 */
export type PermissionId = 'container.socket';

/**
 * Every known {@link PermissionId}, for validating declared permissions from an (eventually untrusted)
 * manifest.
 */
export const PERMISSION_IDS: readonly PermissionId[] = ['container.socket'];

/**
 * Why a permission was refused: the contribution never declared it in its manifest (the declared set
 * is the ceiling), or the grant policy denied the declared request.
 */
export type PermissionDenialReason = 'undeclared' | 'denied';

/**
 * Thrown when a contribution asks for a permission it may not have. A denial is always loud — this
 * error, surfaced and audited — never a silent `undefined`, so a caller (P3) can catch it and report
 * "access not granted" rather than crashing on a missing resource.
 */
export class PermissionDeniedError extends Error {
  /**
   * Initializes a new instance of the {@link PermissionDeniedError} class.
   * @param contributionId The contribution that was refused.
   * @param permission The permission it asked for.
   * @param reason Why it was refused.
   */
  public constructor(
    public readonly contributionId: string,
    public readonly permission: string,
    public readonly reason: PermissionDenialReason,
  ) {
    super(`contribution '${contributionId}' denied permission '${permission}' (${reason})`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * How a permission decision was reached, for the audit record: the request was refused because it was
 * never declared (`undeclared`), or the grant policy decided it (`policy`).
 */
export type PermissionAuditSource = 'undeclared' | 'policy';

/**
 * A single audit record: one permission grant or denial, emitted by the broker for after-the-fact
 * review (mirrors the agent audit log's intent, #308).
 */
export interface PermissionAuditEntry {
  /**
   * The contribution the decision was made for.
   */
  readonly contributionId: string;

  /**
   * The permission that was requested.
   */
  readonly permission: PermissionId;

  /**
   * The decision reached.
   */
  readonly decision: GrantDecision;

  /**
   * How the decision was reached.
   */
  readonly source: PermissionAuditSource;
}

/**
 * Sanitises the permissions a contribution declares, keeping only known {@link PermissionId} values
 * and dropping anything unknown or malformed (mirrors `sanitizeToolPolicies`). This is what stops a
 * manifest — trusted today, untrusted once the loader lands — from naming a permission the host does
 * not broker. The result is the ceiling the broker enforces against.
 * @param declared The permissions the manifest declared, or undefined.
 * @returns Returns the set of recognised declared permissions.
 */
export function sanitizePermissions(
  declared: readonly string[] | undefined,
): ReadonlySet<PermissionId> {
  const permitted: Set<PermissionId> = new Set<PermissionId>();
  for (const id of declared ?? []) {
    if ((PERMISSION_IDS as readonly string[]).includes(id)) {
      permitted.add(id as PermissionId);
    }
  }
  return permitted;
}
