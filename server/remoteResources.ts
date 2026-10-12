import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as fetchHttp } from 'undici';

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1).toLowerCase();
  const first = parseInt(normalized.split(':')[0], 16);
  return (first & 0xe000) === 0x2000 && !normalized.startsWith('2001:db8:') && !normalized.startsWith('2002:');
}

/** Validate and pin DNS answers so redirects and DNS rebinding cannot access the local API or LAN. */
export async function resolvePublicResource(url: string, resolver: Resolver = hostname => lookup(hostname, { all: true })): Promise<{ url: URL; addresses: Address[] }> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('La URL debe ser HTTP o HTTPS y no incluir credenciales');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('No se permite descargar desde direcciones locales');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  if (!addresses.length || addresses.some(answer => !isPublicAddress(answer.address))) throw new Error('No se permite descargar desde la red local o una dirección reservada');
  return { url: parsed, addresses };
}

export async function fetchPublicResource(url: string, options: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { url: parsed, addresses } = await resolvePublicResource(current);
    options.signal?.throwIfAborted();
    const agent = new Agent({ connect: { lookup(_hostname, settings, callback) {
      if (settings.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } } });
    let response: Awaited<ReturnType<typeof fetchHttp>>;
    try { response = await fetchHttp(parsed, { method: options.method ?? 'GET', headers: Object.fromEntries(new Headers(options.headers).entries()), signal: options.signal, redirect: 'manual', dispatcher: agent }); }
    catch (error) { await agent.destroy(); throw error; }
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      await response.body?.cancel();
      await agent.close();
      current = new URL(response.headers.get('location')!, parsed).href;
      continue;
    }
    const headers = Object.fromEntries(response.headers.entries());
    if (!response.body) { await agent.close(); return new Response(null, { status: response.status, statusText: response.statusText, headers }); }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { controller.close(); await agent.close(); }
          else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); await agent.destroy(); }
      },
      async cancel(reason) { await reader.cancel(reason); await agent.close(); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
  throw new Error('La descarga tiene demasiadas redirecciones');
}

/** Enforce the limit while streaming, before allocating the full response in memory. */
export async function readResponseLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('El archivo descargado supera el tamaño admitido'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('El archivo descargado supera el tamaño admitido'); }
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
