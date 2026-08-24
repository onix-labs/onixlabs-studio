import { logger } from '../../logger';
import { GrantPolicy } from './grant-policy';
import {
  ContributionOrigin,
  GrantDecision,
  PermissionAuditEntry,
  PermissionDeniedError,
  PermissionId,
} from './permission';

/**
 * Mints the handle a granted permission resolves to. Possession of the returned handle *is* the
 * authority — the contribution reaches the privileged resource only through it, never through the raw
 * primitive (mirrors write-confinement, where possession of the roots is the authority).
 */
export interface PermissionFactory<T = unknown> {
  /**
   * Gets the permission this factory mints the handle for.
   */
  readonly id: PermissionId;

  /**
   * Creates the handle for the granted permission.
   * @returns Returns the resource handle.
   */
  create(): T;
}

/**
 * Identifies the contribution a permission is being resolved for: its id, its origin (which the policy
 * keys on), and the ceiling of permissions it declared.
 */
export interface PermissionRequest {
  /**
   * The requesting contribution's id.
   */
  readonly contributionId: string;

  /**
   * The requesting contribution's origin.
   */
  readonly origin: ContributionOrigin;

  /**
   * The permissions the contribution declared — the ceiling; nothing outside it can be resolved.
   */
  readonly declared: ReadonlySet<PermissionId>;
}

/**
 * Turns a granted permission into its handle, enforcing the permission model at the one door
 * contributions reach privileged resources through ({@link ContributionContext.permission}). The
 * declared set is the ceiling (no runtime escalation beyond the manifest), the {@link GrantPolicy}
 * makes the allow/deny call, every decision is audited, and a refusal is a thrown
 * {@link PermissionDeniedError} — never a silent `undefined`.
 *
 * Honest scope: this is the permission model, not a sandbox. For first-party, in-bundle code the
 * broker is the real, uniform, audited front door; it is not a hard boundary against hostile code
 * (a first-party contribution could reach a raw primitive directly). Making the grant unbypassable for
 * third-party code requires running it out-of-process (#295/#297), which is a later, separate step.
 */
export class PermissionBroker {
  /**
   * Initializes a new instance of the {@link PermissionBroker} class.
   * @param factories The handle factory for each brokered permission.
   * @param policy The policy deciding whether a declared permission is granted.
   * @param audit Receives one record per grant or denial.
   */
  public constructor(
    private readonly factories: ReadonlyMap<PermissionId, PermissionFactory>,
    private readonly policy: GrantPolicy,
    private readonly audit: (entry: PermissionAuditEntry) => void,
  ) {}

  /**
   * Resolves a permission to its handle, or throws {@link PermissionDeniedError} when it is not
   * declared, not granted by the policy, or has no registered factory. Every path is audited.
   * @param request The contribution the permission is resolved for.
   * @param permission The permission being requested.
   * @returns Returns the granted resource handle.
   */
  public resolve<T>(request: PermissionRequest, permission: PermissionId): T {
    logger.trace('PermissionBroker', `Resolving '${permission}' for '${request.contributionId}'`);
    if (!request.declared.has(permission)) {
      logger.warn(
        'PermissionBroker',
        `Denied '${permission}' for '${request.contributionId}': undeclared`,
      );
      this.audit({
        contributionId: request.contributionId,
        permission,
        decision: 'deny',
        source: 'undeclared',
      });
      throw new PermissionDeniedError(request.contributionId, permission, 'undeclared');
    }

    const decision: GrantDecision = this.policy.decide(request.origin, permission);
    if (decision !== 'allow') {
      logger.warn(
        'PermissionBroker',
        `Denied '${permission}' for '${request.contributionId}': policy decided '${decision}'`,
      );
      this.audit({
        contributionId: request.contributionId,
        permission,
        decision,
        source: 'policy',
      });
      throw new PermissionDeniedError(request.contributionId, permission, 'denied');
    }

    const factory: PermissionFactory | undefined = this.factories.get(permission);
    if (factory === undefined) {
      // Granted by policy but nothing can mint it — treat as a denial rather than returning nothing.
      logger.warn(
        'PermissionBroker',
        `Denied '${permission}' for '${request.contributionId}': no registered factory`,
      );
      this.audit({
        contributionId: request.contributionId,
        permission,
        decision: 'deny',
        source: 'policy',
      });
      throw new PermissionDeniedError(request.contributionId, permission, 'denied');
    }

    logger.debug('PermissionBroker', `Granted '${permission}' to '${request.contributionId}'`);
    this.audit({
      contributionId: request.contributionId,
      permission,
      decision: 'allow',
      source: 'policy',
    });
    return factory.create() as T;
  }
}
