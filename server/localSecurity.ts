/** Browser request boundaries for the loopback-only API and WebSocket server. */
export function isLocalRequestAllowed(host: string, origin?: string, fetchSite?: string, webPort?: string): boolean {
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  let localOrigin: string;
  try { localOrigin = new URL(`http://${host}`).origin; } catch { return false; }
  if (fetchSite === 'cross-site') return false;
  if (!origin) return true;
  const allowed = [localOrigin];
  if (webPort && /^\d{1,5}$/.test(webPort)) allowed.push(`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`);
  return allowed.includes(origin);
}

/** Compare URL origins rather than accepting attacker-controlled prefix matches. */
export function isApplicationUrl(candidate: string, applicationUrl: string): boolean {
  try {
    const target = new URL(candidate);
    return !target.username && !target.password && target.origin === new URL(applicationUrl).origin;
  } catch { return false; }
}

export const APPLICATION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'";
