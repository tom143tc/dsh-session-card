// butler：独立 Electron 主进程，只负责「开窗 + 载入宿主公开 URL」。
// 第三方插件拿不到 desktop 的私有 IPC，所以窗口由本进程自己创建，
// 通过 127.0.0.1 上的一次性 token 与宿主通信。
//
// 能力边界（P3）：
//   1) 窗口位置/尺寸记忆：<info 目录>/window-state.json（0600），按 sessionId 存；
//   2) 拖回主窗即收回：/open 时带上主窗矩形，用户把窗口中心拖进主窗区域后自动关闭；
//   3) /move 路由：给宿主/自动化一个可验证的移动入口。
const { app, BrowserWindow, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DSH_BUTLER_TOKEN || '';
const BASE = process.env.DSH_BUTLER_URL || '';
const INFO = process.env.DSH_BUTLER_INFO || '';
const STATE_FILE = path.join(path.dirname(INFO || '/tmp/dsh-session-cards-fallback.json'), 'window-state.json');
const MAX_WINDOWS = 8;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 420;

const wins = new Map();
const bySession = new Map();
let seq = 0;
let state = {};
let saveTimer = null;

function baseUrl() {
  return String(BASE || '').replace(/#.*$/, '');
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function persistStateSoon() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
    } catch {}
  }, 350);
}

function clampBounds(bounds) {
  const width = Math.max(MIN_WIDTH, Math.round(bounds.width || 920));
  const height = Math.max(MIN_HEIGHT, Math.round(bounds.height || 680));
  const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x || 0), y: Math.round(bounds.y || 0) });
  const area = display.workArea;
  const x = Math.min(Math.max(Math.round(bounds.x), area.x + 12), area.x + area.width - width - 12);
  const y = Math.min(Math.max(Math.round(bounds.y), area.y + 12), area.y + area.height - height - 12);
  return { x, y, width, height };
}

function visibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const ix = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const iy = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return ix >= 120 && iy >= 80;
  });
}

function overlapsExisting(bounds) {
  for (const win of wins.values()) {
    if (win.isDestroyed()) continue;
    const b = win.getBounds();
    if (Math.abs(b.x - bounds.x) < 10 && Math.abs(b.y - bounds.y) < 10) return true;
  }
  return false;
}

function placementFor(sessionId, x, y) {
  const saved = state[sessionId];
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const fallback = state.__defaultSize || {};
    const wanted = {
      x: saved.x,
      y: saved.y,
      width: saved.width || fallback.width || DEFAULT_WIDTH,
      height: saved.height || fallback.height || DEFAULT_HEIGHT,
    };
    if (visibleOnSomeDisplay(wanted)) return clampBounds(wanted);
  }
  // 默认落在指针右侧，避免整块盖住主窗；多开时依次错开，形成卡片层。
  const point = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  const fallback = state.__defaultSize || {};
  let bounds = clampBounds({
    x: point.x + 24,
    y: point.y - 24,
    width: fallback.width || DEFAULT_WIDTH,
    height: fallback.height || DEFAULT_HEIGHT,
  });
  let guard = 0;
  while (overlapsExisting(bounds) && guard < 8) {
    bounds = clampBounds({ ...bounds, x: bounds.x + 28, y: bounds.y + 28 });
    guard += 1;
  }
  return bounds;
}

function rememberBounds(win) {
  try {
    if (!win.__dshSessionId || win.isDestroyed()) return;
    const bounds = win.getBounds();
    state[win.__dshSessionId] = bounds;
    // 记下「最近一次用户调整过的窗口尺寸」，作为新窗口的默认尺寸。
    if (win.__userSized !== false) state.__defaultSize = { width: bounds.width, height: bounds.height };
    persistStateSoon();
  } catch {}
}

function normalizeRect(value) {
  if (!value) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

// 拖回主窗即收回：只在用户拖动结束（moved）后判定，窗口中心进入主窗矩形就关闭。
function maybeRetract(win) {
  try {
    if (win.isDestroyed() || !win.__mainRect) return;
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const r = win.__mainRect;
    if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
      rememberBounds(win);
      win.close();
    }
  } catch {}
}

function openWindow(sessionId, x, y, mainRect) {
  const existing = bySession.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    try {
      existing.show();
      existing.focus();
      if (existing.moveTop) existing.moveTop();
    } catch {}
    return { id: existing.__dshWindowId, reused: true };
  }
  if (wins.size >= MAX_WINDOWS) {
    return { id: null, error: `too many floating windows (max ${MAX_WINDOWS})` };
  }

  const bounds = placementFor(sessionId, x, y);
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#101014',
    // 原生标题栏：窗口可拖动是硬要求（session-popout 用 hiddenInset 导致拖不动）。
    titleBarStyle: 'default',
    title: 'DSH 会话卡片',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false },
  });

  const id = ++seq;
  win.__dshWindowId = id;
  win.__dshSessionId = sessionId;
  win.__alwaysOnTop = false;
  win.__mainRect = mainRect;
  wins.set(id, win);
  bySession.set(sessionId, win);

  win.loadURL(`${baseUrl()}#dsh-card=${encodeURIComponent(sessionId)}`);

  win.once('ready-to-show', () => {
    win.show();
    // 默认不置顶：卡片应该能放在 desktop 旁边同时看，而不是永远盖住它。
    try {
      win.setAlwaysOnTop(Boolean(win.__alwaysOnTop), 'floating');
    } catch {}
    try {
      if (app.focus) app.focus({ steal: true });
    } catch {}
    try {
      win.focus();
      if (win.moveTop) win.moveTop();
    } catch {}
  });
  win.on('page-title-updated', (event, title) => {
    try {
      event.preventDefault();
      win.setTitle(title ? `DSH · ${title}` : 'DSH 会话卡片');
    } catch {}
  });
  // 只有「用户真的拖动过」才允许拖回收回；打开/定位时的 moved 不能触发，
  // 否则卡片位置本来就落在主窗范围内，窗口会刚出现就被自己关掉。
  win.__createdAt = Date.now();
  win.__retractArmed = false;
  win.on('will-move', () => {
    win.__retractArmed = true;
  });
  win.on('moved', () => {
    rememberBounds(win);
    if (!win.__retractArmed) return;
    if (Date.now() - (win.__createdAt || 0) < 900) return;
    setTimeout(() => maybeRetract(win), 140);
  });
  win.on('resized', () => rememberBounds(win));
  win.on('closed', () => {
    rememberBounds(win);
    wins.delete(id);
    if (bySession.get(sessionId) === win) bySession.delete(sessionId);
  });

  return { id, reused: false };
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

app.whenReady().then(() => {
  state = loadState();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const server = http.createServer((req, res) => {
    let u;
    try {
      u = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    if (!TOKEN || u.searchParams.get('token') !== TOKEN) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    const p = u.pathname;

    if (p === '/health') {
      json(res, 200, {
        ok: true,
        windows: [...wins.entries()].map(([id, win]) => ({
          id,
          sessionId: win.__dshSessionId || null,
          movable: win.isMovable(),
          resizable: win.isResizable(),
          alwaysOnTop: win.isAlwaysOnTop(),
          bounds: win.getBounds(),
          armed: !!win.__retractArmed,
          mainRect: win.__mainRect || null,
        })),
      });
      return;
    }

    if (p === '/open') {
      const sessionId = u.searchParams.get('sessionId') || '';
      if (!sessionId) {
        json(res, 400, { error: 'sessionId is required' });
        return;
      }
      const mainRect = normalizeRect({
        x: u.searchParams.get('mx'),
        y: u.searchParams.get('my'),
        width: u.searchParams.get('mw'),
        height: u.searchParams.get('mh'),
      });
      try {
        const opened = openWindow(sessionId, Number(u.searchParams.get('x')), Number(u.searchParams.get('y')), mainRect);
        if (!opened || !opened.id) {
          json(res, 429, { ok: false, error: (opened && opened.error) || 'open failed' });
          return;
        }
        json(res, 200, { ok: true, windowId: opened.id, reused: opened.reused });
      } catch (error) {
        json(res, 500, { error: String(error && error.message ? error.message : error) });
      }
      return;
    }

    if (p === '/move') {
      const id = Number(u.searchParams.get('windowId'));
      const win = wins.get(id);
      if (!win) {
        json(res, 404, { error: 'window not found' });
        return;
      }
      const x = Number(u.searchParams.get('x'));
      const y = Number(u.searchParams.get('y'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        json(res, 400, { error: 'x/y required' });
        return;
      }
      if (u.searchParams.get('arm') === '1') {
        win.__retractArmed = true;
        win.__createdAt = 0;
      }
      win.setPosition(Math.round(x), Math.round(y));
      rememberBounds(win);
      json(res, 200, { ok: true, bounds: win.getBounds() });
      return;
    }

    if (p === '/top') {
      const sessionId = u.searchParams.get('sessionId');
      const id = Number(u.searchParams.get('windowId'));
      const win = sessionId ? bySession.get(sessionId) : wins.get(id);
      if (!win || win.isDestroyed()) {
        json(res, 404, { error: 'window not found' });
        return;
      }
      const on = u.searchParams.get('on') === '1';
      win.__alwaysOnTop = on;
      try {
        win.setAlwaysOnTop(on, 'floating');
        if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
      } catch (error) {
        json(res, 500, { error: String(error && error.message ? error.message : error) });
        return;
      }
      json(res, 200, { ok: true, on });
      return;
    }

    if (p === '/close') {
      const sessionId = u.searchParams.get('sessionId');
      const id = Number(u.searchParams.get('windowId'));
      const win = sessionId ? bySession.get(sessionId) : wins.get(id);
      if (win) win.close();
      json(res, 200, { ok: Boolean(win) });
      return;
    }

    json(res, 404, { error: 'not found' });
  });

  server.on('error', (error) => {
    try {
      fs.appendFileSync(path.join(path.dirname(INFO), 'butler-error.log'), String(error) + '\n');
    } catch {}
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    try {
      fs.writeFileSync(INFO, JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    } catch (error) {
      try {
        fs.appendFileSync('/tmp/dsh-session-cards-butler-error.log', String(error) + '\n');
      } catch {}
    }
  });
});

// 宿主退出后自动收摊：父进程消失就退出，避免常驻孤儿进程。
const PARENT_PID = Number(process.env.DSH_BUTLER_PARENT || 0);
if (PARENT_PID > 0) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      app.quit();
    }
  }, 5000).unref();
}

app.on('window-all-closed', () => {
  // 管家常驻；由宿主显式 /shutdown 或进程被杀结束。
});
