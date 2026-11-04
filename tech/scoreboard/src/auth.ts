// Race Committee authentication.
//
// Cloudflare Access sits in front of /admin and only lets through people on the
// Race Committee list. As a second check, the Worker verifies the signed JWT that
// Access attaches to every request it lets through. If Access isn't configured,
// nobody gets in (fails closed).

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './db';

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type AuthResult = { ok: true; email: string } | { ok: false; reason: string };

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const url = new URL(request.url);

  // Local development only: .dev.vars is never deployed, and production requests
  // can't arrive with a localhost hostname.
  if (env.DEV_RC_EMAIL && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return { ok: true, email: env.DEV_RC_EMAIL };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: false, reason: 'Cloudflare Access is not configured yet (ACCESS_TEAM_DOMAIN / ACCESS_AUD).' };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'This page must be reached through Cloudflare Access.' };

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    if (typeof payload.email !== 'string' || !payload.email) return { ok: false, reason: 'No email in Access token.' };
    return { ok: true, email: payload.email };
  } catch {
    return { ok: false, reason: 'Access token could not be verified.' };
  }
}
