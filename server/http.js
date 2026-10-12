import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const gzipOk = res => /\bgzip\b/.test(res.req?.headers['accept-encoding'] ?? '');

export function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  const zip = data.length > 4096 && gzipOk(res);
  const out = zip ? gzipSync(data, { level: 4 }) : data;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': out.length, vary: 'accept-encoding', ...(zip ? { 'content-encoding': 'gzip' } : {}) });
  res.end(out);
}

// a body built once (raw, gzipped, etag), answered with 304 when the client has it
export function packBody(data, type) {
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const compressible = /text|json|javascript|svg/.test(type) && raw.length > 1024;
  return { raw, gz: compressible ? gzipSync(raw, { level: 9 }) : null, type, etag: `"${createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"` };
}

export function sendPacked(res, packed, cache = 'no-cache') {
  const head = { 'content-type': packed.type, 'cache-control': cache, etag: packed.etag, vary: 'accept-encoding' };
  if (res.req?.headers['if-none-match'] === packed.etag) {
    res.writeHead(304, head);
    return res.end();
  }
  const zip = packed.gz && gzipOk(res);
  const body = zip ? packed.gz : packed.raw;
  res.writeHead(200, { ...head, 'content-length': body.length, ...(zip ? { 'content-encoding': 'gzip' } : {}) });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

const fileCache = new Map();
async function packFile(file) {
  const st = await stat(file);
  if (st.isDirectory()) return { dir: true };
  const hit = fileCache.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.packed;
  const packed = packBody(await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  fileCache.set(file, { mtime: st.mtimeMs, size: st.size, packed });
  return packed;
}

// an uploaded file as it came, for routes that take a document rather than JSON
export async function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, `That file is larger than ${Math.round(limit / 1048576)} MB.`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export async function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'Request body too large'));
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// mount point agnostic: works at /, /<host>/<name>/ (phos path mode) or a stripped prefix
export function splitPath(rawUrl, basePath = '') {
  const url = new URL(rawUrl, 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
  const api = path.indexOf('/api/');
  if (api >= 0) return { api: path.slice(api + 4), query: url.searchParams, prefix: path.slice(0, api) };
  if (path.endsWith('/api')) return { api: '/', query: url.searchParams, prefix: path.slice(0, -4) };
  return { static: path, query: url.searchParams };
}

export async function serveStatic(res, webDir, path, rawUrl) {
  const segs = path.split('/').filter(Boolean);
  // try progressively shorter suffixes so unknown mount prefixes still resolve
  for (let i = 0; i <= segs.length; i++) {
    const rel = segs.slice(i).join('/');
    if (!rel && segs.length && !path.endsWith('/')) {
      res.writeHead(302, { location: `${segs[segs.length - 1]}/${new URL(rawUrl, 'http://x').search}` });
      return res.end();
    }
    const file = normalize(join(webDir, rel || 'index.html'));
    if (!file.startsWith(webDir)) continue;
    try {
      const packed = await packFile(file);
      if (packed.dir) {
        if (!path.endsWith('/')) {
          const last = segs[segs.length - 1] ?? '';
          res.writeHead(302, { location: `${last}/` });
          return res.end();
        }
        return sendPacked(res, await packFile(join(file, 'index.html')));
      }
      return sendPacked(res, packed);
    } catch {
      /* try next suffix */
    }
  }
  // unknown extensionless path: treat as the app root, fixing relative urls with a slash
  if (!extname(path) && !path.endsWith('/')) {
    const last = path.split('/').filter(Boolean).pop() ?? '';
    res.writeHead(302, { location: `${last}/${new URL(rawUrl, 'http://x').search}` });
    return res.end();
  }
  if (!extname(path)) return sendPacked(res, await packFile(join(webDir, 'index.html')));
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}
