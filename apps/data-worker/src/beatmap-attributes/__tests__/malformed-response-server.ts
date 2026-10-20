import { createServer, type AddressInfo } from 'node:net';

/**
 * A local server that answers every request with `body` the way osu! serves
 * a beatmap whose difficulty name holds DEL characters: the name goes into
 * the file name of the Content-Disposition header, and Bun's fetch rejects
 * the whole response as malformed.
 */
export const startMalformedResponseServer = async (body: Uint8Array) => {
  const server = createServer((socket) => {
    socket.once('data', () => {
      const head =
        'HTTP/1.1 200 OK\r\n' +
        'Content-Type: text/plain\r\n' +
        `Content-Disposition: attachment;filename="Artist - Title (Mapper) [${'\x7f'.repeat(30)}].osu"\r\n` +
        `Content-Length: ${body.byteLength}\r\n` +
        'Connection: close\r\n\r\n';

      socket.end(Buffer.concat([Buffer.from(head, 'latin1'), body]));
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const { port } = server.address() as AddressInfo;

  return {
    /** A fetch that sends every request to this server instead. */
    fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${port}/`, init),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
};
