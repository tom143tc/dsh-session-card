/**
 * layout.js — 布局纯函数（无 DOM、无宿主依赖，可在 node 与浏览器共用）
 *
 * 两套形态：
 *   grid   —— 自由网格：340×180 基准，按容器 fit；放不下时改为纵向滚动（用户 2026-11-03 拍板）。
 *   matrix —— 宫格墙：均分画布，3×3（≤9 张）/ 3×4（10–12 张），窄画布退 2 列；铺满不滚动。
 *
 * 纪律：所有几何计算集中在这里，渲染层只消费返回值；不要在各处重复算一遍。
 */

export const GRID = Object.freeze({
  cardW: 340,
  cardH: 180,
  gap: 16,
  pad: 20,
  minW: 240,
  minH: 150,
  comfortW: 280,
  comfortH: 170,
});

/** 数据层硬上限（产品约束，别在别处再写一遍）。 */
export const MAX_CARDS = 12;

/** 宫格形态的窄画布阈值：宽度小于它就从 3 列退 2 列。 */
export const MATRIX_NARROW_W = 720;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(v)));

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 自由网格：先尝试一屏放下（fit），放不下退纵向滚动（scroll）。
 *
 * @param {number} W 画布宽度（px）
 * @param {number} H 画布高度（px）
 * @param {number} n 卡片数
 * @param {Partial<typeof GRID>} [opts]
 * @returns {{mode:'fit'|'scroll', cols:number, rows:number, cellW:number, cellH:number, contentW:number, contentH:number}}
 */
export function fitGrid(W, H, n, opts = {}) {
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
    throw new RangeError(`fitGrid: invalid canvas size ${W}x${H}`);
  }
  const g = { ...GRID, ...opts };
  const count = clampInt(n, 0, MAX_CARDS);

  let best = null;
  for (let cols = 2; cols <= 4; cols++) {
    const rows = Math.max(1, Math.ceil(count / cols));
    const cellW = (W - 2 * g.pad - (cols - 1) * g.gap) / cols;
    const cellH = (H - 2 * g.pad - (rows - 1) * g.gap) / rows;
    if (cellW >= g.minW && cellH >= g.minH) {
      const area = cellW * cellH;
      if (!best || area > best.area) best = { area, cols, rows, cellW, cellH };
    }
  }
  if (best) {
    return {
      mode: 'fit',
      cols: best.cols,
      rows: best.rows,
      cellW: round2(best.cellW),
      cellH: round2(best.cellH),
      contentW: W,
      contentH: H,
    };
  }

  // scroll：保住舒适尺寸，画布内出现唯一纵向滚动容器
  const usable = W - 2 * g.pad;
  const maxCols = Math.max(2, Math.floor((usable + g.gap) / (g.comfortW + g.gap)) || 2);
  const cols = Math.min(4, maxCols);
  const rows = Math.max(1, Math.ceil(count / cols));
  const contentH = rows * (g.comfortH + g.gap) - g.gap + 2 * g.pad;
  return {
    mode: 'scroll',
    cols,
    rows,
    cellW: g.comfortW,
    cellH: g.comfortH,
    contentW: W,
    contentH: Math.max(H, contentH),
  };
}

/**
 * 宫格墙：均分画布的行列数。
 * ≤9 张 → 3×3；10–12 张 → 3×4；宽 < MATRIX_NARROW_W → 2 列（2×5 / 2×6）。
 */
export function matrixDims(n, W) {
  const count = clampInt(n, 0, MAX_CARDS);
  if (count === 0) return { cols: 2, rows: 1 };
  const narrow = Number.isFinite(W) && W < MATRIX_NARROW_W;
  const cols = narrow ? 2 : 3;
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** 把坐标 clamp 在内容区里，保证卡片永不越界。 */
export function clampPos(x, y, w, h, contentW, contentH) {
  const maxX = Math.max(0, contentW - w);
  const maxY = Math.max(0, contentH - h);
  return {
    x: round2(Math.max(0, Math.min(maxX, Number.isFinite(x) ? x : 0))),
    y: round2(Math.max(0, Math.min(maxY, Number.isFinite(y) ? y : 0))),
  };
}

/** 交换数组中的两个位置（返回新数组，不改原数组）。 */
export function swapItems(list, i, j) {
  if (!Array.isArray(list)) throw new TypeError('swapItems: list must be an array');
  if (i === j) return list.slice();
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list.slice();
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * 一键自动排列：只改顺序，不改卡片状态。
 * @param {Array<{id:string, running?:boolean, updatedAt?:number, customOrder?:number}>} cards
 * @param {'recent'|'running'|'custom'} strategy
 */
export function arrangeCards(cards, strategy) {
  if (!Array.isArray(cards)) throw new TypeError('arrangeCards: cards must be an array');
  const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const copy = cards.slice();
  if (strategy === 'recent') return copy.sort(byRecent);
  if (strategy === 'running') {
    return copy.sort((a, b) => Number(!!b.running) - Number(!!a.running) || byRecent(a, b));
  }
  if (strategy === 'custom') {
    return copy.sort((a, b) => (a.customOrder ?? 1e9) - (b.customOrder ?? 1e9) || byRecent(a, b));
  }
  throw new RangeError(`arrangeCards: unknown strategy ${strategy}`);
}

export function planRows(cards, cols) {
  const c = Math.max(1, Math.floor(cols) || 1);
  const used = [];
  const free = (r, col, w, h) => {
    for (let i = 0; i < h; i += 1) {
      for (let j = 0; j < w; j += 1) {
        if (!used[r + i]) used[r + i] = [];
        if (used[r + i][col + j]) return false;
      }
    }
    return true;
  };
  const mark = (r, col, w, h) => {
    for (let i = 0; i < h; i += 1) {
      if (!used[r + i]) used[r + i] = [];
      for (let j = 0; j < w; j += 1) used[r + i][col + j] = true;
    }
  };
  let rows = 0;
  for (const card of cards) {
    const w = Math.min(c, Math.max(1, Math.floor(card.cols || 1)));
    const h = Math.min(4, Math.max(1, Math.floor(card.rows || 1)));
    let placed = false;
    for (let r = 0; !placed; r += 1) {
      for (let col = 0; col + w <= c; col += 1) {
        if (free(r, col, w, h)) {
          mark(r, col, w, h);
          rows = Math.max(rows, r + h);
          placed = true;
          break;
        }
      }
    }
  }
  return Math.max(1, rows);
}
