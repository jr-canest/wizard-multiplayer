// Userland link conditioner. Chrome's built-in network emulation does not
// limit the bandwidth of long-lived streams (Firestore's channel, WebSockets)
// in this setup, so bad networks are modelled here at the TCP level instead:
// every connection gets a token-bucket rate limit and a fixed one-way delay
// in each direction, and can be cut entirely ("offline").
//
//   node shaper.mjs --mode proxy   --listen 8899 --ctl 8999 --down 50 --up 50 --delay 200
//   node shaper.mjs --mode forward --listen 8788 --target 127.0.0.1:8787 --ctl 8998 ...
//
// proxy   = HTTP CONNECT proxy (Chrome --proxy-server); tunnels are shaped.
// forward = plain TCP forwarder to --target (for the local prototype).
// --down/--up in KB/s (0 = unlimited), --delay in ms per direction.
// Control: GET http://127.0.0.1:<ctl>/offline?on=1|0 drops all connections
// and refuses new ones until turned back off.
import net from 'node:net';
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const MODE = args.mode ?? 'proxy';
const LISTEN = Number(args.listen);
const CTL = Number(args.ctl);
const DOWN = Number(args.down ?? 0) * 1024; // bytes/s toward the browser
const UP = Number(args.up ?? 0) * 1024;     // bytes/s toward the server
const DELAY = Number(args.delay ?? 0);
const [T_HOST, T_PORT] = (args.target ?? '127.0.0.1:8787').split(':');

let offline = false;
const live = new Set();
// Ground-truth wire bytes (TLS-encrypted, so ~1-2% above payload).
const wire = { down: 0, up: 0 };

/** Pipe src -> dst through a modelled link: each 4 KB piece occupies the
 *  link for piece/bytesPerSec (serialisation) and then takes delayMs to
 *  arrive (propagation). Pieces are scheduled in order, so this is exact
 *  and needs no token bucket. */
function shapedPipe(src, dst, bytesPerSec, delayMs, dir) {
  let nextFree = 0; // when the link is next free, ms epoch
  src.on('data', (chunk) => {
    const t = Date.now();
    for (let off = 0; off < chunk.length; off += 4096) {
      const piece = chunk.subarray(off, off + 4096);
      const start = Math.max(t, nextFree);
      nextFree = start + (bytesPerSec > 0 ? (piece.length / bytesPerSec) * 1000 : 0);
      wire[dir] += piece.length;
      setTimeout(() => { if (!dst.destroyed) dst.write(piece); }, nextFree + delayMs - t);
    }
    // Backpressure: never let the sender queue more than ~2 s of link time.
    if (nextFree - t > 2000) { src.pause(); setTimeout(() => src.resume(), nextFree - t - 1000); }
  });
  src.on('end', () => setTimeout(() => { if (!dst.destroyed) dst.end(); }, Math.max(0, nextFree - Date.now()) + delayMs));
  src.on('error', () => dst.destroy());
}

function bridge(client, upstream) {
  live.add(client); live.add(upstream);
  shapedPipe(upstream, client, DOWN, DELAY, 'down');
  shapedPipe(client, upstream, UP, DELAY, 'up');
  const cleanup = () => { live.delete(client); live.delete(upstream); };
  client.on('close', cleanup); upstream.on('close', cleanup);
}

if (MODE === 'proxy') {
  const server = http.createServer((req, res) => { res.writeHead(405); res.end('CONNECT only'); });
  server.on('connect', (req, clientSocket, head) => {
    if (offline) { clientSocket.destroy(); return; }
    const [host, port] = req.url.split(':');
    const upstream = net.connect({ port: Number(port) || 443, host, autoSelectFamily: true }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      bridge(clientSocket, upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  server.listen(LISTEN, '127.0.0.1');
} else {
  const server = net.createServer((client) => {
    if (offline) { client.destroy(); return; }
    const upstream = net.connect({ port: Number(T_PORT), host: T_HOST, autoSelectFamily: true }, () => bridge(client, upstream));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  server.listen(LISTEN, '127.0.0.1');
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/offline') {
    offline = u.searchParams.get('on') === '1';
    if (offline) for (const s of live) s.destroy();
    res.end(JSON.stringify({ offline }));
    return;
  }
  res.end(JSON.stringify({ mode: MODE, listen: LISTEN, down: DOWN, up: UP, delay: DELAY, offline, live: live.size, wireDown: wire.down, wireUp: wire.up }));
}).listen(CTL, '127.0.0.1');
console.log(`shaper ${MODE} :${LISTEN} ctl :${CTL} down ${DOWN / 1024} KB/s up ${UP / 1024} KB/s delay ${DELAY} ms`);
