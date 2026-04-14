const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

function isPrivateIpv4(ip) {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return true;

  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4[1]);
  }

  return false;
}

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function normalizeAndValidateOutboundUrl(urlString) {
  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    const err = new Error('Invalid URL format');
    err.status = 400;
    throw err;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    const err = new Error('URL must use http or https');
    err.status = 400;
    throw err;
  }

  if (parsedUrl.username || parsedUrl.password) {
    const err = new Error('URLs with embedded credentials are not allowed');
    err.status = 400;
    throw err;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    const err = new Error('Private or loopback destinations are not allowed');
    err.status = 400;
    throw err;
  }

  const directIpFamily = net.isIP(hostname);
  if (directIpFamily && isPrivateIp(hostname)) {
    const err = new Error('Private or loopback destinations are not allowed');
    err.status = 400;
    throw err;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    const err = new Error('Unable to resolve destination host');
    err.status = 400;
    throw err;
  }

  if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) {
    const err = new Error('Private or loopback destinations are not allowed');
    err.status = 400;
    throw err;
  }

  return parsedUrl.toString();
}

module.exports = {
  normalizeAndValidateOutboundUrl
};