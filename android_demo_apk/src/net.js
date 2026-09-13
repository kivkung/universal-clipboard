import os from 'node:os';

export function localIPv4s() {
  const out = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({
          name,
          address: info.address,
          netmask: info.netmask,
          cidr: info.cidr,
          broadcast: ipv4Broadcast(info.address, info.netmask)
        });
      }
    }
  }
  return out;
}

export function ipv4Broadcast(address, netmask) {
  const ip = ipv4ToInt(address);
  const mask = ipv4ToInt(netmask);
  return intToIpv4((ip | (~mask >>> 0)) >>> 0);
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function intToIpv4(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function sameLanHint(ip, netmask = '255.255.255.0') {
  try { return ipv4Broadcast(ip, netmask); }
  catch { return null; }
}
