/**
 * dsh-session-cards · 宿主半侧（Host half）
 *
 * P0 只做一件事：提供一个受鉴权保护的 /prompt 路由，让卡片里的输入框能把消息
 * 发到「这张卡对应的会话」，而不需要先切换当前会话。
 *
 * 纪律（照抄 dsh-multi-session 的成熟做法）：
 *   1. 路由注册发生在鉴权之前，必须自己调 connection.requestRejection；
 *   2. 只接受 POST；
 *   3. 任何异常都不许冒泡到宿主（launcher 以 entry 是否 activate 判定启动成败）；
 *   4. 真正的 admission 走 sessionController（Host 侧唯一入口），本插件不自己拼事件。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'dsh-session-cards';
const PROMPT_ROUTE = '/plugins/dsh-session-cards/prompt';
const PROMPT_TIMEOUT_MS = 20_000;
const MAX_BODY = 256 * 1024;
const POPOUT_ROUTE = '/plugins/dsh-session-cards/popout';
const BUTLER_DIR = path.join(homedir(), '.dsh', 'dsh-session-cards');
const BUTLER_BOOT_TIMEOUT_MS = 10_000;
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));

function electronBinary() {
  if (process.env.DSH_CARDS_ELECTRON) return process.env.DSH_CARDS_ELECTRON;
  const base = path.join(homedir(), '.dsh', 'electron');
  if (process.platform === 'darwin') return path.join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  if (process.platform === 'win32') return path.join(base, 'electron.exe');
  return path.join(base, 'electron');
}

function readButlerInfo(infoPath) {
  try {
    const info = JSON.parse(readFileSync(infoPath, 'utf8'));
    if (!info || typeof info.port !== 'number' || typeof info.pid !== 'number') return null;
    return info;
  } catch {
    return null;
  }
}

async function butlerCall(info, route, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `http://127.0.0.1:${info.port}${route}${route.includes('?') ? '&' : '?'}token=${encodeURIComponent(info.token)}`;
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 确保「窗口管家」存在：自建 Electron 主进程，只通过公开的 webServer/connection 与宿主通信。
 * 不使用 desktopRuntime / preload / IPC 等私有能力。
 */
let ensurePending = null;

function butlerInfoPath(origin) {
  const digest = crypto.createHash('sha1').update(String(origin)).digest('hex').slice(0, 10);
  return path.join(BUTLER_DIR, `butler-${digest}.json`);
}

async function ensureButler(webServer, connection) {
  if (ensurePending) return ensurePending;
  ensurePending = ensureButlerUnlocked(webServer, connection).finally(() => {
    ensurePending = null;
  });
  return ensurePending;
}

async function ensureButlerUnlocked(webServer, connection) {
  const binary = electronBinary();
  if (!existsSync(binary)) {
    const error = new Error(`butler electron not found: ${binary}`);
    error.code = 'NO_ELECTRON';
    throw error;
  }
  mkdirSync(BUTLER_DIR, { recursive: true });
  const origin = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : '';
  if (!origin) throw new Error('webServer.getOrigin unavailable');
  const infoPath = butlerInfoPath(origin);

  let info = readButlerInfo(infoPath);
  if (info) {
    const health = await butlerCall(info, '/health').catch(() => null);
    if (health && health.ok) return info;
    info = null;
  }

  const token = crypto.randomBytes(16).toString('hex');
  const url = connection && typeof connection.authenticatedUrl === 'function'
    ? connection.authenticatedUrl(`${origin}/`)
    : `${origin}/`;

  const env = { ...process.env, DSH_BUTLER_TOKEN: token, DSH_BUTLER_URL: url, DSH_BUTLER_INFO: infoPath, DSH_BUTLER_PARENT: String(process.pid) };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(binary, [path.join(PLUGIN_ROOT, 'popout', 'main.cjs')], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();

  const deadline = Date.now() + BUTLER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = readButlerInfo(infoPath);
    if (!next) continue;
    const withToken = { ...next, token };
    const health = await butlerCall(withToken, '/health').catch(() => null);
    if (health && health.ok) {
      writeFileSync(infoPath, JSON.stringify({ ...withToken }), { mode: 0o600 });
      return withToken;
    }
  }
  const error = new Error('butler did not become ready');
  error.code = 'BUTLER_TIMEOUT';
  throw error;
}

export const name = PLUGIN_ID;
export const inject = ['webServer', 'connection'];

function sendJson(res, status, body, extraHeaders = {}) {
  try {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    });
    res.end(payload);
  } catch {
    try {
      res.destroy();
    } catch {
      /* 已断开就算了 */
    }
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  const get = (key) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(key) : undefined;
    } catch {
      return undefined;
    }
  };
  if (!webServer) return;

  const authed = (req, res) => {
    const connection = get('connection');
    const rejection = connection === undefined ? 503 : connection.requestRejection(req);
    if (rejection !== undefined) {
      sendJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden',
      });
      return false;
    }
    return true;
  };

  // 对话记录：卡片正文用它渲染「对话最后的记录」。
  const toText = (parts) => {
    if (!Array.isArray(parts)) return '';
    return parts
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
  };
  const shorten = (v, n) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  const contextMarker = /(Current runtime context|Time sampled while|The available skill catalog|\[Compressed conversation|Browser time zone|MNEMON RUNTIME MEMORY|MNEMON VIEW TOOLS|\[MNEMON\]|runtime-memory-file|working reference|background job|Your task is to|<available_skills>|system-reminder)/i;
  const cleanUserText = (raw) => {
    const text = String(raw).trim();
    if (contextMarker.test(text) && text.length < 1200) return '';
    const parts = text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    const keep = parts.filter((p) => !contextMarker.test(p));
    if (keep.length === 0) return '';
    return keep.slice(-2).join('\n\n');
  };
  const toBlocks = (events) => {
    const out = [];
    for (const e of events) {
      const d = e && e.data ? e.data : null;
      if (!d) continue;
      if (e.type === 'user/message') {
        const raw = toText(d.content);
        const clean = raw ? cleanUserText(raw) : '';
        if (clean) out.push({ role: 'user', text: clean, at: e.time || 0 });
      } else if (e.type === 'assistant/message') {
        const text = toText(d.message && d.message.content);
        if (text) out.push({ role: 'assistant', text, at: e.time || 0 });
      } else if (e.type === 'tool/call') {
        out.push({ role: 'tool', text: `${d.name || 'tool'} ${shorten(d.arguments, 120)}`, at: e.time || 0 });
      }
    }
    return out;
  };
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-cards/transcript',
      async handler(req, res) {
        try {
          if (!authed(req, res)) return;
          const url = new URL(String(req.url ?? ''), 'http://127.0.0.1');
          const sessionId = url.searchParams.get('sessionId') || '';
          const limit = Math.max(1, Math.min(40, Number(url.searchParams.get('limit')) || 14));
          const sq = get('sessionQuery');
          if (!sq || typeof sq.readSession !== 'function') {
            sendJson(res, 503, { error: 'sessionQuery unavailable' });
            return;
          }
          const log = await sq.readSession(sessionId);
          const events = Array.isArray(log?.events) ? log.events : [];
          const blocks = toBlocks(events);
          sendJson(res, 200, { ok: true, total: blocks.length, blocks: blocks.slice(-limit) });
        } catch (error) {
          sendJson(res, 500, { error: String(error?.message ?? error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: POPOUT_ROUTE,
      async handler(req, res) {
        try {
          const method = String(req.method ?? 'GET').toUpperCase();
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
            return;
          }
          const connection = get('connection');
          const rejection = connection === undefined ? 503 : connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden' });
            return;
          }
          let body;
          try {
            body = JSON.parse(await readBody(req, MAX_BODY));
          } catch {
            sendJson(res, 400, { error: 'bad json body' });
            return;
          }
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
          if (sessionId === '') {
            sendJson(res, 400, { error: 'sessionId is required' });
            return;
          }
          const x = Number.isFinite(body?.x) ? Math.round(body.x) : 0;
          const y = Number.isFinite(body?.y) ? Math.round(body.y) : 0;
          let info;
          try {
            info = await ensureButler(webServer, connection);
          } catch (error) {
            const code = error?.code === 'NO_ELECTRON' ? 501 : 503;
            sendJson(res, code, { error: String(error?.message ?? error), code: error?.code ?? 'BUTLER_FAILED' });
            return;
          }
          const rect = body && body.mainRect && typeof body.mainRect === 'object' ? body.mainRect : null;
          const rectQuery = rect
            ? `&mx=${Math.round(Number(rect.x) || 0)}&my=${Math.round(Number(rect.y) || 0)}&mw=${Math.round(Number(rect.width) || 0)}&mh=${Math.round(Number(rect.height) || 0)}`
            : '';
          const opened = await butlerCall(info, `/open?sessionId=${encodeURIComponent(sessionId)}&x=${x}&y=${y}${rectQuery}`);
          sendJson(res, opened.ok ? 200 : 502, opened.ok ? { ok: true, windowId: opened.body?.windowId ?? null } : { error: 'butler open failed', detail: opened.body });
        } catch (error) {
          try {
            const logPath = path.join(BUTLER_DIR, 'popout-error.log');
            mkdirSync(BUTLER_DIR, { recursive: true });
            appendFileSync(logPath, `${new Date().toISOString()} ${String(error?.stack ?? error)}\n`);
          } catch {}
          sendJson(res, 500, { error: String(error?.message ?? error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-cards/popout/list',
      async handler(req, res) {
        try {
          const method = String(req.method ?? 'GET').toUpperCase();
          if (method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' });
            return;
          }
          const connection = get('connection');
          const rejection = connection === undefined ? 503 : connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : 'unauthorized' });
            return;
          }
          const info = readButlerInfo(butlerInfoPath(typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : ''));
          if (!info) {
            sendJson(res, 200, { ok: true, sessions: [] });
            return;
          }
          const health = await butlerCall(info, '/health').catch(() => null);
          if (!health || !health.ok) {
            sendJson(res, 200, { ok: true, sessions: [] });
            return;
          }
          const sessions = (health.body?.windows ?? []).map((w) => w.sessionId).filter(Boolean);
          sendJson(res, 200, { ok: true, sessions });
        } catch (error) {
          sendJson(res, 200, { ok: true, sessions: [], warning: String(error?.message ?? error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-cards/popout/top',
      async handler(req, res) {
        try {
          const method = String(req.method ?? 'GET').toUpperCase();
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
            return;
          }
          const connection = get('connection');
          const rejection = connection === undefined ? 503 : connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden' });
            return;
          }
          let body;
          try {
            body = JSON.parse(await readBody(req, MAX_BODY));
          } catch {
            sendJson(res, 400, { error: 'bad json body' });
            return;
          }
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
          if (sessionId === '') {
            sendJson(res, 400, { error: 'sessionId is required' });
            return;
          }
          const on = body?.on === true;
          let info;
          try {
            info = await ensureButler(webServer, connection);
          } catch (error) {
            sendJson(res, 503, { error: String(error?.message ?? error) });
            return;
          }
          const result = await butlerCall(info, `/top?sessionId=${encodeURIComponent(sessionId)}&on=${on ? '1' : '0'}`);
          sendJson(res, result.ok ? 200 : 502, result.ok ? { ok: true, on: result.body?.on === true } : { error: 'butler top failed', detail: result.body });
        } catch (error) {
          sendJson(res, 500, { error: String(error?.message ?? error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-session-cards/popout/close',
      async handler(req, res) {
        try {
          const method = String(req.method ?? 'GET').toUpperCase();
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
            return;
          }
          const connection = get('connection');
          const rejection = connection === undefined ? 503 : connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable' : rejection === 401 ? 'unauthorized' : 'forbidden' });
            return;
          }
          let body;
          try {
            body = JSON.parse(await readBody(req, MAX_BODY));
          } catch {
            sendJson(res, 400, { error: 'bad json body' });
            return;
          }
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
          if (sessionId === '') {
            sendJson(res, 400, { error: 'sessionId is required' });
            return;
          }
          let info;
          try {
            info = await ensureButler(webServer, connection);
          } catch (error) {
            sendJson(res, 503, { error: String(error?.message ?? error) });
            return;
          }
          const closed = await butlerCall(info, `/close?sessionId=${encodeURIComponent(sessionId)}`);
          sendJson(res, closed.ok ? 200 : 502, closed.ok ? { ok: true, closed: closed.body?.ok === true } : { error: 'butler close failed', detail: closed.body });
        } catch (error) {
          try {
            const logPath = path.join(BUTLER_DIR, 'popout-error.log');
            mkdirSync(BUTLER_DIR, { recursive: true });
            appendFileSync(logPath, `${new Date().toISOString()} ${String(error?.stack ?? error)}\n`);
          } catch {}
          sendJson(res, 500, { error: String(error?.message ?? error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: PROMPT_ROUTE,
      async handler(req, res) {
        try {
          const method = String(req.method ?? 'GET').toUpperCase();
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
            return;
          }

          const connection = get('connection');
          const rejection = connection === undefined ? 503 : connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, {
              error:
                rejection === 503
                  ? 'authentication unavailable'
                  : rejection === 401
                    ? 'unauthorized'
                    : 'forbidden',
            });
            return;
          }

          let body;
          try {
            body = JSON.parse(await readBody(req, MAX_BODY));
          } catch {
            sendJson(res, 400, { error: 'bad json body' });
            return;
          }

          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
          const text = typeof body?.text === 'string' ? body.text : '';
          if (sessionId === '') {
            sendJson(res, 400, { error: 'sessionId is required' });
            return;
          }
          if (text.trim() === '') {
            sendJson(res, 400, { error: 'text is required' });
            return;
          }

          const sessionController = get('sessionController');
          if (sessionController === undefined || typeof sessionController.prompt !== 'function') {
            sendJson(res, 503, { error: 'sessionController.prompt unavailable' });
            return;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
          try {
            const value = await sessionController.prompt(
              {
                requestId: `${PLUGIN_ID}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                sessionId,
                mode: body?.mode === 'steer' ? 'steer' : 'queue',
                content: [{ type: 'text', text }],
              },
              controller.signal,
            );
            sendJson(res, 200, { ok: true, sessionId, accepted: value?.accepted === true });
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) });
        }
      },
    }),
  );
}
