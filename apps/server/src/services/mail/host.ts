import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Mail servers the user types in are checked before the server connects to them, so the
 * connection cannot be turned on the deployment's own network. The address is resolved once and
 * the connection goes to that address, with the certificate still checked against the name.
 */

export class MailHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailHostError';
  }
}

/** Ports mail is served on; a mailbox elsewhere is not something people have. */
export const IMAP_PORTS = new Set([143, 993]);
export const SMTP_PORTS = new Set([25, 465, 587]);

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/** Whether an address is on the public internet; IPv4 written as IPv6 is judged as IPv4. */
export const isPublicAddress = (address: string) => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  const family = isIP(ip);
  if (!family) return false;
  return !PRIVATE.check(ip, family === 6 ? 'ipv6' : 'ipv4');
};

/**
 * Only for local testing against a mail server on this machine: private addresses, any port, and
 * a self-signed certificate on a private address. Never set in production.
 */
export const allowsLocalMailServers = () => process.env.MAIL_ALLOW_PRIVATE_HOSTS === '1';

export interface ResolvedMailHost {
  /** The address to connect to */
  address: string;
  /** The name to check the certificate against */
  servername: string;
  /** Accept a self-signed certificate: local testing against a private address only */
  trustSelfSigned: boolean;
}

/** Resolves a mail server the user gave and refuses one on a private network or an odd port. */
export const resolveMailHost = async (
  host: string,
  port: number,
  ports: Set<number>,
): Promise<ResolvedMailHost> => {
  const name = host.trim().toLowerCase();
  if (!name || name.length > 253) throw new MailHostError('No mail server address');

  const local = allowsLocalMailServers();
  if (!local && !ports.has(port)) {
    throw new MailHostError(`Port ${port} is not a mail port (${[...ports].join(', ')})`);
  }

  let address: string;
  try {
    address = isIP(name) ? name : (await lookup(name)).address;
  } catch {
    throw new MailHostError(`Could not find the mail server ${name}`);
  }

  const isPublic = isPublicAddress(address);
  if (!isPublic && !local) {
    throw new MailHostError(`${name} is on a private network`);
  }
  return { address, servername: name, trustSelfSigned: !isPublic && local };
};
