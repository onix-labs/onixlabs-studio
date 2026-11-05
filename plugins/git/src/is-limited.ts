import { VCS_NETWORK_OPS, VersionControlOp } from './protocol';

/**
 * Determines whether a request waits its turn in its repository. One that reaches another machine
 * does not: it can take many minutes, and Studio gives a local request one, so with the places taken
 * by a few fetches `status` would time out with nothing wrong.
 * @param op The request.
 * @returns Returns true when the request counts against the repository's limit.
 */
export function isLimited(op: VersionControlOp): boolean {
  return !VCS_NETWORK_OPS.includes(op);
}
