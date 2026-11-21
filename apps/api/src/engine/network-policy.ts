import { BlockList, isIP } from 'node:net';

// Deny special-use ranges, including local services and cloud metadata endpoints.
// Public API experiments never need to reach infrastructure addresses.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(subnet, prefix, 'ipv4');
for (const [subnet, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blockedV6.addSubnet(subnet, prefix, 'ipv6');

function loopback(address: string): boolean {
  return address === '::1' || (isIP(address) === 4 && address.startsWith('127.'));
}

export function addressAllowed(address: string, allowLoopback = false): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (allowLoopback && loopback(address)) return true;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) return false;
  return family === 4
    ? !blockedV4.check(address, 'ipv4')
    : !blockedV6.check(address, 'ipv6');
}

export function validateOracleUrl(raw: string, allowLoopback = false): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('Oracle URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('Oracle URL must be HTTP(S) without credentials or fragments');
  }
  // External targets use HTTPS on its standard port. Loopback HTTP is allowed
  // only for the explicitly configured local development oracle.
  if (!allowLoopback && (url.protocol !== 'https:' || (url.port && url.port !== '443'))) {
    throw new Error('External oracle URL must use HTTPS on port 443');
  }
  // WHATWG URLs enclose IPv6 literals in brackets; validate the bare address.
  const hostAddress = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(hostAddress) && !addressAllowed(hostAddress, allowLoopback)) {
    throw new Error('Oracle URL resolves to a blocked network address');
  }
  return url;
}
