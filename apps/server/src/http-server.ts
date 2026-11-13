/**
 * The one HTTP server: the operations as web routes, the story operations over MCP, a health
 * check, and the author's pages.
 *
 * Two rules hold whatever a request does. An answer is serialised before any header is written,
 * so a value that cannot be sent is an ordinary failure rather than half an answer. And nothing a
 * request throws ends the process: every request's handling runs inside one catch, and an address
 * that cannot even be read is a 400.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildStampFromEnvironment } from './build-stamp.ts';
import { OPERATION_ROUTE_PREFIX, Refusal, type OperationName, type Store, type WireAnswer } from '@timeweft/contract';
import { carriesTheToken, type AccessSettings } from './access.ts';
import { serveMcpRequest } from './mcp.ts';
import { isOperationName, runOperation } from './operations.ts';
import { staticFileFor } from './static-files.ts';

/** The largest body a request may carry. A scene with a long record is far below it. */
export const LARGEST_BODY_BYTES = 5 * 1024 * 1024;

/**
 * The routes that may carry more than the default, as the wire says. An import carries five
 * whole files, which a run kept by hand for a long while can make far larger than any scene.
 */
export const LARGEST_BODY_BYTES_BY_OPERATION: Partial<Record<OperationName, number>> = {
  import_run: 24 * 1024 * 1024,
};

/** The largest body one operation's route takes. */
export function largestBodyBytesFor(name: OperationName): number {
  return LARGEST_BODY_BYTES_BY_OPERATION[name] ?? LARGEST_BODY_BYTES;
}

export const MCP_PATH = '/mcp';

export interface ServerSettings extends AccessSettings {
  store: Store;
  /** The web app's built folder, or null where there are no pages to serve. */
  webRoot: string | null;
}

/** Thrown while a body is read, carrying the limit it broke so the 413 says the right figure. */
class BodyTooLarge extends Error {
  // A plain field, since stripping types leaves no room for a parameter property.
  readonly largestBytes: number;
  constructor(largestBytes: number) {
    super(`The body is larger than ${largestBytes} bytes.`);
    this.largestBytes = largestBytes;
  }
}

/** The request's path, or null where its address cannot be read as a URL. */
export function readRequestPath(request: IncomingMessage): string | null {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function sendRefusal(response: ServerResponse, status: number, sentence: string): void {
  const answer: WireAnswer<never> = { ok: false, refusal: sentence };
  sendJson(response, status, answer);
}

/**
 * The body, refused before a byte is read where content-length already says it is too large, and
 * counted as it arrives otherwise, since a chunked body declares no length at all.
 */
async function readBody(request: IncomingMessage, largestBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > largestBytes) throw new BodyTooLarge(largestBytes);
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    received += piece.length;
    if (received > largestBytes) throw new BodyTooLarge(largestBytes);
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

/** The body as JSON. An empty body is an empty object, since several operations take nothing. */
function parseJsonBody(body: Buffer): { ok: true; value: unknown } | { ok: false } {
  const text = body.toString('utf8').trim();
  if (text === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers['content-type'];
  return contentType === undefined || /^application\/json\b/i.test(contentType.trim());
}

/** The 413's sentence, saying the limit of the route that was asked. */
export function bodyTooLargeSentence(largestBytes: number): string {
  return `The request body is larger than ${largestBytes / (1024 * 1024)} MB, which is the most this route takes.`;
}

async function serveOperation(settings: ServerSettings, request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const name = path.slice(OPERATION_ROUTE_PREFIX.length);
  if (!isOperationName(name)) {
    sendRefusal(response, 404, `There is no operation called "${name}".`);
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendRefusal(response, 405, `An operation is called with POST, not ${request.method ?? 'nothing'}.`);
    return;
  }
  if (!isJsonContentType(request)) {
    sendRefusal(response, 415, 'An operation takes a JSON body, sent as application/json.');
    return;
  }
  const parsed = parseJsonBody(await readBody(request, largestBodyBytesFor(name)));
  if (!parsed.ok) {
    sendRefusal(response, 400, 'The request body is not readable JSON.');
    return;
  }
  try {
    // Over the web routes the caller holds the token and is the author.
    const answer = await runOperation(settings.store, name, parsed.value, 'author');
    sendJson(response, 200, { ok: true, answer });
  } catch (error) {
    if (error instanceof Refusal) {
      sendRefusal(response, 400, error.message);
      return;
    }
    throw error;
  }
}

async function serveMcp(settings: ServerSettings, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let parsedBody: unknown;
  if (request.method === 'POST') {
    const parsed = parseJsonBody(await readBody(request, LARGEST_BODY_BYTES));
    if (!parsed.ok) {
      sendJson(response, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'The request body is not readable JSON.' }, id: null });
      return;
    }
    parsedBody = parsed.value;
  }
  await serveMcpRequest(settings.store, request, response, parsedBody);
}

async function serveStatic(settings: ServerSettings, request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const file = settings.webRoot === null || (request.method !== 'GET' && request.method !== 'HEAD')
    ? null
    : await staticFileFor(settings.webRoot, path);
  if (file === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
    return;
  }
  response.writeHead(200, { 'content-type': file.contentType, 'content-length': file.body.length });
  response.end(request.method === 'HEAD' ? undefined : file.body);
}

async function handleRequest(settings: ServerSettings, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = readRequestPath(request);
  if (path === null) {
    sendRefusal(response, 400, 'The address of this request could not be read.');
    return;
  }
  if (path === '/health') {
    sendJson(response, 200, { ok: true, build: buildStampFromEnvironment(process.env) });
    return;
  }
  const isApi = path === '/api' || path.startsWith('/api/');
  const isMcp = path === MCP_PATH || path.startsWith(`${MCP_PATH}/`);
  if (isApi || isMcp) {
    if (!carriesTheToken(request.headers, settings)) {
      response.setHeader('www-authenticate', 'Bearer');
      sendRefusal(response, 401, 'This server needs the access token, as "Authorization: Bearer <token>".');
      return;
    }
    if (isMcp) {
      await serveMcp(settings, request, response);
      return;
    }
    if (path.startsWith(OPERATION_ROUTE_PREFIX)) {
      await serveOperation(settings, request, response, path);
      return;
    }
    sendRefusal(response, 404, `There is nothing at ${path}.`);
    return;
  }
  await serveStatic(settings, request, response, path);
}

/** Whatever escapes a request's own handling is answered for that request and logged. */
async function handleWithNothingEscaping(settings: ServerSettings, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await handleRequest(settings, request, response);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      if (!response.headersSent) {
        response.setHeader('connection', 'close');
        sendRefusal(response, 413, bodyTooLargeSentence(error.largestBytes));
      } else {
        response.destroy();
      }
      return;
    }
    console.error('A request failed:', error);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    try {
      sendJson(response, 500, { ok: false, refusal: 'The server failed while answering. Nothing was refused on purpose.' });
    } catch {
      response.destroy();
    }
  }
}

export function createTimeweftServer(settings: ServerSettings): Server {
  return createServer((request, response) => {
    handleWithNothingEscaping(settings, request, response).catch((error: unknown) => {
      console.error('A request escaped every handler:', error);
      response.destroy();
    });
  });
}
