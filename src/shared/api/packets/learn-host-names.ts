import { dissect } from './dissect-packet';
import { HostNameSighting } from './packet-model';

/**
 * Learns the host names a captured packet names for addresses: each address a successful DNS
 * response gives, called by the name that was asked for (following its CNAMEs), and the server name a
 * TLS Client Hello asks for, for the address it is sent to. Most packets name none.
 * @param linkType The capture's link-layer header type.
 * @param data The packet's captured bytes.
 * @returns Returns the names, in the order the packet gives them.
 */
export function learnHostNames(linkType: number, data: Uint8Array): readonly HostNameSighting[] {
  return dissect(linkType, data).hostNames;
}
