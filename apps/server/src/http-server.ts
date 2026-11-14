/**
 * The one HTTP server: the operations as web routes, the story operations over MCP, a health
 * check, and the author's pages.
 *
 * Two rules hold whatever a request does. An answer is serialised before any header is written,
 * so a value that cannot be sent is an ordinary failure rather than half an answer. And nothing a
 * request throws ends the process: every request's handling runs inside one catch, and an address
 * that cannot even be read is a 400.
 *
 * Answers and the pages' files are compressed where the browser says it can read them: brotli
 * first, then gzip, else sent as they are. A phone on mobile data then fetches about a tenth of the
 * bytes. The MCP route is left as its transport writes it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { buildStampFromEnvironment } from './build-stamp.ts';
import { OPERATION_ROUTE_PREFIX, Refusal, type OperationName, type Store, type WireAnswer } from '@timeweft/contract';
import { carriesATokenForStories, carriesTheToken, type AccessSettings } from './access.ts';
import { serveMcpRequest } from './mcp.ts';
import { isOperationName, runOperation } from './operations.ts';
import { staticFileFor, type StaticFile } from './static-files.ts';

/** The largest body a request may carry. A scene with a long record is far below it. */
export const LARGEST_BODY_BYTES = 5 * 1024 * 1024;

/**
 * The routes that may carry more than the default, as the wire says. An import carries five
 * whole files, which a run kept by hand for a long while can make far larger than any scene. A
 * restore carries a whole backup: every scene with every struck take, every fact with its
 * history, and every change the author made, so it is given far more room than anything else.
 * The body is held in memory while it is read, which is why there is a limit at all.
 */
export const LARGEST_BODY_BYTES_BY_OPERATION: Partial<Record<OperationName, number>> = {
  import_run: 24 * 1024 * 1024,
  restore_run: 200 * 1024 * 1024,
};

/**
 * The most objects and lists a body may hold. Parsing turns every `{` and `[` into an object of its
 * own, and the cost of that does not follow the body's size: 200 MB of rows of a backup parse into
 * about 240 MB, while 200 MB written as `[{},{},...]` is 70 million objects and more than the
 * process's whole memory, which ends the process rather than refusing the request. So the body is
 * counted before it is parsed. A real backup holds one object per row and one list per table and
 * per list column, a few hundred bytes apart, so 200 MB of one is well under a million; four
 * million costs at most about 300 MB to parse.
 */
export const LARGEST_OBJECTS_AND_LISTS_PER_BODY = 4_000_000;

/**
 * How many objects and lists a JSON body could hold, as the count of its `{` and `[` bytes. A
 * bracket inside a string is counted too, so this is never below the true count. In UTF-8 neither
 * byte is ever part of a longer character, so the bytes can be counted without decoding.
 */
export function objectsAndListsAtMost(body: Buffer): number {
  let count = 0;
  for (let index = 0; index < body.length; index += 1) {
    const byte = body[index];
    if (byte === 0x7b || byte === 0x5b) count += 1;
  }
  return count;
}

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

/** Thrown before a body is parsed where it holds more objects and lists than any request needs. */
class TooManyObjectsAndLists extends Error {}

/** The sentence for a body that holds too many objects and lists to be parsed. */
export const TOO_MANY_OBJECTS_AND_LISTS_SENTENCE =
  `The request body holds more than ${LARGEST_OBJECTS_AND_LISTS_PER_BODY.toLocaleString('en')} objects and lists, far more than any backup or request needs, so it was not read and nothing was changed.`;

/** The request's path, or null where its address cannot be read as a URL. */
export function readRequestPath(request: IncomingMessage): string | null {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}


/** How an answer's bytes are sent: brotli, gzip, or as they are. */
export type ContentEncoding = 'br' | 'gzip' | 'identity';

/**
 * Below this many bytes an answer is sent as it is. Compressing a short refusal saves a few bytes
 * and costs more than it saves, and the headers alone are about this size.
 */
export const SMALLEST_BODY_WORTH_COMPRESSING = 1024;

/**
 * The encoding to send, read from the request's Accept-Encoding header. Each encoding the browser
 * names may carry a weight (`gzip;q=0.5`), and a weight of 0 means "never". `*` stands for any
 * encoding not named. Brotli is chosen over gzip where both are equally welcome, since it makes the
 * smaller answer. A request that names neither, or sends no header at all, gets the answer as it is.
 */
export function encodingAcceptedBy(acceptEncoding: string | string[] | undefined): ContentEncoding {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : acceptEncoding ?? '';
  const weights = new Map<string, number>();
  for (const part of header.split(',')) {
    const [nameWithSpaces, ...parameters] = part.split(';');
    const name = (nameWithSpaces ?? '').trim().toLowerCase();
    if (name === '') continue;
    let weight = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter);
      if (match !== null) weight = Number(match[1]);
    }
    if (!Number.isFinite(weight)) weight = 0;
    weights.set(name === 'x-gzip' ? 'gzip' : name, weight);
  }
  const anyOther = weights.get('*') ?? 0;
  const brotliWeight = weights.get('br') ?? anyOther;
  const gzipWeight = weights.get('gzip') ?? anyOther;
  if (brotliWeight > 0 && brotliWeight >= gzipWeight) return 'br';
  if (gzipWeight > 0) return 'gzip';
  return 'identity';
}

/**
 * Whether bytes of this type get smaller when compressed. Text, JSON, scripts and SVG do. Pictures
 * and fonts are compressed already, so compressing them again only spends time.
 */
export function isCompressibleContentType(contentType: string): boolean {
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/javascript'
    || type === 'image/svg+xml';
}

const compressWithBrotli = promisify(brotliCompress);
const compressWithGzip = promisify(gzip);

/**
 * How hard to work. An answer is compressed every time it is asked for, so it gets a quick setting:
 * a 3.5 MB run comes down to about a tenth in about 50 milliseconds. A page's file is compressed
 * once and kept, so it gets the slowest, smallest setting.
 */
type CompressionEffort = 'for-an-answer' | 'for-a-kept-file';

/** The bytes compressed in the given encoding, off the main thread. */
async function compressBytes(body: Buffer, encoding: 'br' | 'gzip', effort: CompressionEffort): Promise<Buffer> {
  if (encoding === 'gzip') return compressWithGzip(body, { level: effort === 'for-an-answer' ? 6 : 9 });
  return compressWithBrotli(body, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: effort === 'for-an-answer' ? 5 : zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  });
}

/**
 * The page files already compressed, by path, encoding, size and time of change, so a file is
 * compressed once per build. A rebuilt file has a new time and is compressed afresh. The folder is
 * the built pages, a few hundred kilobytes, so the memory this holds stays small.
 */
const compressedFiles = new Map<string, Buffer>();

async function compressedFile(file: StaticFile, encoding: 'br' | 'gzip'): Promise<Buffer> {
  const key = `${encoding}\u0000${file.modifiedMilliseconds}\u0000${file.body.length}\u0000${file.path}`;
  const kept = compressedFiles.get(key);
  if (kept !== undefined) return kept;
  const made = await compressBytes(file.body, encoding, 'for-a-kept-file');
  for (const earlierKey of compressedFiles.keys()) {
    if (earlierKey.startsWith(`${encoding}\u0000`) && earlierKey.endsWith(`\u0000${file.path}`)) compressedFiles.delete(earlierKey);
  }
  compressedFiles.set(key, made);
  return made;
}

/**
 * Sends a JSON answer, compressed in the encoding given where it is large enough to be worth it.
 * The value is serialised and compressed before any header is written. Where the encoding was read
 * from the request, the answer says it varies by Accept-Encoding, so a cache in between never hands
 * a compressed answer to a browser that cannot read it.
 */
async function sendJson(response: ServerResponse, status: number, value: unknown, encoding: ContentEncoding = 'identity', variesByEncoding = false): Promise<void> {
  const plain = Buffer.from(JSON.stringify(value), 'utf8');
  const compress = encoding !== 'identity' && plain.length >= SMALLEST_BODY_WORTH_COMPRESSING;
  const body = compress ? await compressBytes(plain, encoding, 'for-an-answer') : plain;
  const headers: Record<string, string | number> = { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length };
  if (compress) headers['content-encoding'] = encoding;
  if (variesByEncoding) headers['vary'] = 'Accept-Encoding';
  response.writeHead(status, headers);
  response.end(body);
}

/** Sends a JSON answer in the encoding the request accepts. */
function sendJsonTo(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): Promise<void> {
  return sendJson(response, status, value, encodingAcceptedBy(request.headers['accept-encoding']), true);
}

function sendRefusal(request: IncomingMessage, response: ServerResponse, status: number, sentence: string): Promise<void> {
  const answer: WireAnswer<never> = { ok: false, refusal: sentence };
  return sendJsonTo(request, response, status, answer);
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

/**
 * The body as JSON. An empty body is an empty object, since several operations take nothing. A
 * body holding more objects and lists than any request needs is not parsed at all.
 */
function parseJsonBody(body: Buffer): { ok: true; value: unknown } | { ok: false } {
  if (objectsAndListsAtMost(body) > LARGEST_OBJECTS_AND_LISTS_PER_BODY) throw new TooManyObjectsAndLists();
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
    await sendRefusal(request, response, 404, `There is no operation called "${name}".`);
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    await sendRefusal(request, response, 405, `An operation is called with POST, not ${request.method ?? 'nothing'}.`);
    return;
  }
  if (!isJsonContentType(request)) {
    await sendRefusal(request, response, 415, 'An operation takes a JSON body, sent as application/json.');
    return;
  }
  const parsed = parseJsonBody(await readBody(request, largestBodyBytesFor(name)));
  if (!parsed.ok) {
    await sendRefusal(request, response, 400, 'The request body is not readable JSON.');
    return;
  }
  try {
    // Over the web routes the caller holds the token and is the author.
    const answer = await runOperation(settings.store, name, parsed.value, 'author');
    await sendJsonTo(request, response, 200, { ok: true, answer });
  } catch (error) {
    if (error instanceof Refusal) {
      await sendRefusal(request, response, 400, error.message);
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
      await sendJson(response, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'The request body is not readable JSON.' }, id: null });
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
  // A HEAD gets the same headers as a GET, the compressed length among them, and no body.
  const encoding = isCompressibleContentType(file.contentType) && file.body.length >= SMALLEST_BODY_WORTH_COMPRESSING
    ? encodingAcceptedBy(request.headers['accept-encoding'])
    : 'identity';
  const body = encoding === 'identity' ? file.body : await compressedFile(file, encoding);
  const headers: Record<string, string | number> = { 'content-type': file.contentType, 'content-length': body.length };
  if (encoding !== 'identity') headers['content-encoding'] = encoding;
  if (isCompressibleContentType(file.contentType)) headers['vary'] = 'Accept-Encoding';
  response.writeHead(200, headers);
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function handleRequest(settings: ServerSettings, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = readRequestPath(request);
  if (path === null) {
    await sendRefusal(request, response, 400, 'The address of this request could not be read.');
    return;
  }
  if (path === '/health') {
    await sendJsonTo(request, response, 200, { ok: true, build: buildStampFromEnvironment(process.env) });
    return;
  }
  const isApi = path === '/api' || path.startsWith('/api/');
  const isMcp = path === MCP_PATH || path.startsWith(`${MCP_PATH}/`);
  if (isApi || isMcp) {
    // The story token, where one is set, opens /mcp and never the author's routes.
    const letIn = isMcp ? carriesATokenForStories(request.headers, settings) : carriesTheToken(request.headers, settings);
    if (!letIn) {
      response.setHeader('www-authenticate', 'Bearer');
      await sendRefusal(request, response, 401, 'This server needs the access token, as "Authorization: Bearer <token>".');
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
    await sendRefusal(request, response, 404, `There is nothing at ${path}.`);
    return;
  }
  await serveStatic(settings, request, response, path);
}

/** Whatever escapes a request's own handling is answered for that request and logged. */
async function handleWithNothingEscaping(settings: ServerSettings, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await handleRequest(settings, request, response);
  } catch (error) {
    if (error instanceof TooManyObjectsAndLists) {
      if (!response.headersSent) await sendRefusal(request, response, 413, TOO_MANY_OBJECTS_AND_LISTS_SENTENCE);
      else response.destroy();
      return;
    }
    if (error instanceof BodyTooLarge) {
      if (!response.headersSent) {
        response.setHeader('connection', 'close');
        await sendRefusal(request, response, 413, bodyTooLargeSentence(error.largestBytes));
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
      await sendJsonTo(request, response, 500, { ok: false, refusal: 'The server failed while answering. Nothing was refused on purpose.' });
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
