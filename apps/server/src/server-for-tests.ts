/**
 * A real server on a real port, against a store of its own, for the server's tests. It is not a
 * test file itself, so it is typechecked like the rest.
 */
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Store } from '@timeweft/contract';
import { createTimeweftServer } from './http-server.ts';

/** Where the server's tests keep their schemas, unless the caller names another database. */
export const DEFAULT_SERVER_TEST_DATABASE_URL = 'postgres://timeweft:timeweft@127.0.0.1:5432/timeweft_test_server';
process.env['TIMEWEFT_TEST_DATABASE_URL'] ??= DEFAULT_SERVER_TEST_DATABASE_URL;

export const TEST_TOKEN = 'a-token-for-the-demo-world';

export interface RunningServer {
  store: Store;
  server: Server;
  baseUrl: string;
  port: number;
  /** Calls one operation over HTTP with the token, and answers with the status and parsed body. */
  call(name: string, input: unknown): Promise<{ status: number; body: { ok: boolean; answer?: unknown; refusal?: string } }>;
  /** A connected MCP client, with the token. */
  mcpClient(): Promise<Client>;
  stop(): Promise<void>;
}

export async function startServerForTests(options: { webRoot?: string | null; accessToken?: string | null; storyToken?: string | null } = {}): Promise<RunningServer> {
  const { openStoreForTests } = await import('@timeweft/store');
  const opened = await openStoreForTests();
  const accessToken = options.accessToken === undefined ? TEST_TOKEN : options.accessToken;
  const server = createTimeweftServer({ store: opened.store, accessToken, storyToken: options.storyToken ?? null, webRoot: options.webRoot ?? null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const clients: Client[] = [];
  return {
    store: opened.store,
    server,
    baseUrl,
    port,
    async call(name, input) {
      const response = await fetch(`${baseUrl}/api/operations/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
        body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() as { ok: boolean; answer?: unknown; refusal?: string } };
    },
    async mcpClient() {
      const client = new Client({ name: 'a-story-chat', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}` } },
      });
      await client.connect(transport);
      clients.push(client);
      return client;
    },
    async stop() {
      for (const client of clients) await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await opened.dispose();
    },
  };
}

/**
 * Sends bytes exactly as given and answers with what came back, so a test can send what fetch
 * would refuse to build, such as an address that is not a URL.
 */
export function sendRawRequest(port: number, rawRequest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Written and left open: a socket the client half-closes is dropped by the server before an
    // answer that takes a moment can be written. Every raw request here asks to close instead.
    const socket = connect(port, '127.0.0.1', () => socket.write(rawRequest));
    socket.setTimeout(10_000, () => socket.destroy());
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** The status line's code from a raw answer, or null where nothing came back. */
export function statusOfRawAnswer(raw: string): number | null {
  const match = /^HTTP\/1\.1 (\d{3})/.exec(raw);
  return match === null ? null : Number(match[1]);
}
