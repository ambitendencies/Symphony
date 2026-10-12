/**
 * Cosmic Radio live-data Worker.
 *
 * - Cron (every 2 minutes): fetch NOAA SWPC plasma + mag 1-day products,
 *   validate, merge to 10-minute bins (src/parse.ts) and store
 *   `solar-wind.json` in R2 (binding DATA) and/or KV (binding KV).
 *   If upstream fails or the schema changed, the last good copy is kept.
 * - Fetch: serves `/solar-wind.json` with CORS and cache headers, and
 *   `/status.json` with the last refresh result.
 *
 * Minimal binding types are declared here so the Worker needs nothing
 * beyond wrangler to build.
 */

import { mergeSolarWind, SchemaError } from './parse';

interface R2ObjectBody {
  text(): Promise<string>;
  httpEtag: string;
  uploaded: Date;
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface Env {
  DATA?: R2Bucket;
  KV?: KVNamespace;
  /** Override for tests / mirrors. */
  SWPC_BASE?: string;
}

export const SWPC_BASE = 'https://services.swpc.noaa.gov/products/solar-wind/';
export const OBJECT_KEY = 'solar-wind.json';
const STATUS_KEY = 'status.json';
const FETCH_TIMEOUT_MS = 15_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Max-Age': '86400',
};

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'cosmic-radio-worker (+https://github.com/)' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function store(env: Env, key: string, body: string): Promise<void> {
  const writes: Promise<unknown>[] = [];
  if (env.DATA) writes.push(env.DATA.put(key, body, { httpMetadata: { contentType: 'application/json' } }));
  if (env.KV) writes.push(env.KV.put(key, body));
  if (!writes.length) throw new Error('no storage binding (DATA or KV) configured');
  await Promise.all(writes);
}

async function load(env: Env, key: string): Promise<string | null> {
  if (env.DATA) {
    const obj = await env.DATA.get(key);
    if (obj) return obj.text();
  }
  if (env.KV) return env.KV.get(key);
  return null;
}

/** One refresh: returns the stored doc's latest time, or throws (the last good copy stays). */
export async function refresh(env: Env, now = Date.now()): Promise<string> {
  const base = env.SWPC_BASE ?? SWPC_BASE;
  const [plasma, mag] = await Promise.all([getJson(`${base}plasma-1-day.json`), getJson(`${base}mag-1-day.json`)]);
  const doc = mergeSolarWind(plasma, mag, now);
  await store(env, OBJECT_KEY, JSON.stringify(doc));
  return doc.series[doc.series.length - 1].time;
}

async function recordStatus(env: Env, status: Record<string, unknown>): Promise<void> {
  try {
    await store(env, STATUS_KEY, JSON.stringify(status));
  } catch (e) {
    console.error('status write failed', e);
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const at = new Date(controller.scheduledTime).toISOString();
    ctx.waitUntil(
      refresh(env, controller.scheduledTime)
        .then((latest) => recordStatus(env, { ok: true, at, latest }))
        .catch((e: unknown) => {
          const kind = e instanceof SchemaError ? 'schema' : 'upstream';
          console.error(`solar wind refresh failed (${kind}); keeping last good copy:`, e);
          return recordStatus(env, { ok: false, at, kind, error: String((e as Error)?.message ?? e) });
        }),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: CORS });
    const path = new URL(request.url).pathname.replace(/^\/+/, '');
    if (path !== OBJECT_KEY && path !== STATUS_KEY) return new Response('Not found', { status: 404, headers: CORS });
    const body = await load(env, path);
    if (body === null) return new Response('Not yet available', { status: 503, headers: { ...CORS, 'Retry-After': '120' } });
    const etag = `"${await digest(body)}"`;
    const headers = {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      // Fresh data every 2 minutes; browsers and the edge may serve a slightly stale copy while revalidating.
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
      ETag: etag,
    };
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  },
};

async function digest(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
