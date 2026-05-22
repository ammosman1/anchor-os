// api/teller/_http.js
// Wrapper around Node.js https.request that injects Teller client certificates.
// Teller requires mutual TLS for all API calls — the access token alone is not enough.
//
// Vercel env vars to set:
//   TELLER_CERT  — base64-encoded certificate PEM  (openssl base64 -in cert.pem | tr -d '\n')
//   TELLER_KEY   — base64-encoded private key PEM  (openssl base64 -in key.pem  | tr -d '\n')
//
// If a single combined .pem contains both cert + key, set TELLER_CERT to the
// base64 of the full file and leave TELLER_KEY blank — the https.Agent will accept it.

import https from 'https';

let _agent = null;

function getAgent() {
  if (_agent) return _agent;
  const rawCert = process.env.TELLER_CERT;
  const rawKey  = process.env.TELLER_KEY  || process.env.TELLER_CERT; // fallback: combined PEM
  if (!rawCert) return null;
  const cert = Buffer.from(rawCert, 'base64').toString('utf8');
  const key  = Buffer.from(rawKey,  'base64').toString('utf8');
  _agent = new https.Agent({ cert, key });
  return _agent;
}

/**
 * Drop-in replacement for fetch() that adds the Teller mTLS agent.
 * Falls back to plain fetch if certs are not configured (sandbox mode).
 */
export function tellerFetch(url, options = {}) {
  const agent = getAgent();
  if (!agent) {
    // No cert configured — will likely fail in production but allows sandbox testing
    console.warn('TELLER_CERT not set — requests will fail without client certificate');
    return fetch(url, options);
  }
  // Native fetch doesn't accept `agent`; use https.request directly
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
      agent,
    };
    const req = https.request(reqOptions, (nodeRes) => {
      const chunks = [];
      nodeRes.on('data', c => chunks.push(c));
      nodeRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok:     nodeRes.statusCode >= 200 && nodeRes.statusCode < 300,
          status: nodeRes.statusCode,
          json:   () => Promise.resolve(JSON.parse(body)),
          text:   () => Promise.resolve(body),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
