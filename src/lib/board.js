/**
 * board.js — 卡片桌布的状态模型（纯函数）
 *
 * 设计约束：
 *   - 数据自持：board.json 由插件写在自己目录，不依赖宿主存储；
 *   - 上限 12 张，数据层硬限制（不是渲染层的禁用）；
 *   - 读坏数据不崩：任何解析失败都退回空桌布并带 warning，绝不把异常抛给宿主。
 */

import { MAX_CARDS } from './layout.js';

export const BOARD_VERSION = 1;
export const FORMS = Object.freeze(['grid', 'matrix', 'free']);
export const SPAN_MIN = 1;
export const SPAN_MAX = 4;

const isStr = (v) => typeof v === 'string' && v.length > 0;
export const RECT_MIN_W = 220;
export const RECT_MIN_H = 140;

export function normalizeRect(v) {
  const n = (x, d) => {
    const num = Math.round(Number(x));
    return Number.isFinite(num) ? num : d;
  };
  return {
    x: Math.max(0, n(v && v.x, 0)),
    y: Math.max(0, n(v && v.y, 0)),
    w: Math.max(RECT_MIN_W, n(v && v.w, 320)),
    h: Math.max(RECT_MIN_H, n(v && v.h, 180)),
  };
}

const clampSpan = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return SPAN_MIN;
  return Math.min(SPAN_MAX, Math.max(SPAN_MIN, n));
};

/** 空白桌布。 */
export function emptyBoard(now = 0) {
  return { version: BOARD_VERSION, form: 'grid', cards: [], maximizedId: null, updatedAt: now };
}

/** 卡片最小合法形状；缺字段的旧数据直接判为不合法，避免半渲染。 */
export function isValidCard(card) {
  return !!card && isStr(card.id) && isStr(card.sessionId) && typeof card.title === 'string';
}

/** 新建一张卡片（位置由布局层决定，这里只存逻辑字段）。 */
export function dominantSpan(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const counts = new Map();
  for (const c of list) {
    const key = `${clampSpan(c && c.cols)}x${clampSpan(c && c.rows)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = { cols: 1, rows: 1, count: 0 };
  for (const [key, count] of counts) {
    if (count > best.count) {
      const [cols, rows] = key.split('x').map(Number);
      best = { cols, rows, count };
    }
  }
  return { cols: best.cols, rows: best.rows, count: best.count };
}

/** 新建一张卡片（位置由布局层决定，这里只存逻辑字段）。 */
export function makeCard({ id, sessionId, title, status = 'todo', workspace = '', model = '', customOrder, cols, rows, rect }, now = Date.now()) {
  if (!isStr(id) || !isStr(sessionId) || typeof title !== 'string') {
    throw new TypeError('makeCard: id/sessionId/title required');
  }
  return {
    id,
    sessionId,
    title,
    status,
    workspace,
    model,
    customOrder: Number.isInteger(customOrder) ? customOrder : now,
    minimized: false,
    cols: clampSpan(cols),
    rows: clampSpan(rows),
    ...(rect ? { rect: normalizeRect(rect) } : {}),
  };
}

/** 加入一张卡；满 12 或重复 id 都返回 ok:false（调用方负责提示，不抛异常）。 */
export function addCard(state, card) {
  if (!isValidCard(card)) return { ok: false, reason: 'invalid-card', state };
  if (state.cards.length >= MAX_CARDS) return { ok: false, reason: 'limit', state };
  if (state.cards.some((c) => c.id === card.id)) return { ok: false, reason: 'duplicate', state };
  return {
    ok: true,
    state: { ...state, cards: [...state.cards, card], updatedAt: Math.max(state.updatedAt, 0) },
  };
}

/** 移除一张卡；不存在时返回 ok:false，状态原样返回。 */
export function removeCard(state, id) {
  const next = state.cards.filter((c) => c.id !== id);
  if (next.length === state.cards.length) return { ok: false, reason: 'not-found', state };
  return { ok: true, state: { ...state, cards: next } };
}

/** 设置卡片占用的网格跨度（拖动右下角改大小）；越界夹到 [1,4]。 */
export function setCardRect(state, id, patch) {
  const cards = (state.cards || []).map((c) => (c.id === id ? { ...c, rect: normalizeRect({ ...(c.rect || {}), ...(patch || {}) }) } : c));
  return { ...state, cards, updatedAt: Date.now() };
}

/** 自由布局下给新卡找一个不重叠的落点（向下流动）。 */
export function nextFreeRect(cards, width = 1100) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.rect);
  const w = 340;
  const h = 190;
  const gap = 16;
  const perRow = Math.max(1, Math.floor((width + gap) / (w + gap)));
  let i = 0;
  const taken = new Set(list.map((c) => `${c.rect.x},${c.rect.y}`));
  for (;;) {
    const x = (i % perRow) * (w + gap) + 16;
    const y = Math.floor(i / perRow) * (h + gap) + 16;
    if (!taken.has(`${x},${y}`)) return { x, y, w, h };
    i += 1;
    if (i > 200) return { x: 16, y: 16, w, h };
  }
}

export function setCardSpan(state, id, cols, rows) {
  const c = Math.min(SPAN_MAX, Math.max(SPAN_MIN, Math.round(Number(cols) || 1)));
  const r = Math.min(SPAN_MAX, Math.max(SPAN_MIN, Math.round(Number(rows) || 1)));
  let hit = false;
  const cards = state.cards.map((card) => {
    if (card.id !== id) return card;
    if (card.cols === c && card.rows === r) return card;
    hit = true;
    return { ...card, cols: c, rows: r };
  });
  if (!hit) return { ok: false, reason: 'no-change', state };
  return { ok: true, state: { ...state, cards, updatedAt: Date.now() } };
}

/** 切换形态（grid / matrix），别的字段不动。 */
/** 最小化 / 还原一张卡（最小化的卡从画布移到底部 dock）。 */
export function setMinimized(state, id, minimized = true) {
  let hit = false;
  const cards = state.cards.map((card) => {
    if (card.id !== id) return card;
    hit = true;
    return { ...card, minimized: !!minimized };
  });
  if (!hit) return { ok: false, reason: 'not-found', state };
  return { ok: true, state: { ...state, cards } };
}

/** 最大化一张卡（独占画布）；传 null 还原。 */
export function setMaximized(state, id) {
  if (id !== null && !state.cards.some((card) => card.id === id)) {
    return { ok: false, reason: 'not-found', state };
  }
  return { ok: true, state: { ...state, maximizedId: id } };
}

export function setForm(state, form) {
  if (!FORMS.includes(form)) return { ok: false, reason: 'bad-form', state };
  return { ok: true, state: { ...state, form } };
}

/** 把卡片顺序替换成给定 id 顺序（自动排列/拖动后调用）；未知 id 忽略。 */
export function reorder(state, ids) {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const cards = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (card && !cards.includes(card)) cards.push(card);
  }
  for (const card of state.cards) if (!cards.includes(card)) cards.push(card);
  return { ...state, cards };
}

/**
 * 解析持久化 JSON。
 * @returns {{ok:boolean, state:object, warning?:string}}
 */
export function parseBoard(text, now = 0) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, state: emptyBoard(now), warning: 'empty' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, state: emptyBoard(now), warning: 'corrupt-json' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, state: emptyBoard(now), warning: 'not-object' };
  if (raw.version !== BOARD_VERSION) {
    return { ok: false, state: emptyBoard(now), warning: `version-mismatch:${String(raw.version)}` };
  }
  const span = (v) => (Number.isInteger(v) ? Math.min(SPAN_MAX, Math.max(SPAN_MIN, v)) : 1);
  const cards = Array.isArray(raw.cards)
    ? raw.cards
        .filter(isValidCard)
        .slice(0, MAX_CARDS)
        .map((card) => ({
          ...card,
          minimized: card.minimized === true,
          cols: span(card.cols),
          rows: span(card.rows),
        }))
    : [];
  const form = FORMS.includes(raw.form) ? raw.form : 'grid';
  const maximizedId = typeof raw.maximizedId === 'string' && cards.some((card) => card.id === raw.maximizedId) ? raw.maximizedId : null;
  const dropped = Array.isArray(raw.cards) ? raw.cards.length - cards.length : 0;
  return {
    ok: true,
    state: { version: BOARD_VERSION, form, cards, maximizedId, updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now },
    ...(dropped > 0 ? { warning: `dropped:${dropped}` } : {}),
  };
}

/** 序列化（稳定字段顺序，便于 diff 与测试）。 */
export function serializeBoard(state) {
  return JSON.stringify({
    version: BOARD_VERSION,
    form: state.form,
    cards: state.cards.map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      title: c.title,
      status: c.status,
      workspace: c.workspace,
      model: c.model,
      customOrder: c.customOrder,
      minimized: c.minimized === true,
      cols: c.cols || 1,
      rows: c.rows || 1,
      ...(c.rect ? { rect: normalizeRect(c.rect) } : {}),
    })),
    maximizedId: state.maximizedId ?? null,
    updatedAt: state.updatedAt,
  });
}
