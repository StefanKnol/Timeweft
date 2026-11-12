/**
 * The author's pages, served from the web app's built folder where it exists. A path that names no
 * file gets index.html, so a page's own address can be reloaded. A path is never allowed to climb
 * out of the folder.
 */
import { stat, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticFile {
  body: Buffer;
  contentType: string;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The file a request path names inside `root`, or null where the path is unsafe or the folder has
 * no index.html to fall back on.
 */
export async function staticFileFor(root: string, requestPath: string): Promise<StaticFile | null> {
  const rootFolder = resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const wanted = resolve(rootFolder, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  const inside = wanted === rootFolder || wanted.startsWith(rootFolder + sep);
  if (!inside) return null;
  const path = inside && await isFile(wanted) ? wanted : resolve(rootFolder, 'index.html');
  if (!await isFile(path)) return null;
  return { body: await readFile(path), contentType: CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' };
}
