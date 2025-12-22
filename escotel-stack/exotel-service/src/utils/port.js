import net from 'node:net';

export function checkPort(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export async function findAvailablePort(start, end = start + 20) {
  for (let p = start; p <= end; p++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkPort(p);
    if (ok) return p;
  }
  throw new Error(`No available port found in range ${start}-${end}`);
}
