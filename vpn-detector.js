const https = require('https');
const http = require('http');

// In-memory cache for IP check results (TTL: 2 hours)
const vpnCache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000;

function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === 'localhost' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.3') ||
    ip.startsWith('fc00:') ||
    ip.startsWith('fe80:')
  );
}

function fetchJson(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', err => reject(err));
  });
}

/**
 * Checks if an IP is a VPN, Proxy, Tor, or Datacenter IP.
 * Uses proxycheck.io with automatic fallback to ip-api.com.
 *
 * @param {string} rawIp
 * @returns {Promise<{ isVpn: boolean, type?: string, operator?: string }>}
 */
async function checkIsVpn(rawIp) {
  if (!rawIp) return { isVpn: false };

  // Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:192.168.1.1)
  const cleanIp = rawIp.replace(/^::ffff:/, '').trim();

  if (isPrivateIp(cleanIp)) {
    return { isVpn: false, isPrivate: true };
  }

  // Check cache
  const cached = vpnCache.get(cleanIp);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  // 1. Primary check: proxycheck.io
  try {
    const pcUrl = `https://proxycheck.io/v2/${cleanIp}?vpn=1&asn=1`;
    const data = await fetchJson(pcUrl, 3500);

    if (data && data.status === 'ok' && data[cleanIp]) {
      const info = data[cleanIp];
      const isProxy = info.proxy === 'yes';
      const type = info.type || (isProxy ? 'VPN / Proxy' : 'Clean');
      const operator = info.operator?.name || info.asn || '';

      const result = {
        isVpn: isProxy,
        type: isProxy ? type : 'Clean',
        operator
      };

      vpnCache.set(cleanIp, { timestamp: Date.now(), result });
      return result;
    }
  } catch (err) {
    // Fallback to ip-api on error
  }

  // 2. Secondary check: ip-api.com
  try {
    const ipApiUrl = `http://ip-api.com/json/${cleanIp}?fields=status,message,proxy,hosting,isp,org`;
    const data = await fetchJson(ipApiUrl, 3500);

    if (data && data.status === 'success') {
      const isProxyOrHosting = Boolean(data.proxy || data.hosting);
      const result = {
        isVpn: isProxyOrHosting,
        type: data.hosting ? 'Datacenter / Cloud Host' : (data.proxy ? 'VPN / Proxy' : 'Clean'),
        operator: data.isp || data.org || ''
      };

      vpnCache.set(cleanIp, { timestamp: Date.now(), result });
      return result;
    }
  } catch (err) {}

  // If both external providers fail to respond, allow user through to avoid false-lockout
  return { isVpn: false, error: 'Lookup service unavailable' };
}

module.exports = {
  checkIsVpn,
  isPrivateIp
};
