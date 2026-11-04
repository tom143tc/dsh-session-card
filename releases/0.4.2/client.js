/**
 * dsh-session-cards · 浏览器半侧（client half）
 *
 * 本文件由 scripts/build-client.mjs 生成，不要手改。
 * 源码：src/client/{ui,apply}.js + src/lib/{layout,board,caps}.js
 */

(() => {
  try {
    window.__ModuleLoader__.load({
      id: 'dsh-session-cards',
      factory(require) {
        const React = require('react');
        const h = React.createElement;

        /* ---- src/lib/layout.js ---- */
        /**
         * layout.js — 布局纯函数（无 DOM、无宿主依赖，可在 node 与浏览器共用）
         *
         * 两套形态：
         *   grid   —— 自由网格：340×180 基准，按容器 fit；放不下时改为纵向滚动（用户 2026-11-03 拍板）。
         *   matrix —— 宫格墙：均分画布，3×3（≤9 张）/ 3×4（10–12 张），窄画布退 2 列；铺满不滚动。
         *
         * 纪律：所有几何计算集中在这里，渲染层只消费返回值；不要在各处重复算一遍。
         */

        const GRID = Object.freeze({
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
        const MAX_CARDS = 12;

        /** 宫格形态的窄画布阈值：宽度小于它就从 3 列退 2 列。 */
        const MATRIX_NARROW_W = 720;

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
        function fitGrid(W, H, n, opts = {}) {
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
        function matrixDims(n, W) {
          const count = clampInt(n, 0, MAX_CARDS);
          if (count === 0) return { cols: 2, rows: 1 };
          const narrow = Number.isFinite(W) && W < MATRIX_NARROW_W;
          const cols = narrow ? 2 : 3;
          return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
        }

        /** 把坐标 clamp 在内容区里，保证卡片永不越界。 */
        function clampPos(x, y, w, h, contentW, contentH) {
          const maxX = Math.max(0, contentW - w);
          const maxY = Math.max(0, contentH - h);
          return {
            x: round2(Math.max(0, Math.min(maxX, Number.isFinite(x) ? x : 0))),
            y: round2(Math.max(0, Math.min(maxY, Number.isFinite(y) ? y : 0))),
          };
        }

        /** 交换数组中的两个位置（返回新数组，不改原数组）。 */
        function swapItems(list, i, j) {
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
        function arrangeCards(cards, strategy) {
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

        function planRows(cards, cols) {
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

        /* ---- src/lib/board.js ---- */
        /**
         * board.js — 卡片桌布的状态模型（纯函数）
         *
         * 设计约束：
         *   - 数据自持：board.json 由插件写在自己目录，不依赖宿主存储；
         *   - 上限 12 张，数据层硬限制（不是渲染层的禁用）；
         *   - 读坏数据不崩：任何解析失败都退回空桌布并带 warning，绝不把异常抛给宿主。
         */

        const BOARD_VERSION = 1;
        const FORMS = Object.freeze(['grid', 'matrix', 'free']);
        const SPAN_MIN = 1;
        const SPAN_MAX = 4;

        const isStr = (v) => typeof v === 'string' && v.length > 0;
        const RECT_MIN_W = 220;
        const RECT_MIN_H = 140;

        function normalizeRect(v) {
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
        function emptyBoard(now = 0) {
          return { version: BOARD_VERSION, form: 'grid', cards: [], maximizedId: null, updatedAt: now };
        }

        /** 卡片最小合法形状；缺字段的旧数据直接判为不合法，避免半渲染。 */
        function isValidCard(card) {
          return !!card && isStr(card.id) && isStr(card.sessionId) && typeof card.title === 'string';
        }

        /** 新建一张卡片（位置由布局层决定，这里只存逻辑字段）。 */
        function dominantSpan(cards) {
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
        function makeCard({ id, sessionId, title, status = 'todo', workspace = '', model = '', customOrder, cols, rows, rect }, now = Date.now()) {
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
        function addCard(state, card) {
          if (!isValidCard(card)) return { ok: false, reason: 'invalid-card', state };
          if (state.cards.length >= MAX_CARDS) return { ok: false, reason: 'limit', state };
          if (state.cards.some((c) => c.id === card.id)) return { ok: false, reason: 'duplicate', state };
          return {
            ok: true,
            state: { ...state, cards: [...state.cards, card], updatedAt: Math.max(state.updatedAt, 0) },
          };
        }

        /** 移除一张卡；不存在时返回 ok:false，状态原样返回。 */
        function removeCard(state, id) {
          const next = state.cards.filter((c) => c.id !== id);
          if (next.length === state.cards.length) return { ok: false, reason: 'not-found', state };
          return { ok: true, state: { ...state, cards: next } };
        }

        /** 设置卡片占用的网格跨度（拖动右下角改大小）；越界夹到 [1,4]。 */
        function setCardRect(state, id, patch) {
          const cards = (state.cards || []).map((c) => (c.id === id ? { ...c, rect: normalizeRect({ ...(c.rect || {}), ...(patch || {}) }) } : c));
          return { ...state, cards, updatedAt: Date.now() };
        }

        /** 自由布局下给新卡找一个不重叠的落点（向下流动）。 */
        function nextFreeRect(cards, width = 1100) {
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

        function setCardSpan(state, id, cols, rows) {
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
        function setMinimized(state, id, minimized = true) {
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
        function setMaximized(state, id) {
          if (id !== null && !state.cards.some((card) => card.id === id)) {
            return { ok: false, reason: 'not-found', state };
          }
          return { ok: true, state: { ...state, maximizedId: id } };
        }

        function setForm(state, form) {
          if (!FORMS.includes(form)) return { ok: false, reason: 'bad-form', state };
          return { ok: true, state: { ...state, form } };
        }

        /** 把卡片顺序替换成给定 id 顺序（自动排列/拖动后调用）；未知 id 忽略。 */
        function reorder(state, ids) {
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
        function parseBoard(text, now = 0) {
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
        function serializeBoard(state) {
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

        /* ---- src/lib/caps.js ---- */
        /**
         * caps.js — 能力探测与降级阶梯（抗升级的核心）
         *
         * 目标：宿主升级后，最坏情况是「能力降级 + 明确提示」，不白屏、不报错、不写坏数据。
         * 依赖分级（见设计文档 §6.5）：
         *   A 公开契约：slots.register / conversation.view / header.actions / ctx.theme / useSessions
         *   B 半公开：DOM 锚点、data-row-key、--dsw-alias-*（只做增强，全部 try/catch）
         *   C 私有：desktopRuntime / preload / Electron IPC（完全不用）
         *
         * 这个模块只做纯判定，探测动作在 client 的 compat probe 里做（try/catch 后填布尔）。
         */

        /** 降级阶梯：L0 完整 → L4 不可用。 */
        const MODES = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);

        /**
         * @param {{boardSlot?:boolean, overlaySlot?:boolean, headerActions?:boolean, sessions?:boolean}} caps
         * @returns {'L0'|'L1'|'L2'|'L3'|'L4'}
         */
        function pickMode(caps = {}) {
          const boardSlot = caps.boardSlot === true;
          const overlaySlot = caps.overlaySlot === true;
          const headerActions = caps.headerActions === true;
          const sessions = caps.sessions === true;

          if (boardSlot && sessions) return 'L0';
          if (overlaySlot && sessions) return 'L1';
          if (headerActions && sessions) return 'L2';
          // 会话目录读不到，但至少还有可挂载的 UI 位：只读展示，禁拖拽与写
          if (!sessions && (boardSlot || overlaySlot || headerActions)) return 'L3';
          return 'L4';
        }

        /** 给人看的一句话说明（设置页/提示条用）。 */
        function describeMode(mode) {
          switch (mode) {
            case 'L0':
              return '完整模式：会话画布内桌布页签';
            case 'L1':
              return '降级：以浮层（右侧抽屉）模式运行';
            case 'L2':
              return '降级：以模态面板运行（无页签/浮层）';
            case 'L3':
              return '只读模式：读不到会话列表，仅展示已有卡片';
            case 'L4':
              return '不可用：宿主缺少所需能力，已停止注册界面';
            default:
              return '未知模式';
          }
        }

        /** 是否需要提示用户「已降级」。 */
        function needsNotice(mode) {
          return mode !== 'L0';
        }

        /**
         * ui.js — 浏览器半侧的可视组件（P1：真实会话卡片桌布）
         *
         * 数据来源：`ctx.sessions.list`（snapshot store：getSnapshot / subscribe）。
         * 桌布状态（卡片顺序、形态）自持在 localStorage，key 带版本号；
         * 卡片只是「会话的视图」，标题/状态每次渲染都从会话目录实时取。
         */

        const TAG = '[dsh-session-cards]';
        const STORAGE_KEY = 'dsh-session-cards/board/v1';

        const isDarkTheme = () => {
          try {
            const html = document.documentElement;
            const scheme = String((html.style && html.style.colorScheme) || '').trim().toLowerCase();
            if (scheme) return scheme.includes('dark');
            if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true;
            return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
          } catch {
            return false;
          }
        };

        const STATUS = {
          running: { key: 'running', label: '进行中', color: 'var(--dsw-alias-text-accent, #3b6ef5)' },
          pending: { key: 'pending', label: '待确认', color: 'var(--dsw-alias-text-warning, #e8a33d)' },
          done: { key: 'done', label: '已完成', color: 'var(--dsw-alias-text-success, #2fb37f)' },
          todo: { key: 'todo', label: '待办', color: 'var(--dsw-alias-text-secondary, #9aa1ad)' },
        };

        function statusOf(summary) {
          if (!summary) return STATUS.todo;
          if (summary.running) return STATUS.running;
          if (summary.pendingInteraction) return STATUS.pending;
          if (summary.completed) return STATUS.done;
          return STATUS.todo;
        }

        function baseName(p) {
          if (!p || typeof p !== 'string') return '';
          const parts = p.split('/').filter(Boolean);
          return parts.length ? parts[parts.length - 1] : p;
        }

        function formatAge(ms) {
          if (!ms || typeof ms !== 'number') return '';
          const diff = Date.now() - ms;
          if (diff < 60e3) return '刚刚';
          if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
          if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
          return `${Math.floor(diff / 86400e3)} 天前`;
        }

        const INLINE_MD = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
        function mdInline(text) {
          const src = String(text == null ? '' : text);
          const out = [];
          let last = 0;
          let m;
          let k = 0;
          INLINE_MD.lastIndex = 0;
          while ((m = INLINE_MD.exec(src)) !== null) {
            if (m.index > last) out.push(src.slice(last, m.index));
            const tok = m[0];
            if (tok.startsWith('**')) {
              out.push(h('strong', { key: `b${k++}` }, tok.slice(2, -2)));
            } else {
              out.push(
                h(
                  'code',
                  {
                    key: `c${k++}`,
                    style: {
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: '0.92em',
                      padding: '0 3px',
                      borderRadius: 4,
                      background: 'var(--dsw-alias-fill-tertiary, rgba(127,127,127,.16))',
                    },
                  },
                  tok.slice(1, -1),
                ),
              );
            }
            last = m.index + tok.length;
          }
          if (last < src.length) out.push(src.slice(last));
          return out.length ? out : [''];
        }

        function readList(listStore) {
          try {
            const state = listStore && typeof listStore.getSnapshot === 'function' ? listStore.getSnapshot() : null;
            const ids = state && Array.isArray(state.ids) ? state.ids : [];
            const byId = (state && state.byId) || {};
            const rows = ids.map((id) => byId[id]).filter(Boolean);
            return {
              phase: (state && state.phase) || 'pending',
              ids: rows.map((row) => row.id),
              rows,
              byId,
              current: state && state.current,
            };
          } catch {
            return { phase: 'error', ids: [], rows: [], byId: {}, current: undefined };
          }
        }

        function loadBoard() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = parseBoard(raw);
            return parsed.state;
          } catch {
            return null;
          }
        }

        const SPAN_KEY = 'dsh-session-cards/default-span/v1';

        function loadDefaultSpan() {
          try {
            const raw = localStorage.getItem(SPAN_KEY);
            const v = raw ? JSON.parse(raw) : null;
            if (v && Number.isFinite(v.cols) && Number.isFinite(v.rows)) {
              return {
                cols: Math.min(4, Math.max(1, Math.round(v.cols))),
                rows: Math.min(4, Math.max(1, Math.round(v.rows))),
              };
            }
          } catch {
            /* 读不到就用 1×1 */
          }
          return { cols: 1, rows: 1 };
        }

        function saveDefaultSpan(span) {
          try {
            localStorage.setItem(SPAN_KEY, JSON.stringify({ cols: span.cols, rows: span.rows }));
          } catch {
            /* ignore */
          }
        }

        function saveBoard(board) {
          try {
            localStorage.setItem(STORAGE_KEY, serializeBoard(board));
          } catch {
            /* 存储不可用时只影响持久化，不影响当前会话 */
          }
        }

        function seedBoard(rows) {
          let state = emptyBoard(Date.now());
          for (const row of rows) {
            const card = makeCard({
              id: `card:${row.id}`,
              sessionId: row.id,
              title: row.displayTitle || row.title || row.id,
              workspace: baseName(row.cwd),
              model: row.agentPreset || '',
            });
            const next = addCard(state, card);
            if (!next.ok) break;
            state = next.state;
          }
          return state;
        }

        const EDGE_HIT = 8;

        function edgeZoneOf(event) {
          try {
            const el = event.currentTarget;
            const r = el.getBoundingClientRect();
            const x = event.clientX - r.left;
            const y = event.clientY - r.top;
            return {
              l: x <= EDGE_HIT,
              r: x >= r.width - EDGE_HIT,
              t: y <= EDGE_HIT,
              b: y >= r.height - EDGE_HIT,
            };
          } catch {
            return { l: false, r: false, t: false, b: false };
          }
        }

        function cursorForEdge(z) {
          const x = z.l || z.r;
          const y = z.t || z.b;
          if (x && y) return (z.l && z.t) || (z.r && z.b) ? 'nwse-resize' : 'nesw-resize';
          if (x) return 'ew-resize';
          if (y) return 'ns-resize';
          return '';
        }

        function cardShell(status, compact, dragging) {
          return {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? 6 : 8,
            minHeight: 0,
            padding: compact ? '9px 11px 8px' : '12px 13px 11px',
            borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.22))',
            borderTop: `3px solid ${status.color}`,
            background: 'var(--dsw-alias-bg-elevated, rgba(127,127,127,.06))',
            boxSizing: 'border-box',
            cursor: 'grab',
            userSelect: 'none',
            touchAction: 'none',
            opacity: dragging ? 0.45 : 1,
            overflow: 'hidden',
          };
        }

        function createBoardPanel(store) {
          return function BoardPanel() {
            const [tick, setTick] = React.useState(0);
            const [snapshot, setSnapshot] = React.useState(() =>
              readList(store.services.sessions && store.services.sessions.list),
            );
            const [board, setBoard] = React.useState(() => loadBoard() || emptyBoard(Date.now()));
            const [drag, setDrag] = React.useState({ id: null, active: false, overId: null, outside: false });
            const [dragPos, setDragPos] = React.useState({ x: 0, y: 0 });
            const [hoverId, setHoverId] = React.useState(null);
            const [focusedId, setFocusedId] = React.useState(null);
            const [drafts, setDrafts] = React.useState({});
            const [sendState, setSendState] = React.useState({});
            const [refreshAt, setRefreshAt] = React.useState(0);
            const [transcripts, setTranscripts] = React.useState({});
            const transcriptRef = React.useRef({});
            const inflightRef = React.useRef(new Set());

            const dragSessionRef = React.useRef(null);
            const [resizePreview, setResizePreview] = React.useState(null);
            const resizeRafRef = React.useRef(null);
            const resizeRef = React.useRef(null);
            const dragRef = React.useRef(null);
            const freeDragRef = React.useRef(null);
            const rootRef = React.useRef(null);
            const boardRef = React.useRef(board);
            boardRef.current = board;
            const [draft, setDraft] = React.useState('');
            const [popped, setPopped] = React.useState({});
            const [popError, setPopError] = React.useState(null);
            const [sending, setSending] = React.useState(false);
            const [sendResult, setSendResult] = React.useState(null);
            const [width, setWidth] = React.useState(0);
            const [viewH, setViewH] = React.useState(0);
            const [dark, setDark] = React.useState(() => isDarkTheme());

            React.useEffect(() => {
              const update = () => {
                const next = isDarkTheme();
                setDark(next);
                try {
                  document.documentElement.setAttribute('data-dsh-cards-dark', next ? '1' : '0');
                } catch {}
              };
              update();
              let mq = null;
              try {
                mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
                if (mq && mq.addEventListener) mq.addEventListener('change', update);
              } catch {}
              let mo = null;
              try {
                mo = new MutationObserver(update);
                mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] });
                if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-ds-dark-theme'] });
              } catch {}
              let style = document.getElementById('dsh-cards-input-style');
              if (!style) {
                style = document.createElement('style');
                style.id = 'dsh-cards-input-style';
                style.textContent = [
                  'textarea[data-card-input]::placeholder{color:rgba(15,23,42,.40)}',
                  'html[data-dsh-cards-dark="1"] textarea[data-card-input]::placeholder{color:rgba(255,255,255,.45)}',
                  '.dsh-free-cell>div{flex:1 1 auto;min-width:0;width:100%;height:100%}',
                ].join('\n');
                document.head.appendChild(style);
              }
              return () => {
                try {
                  if (mq && mq.removeEventListener) mq.removeEventListener('change', update);
                } catch {}
                try {
                  if (mo) mo.disconnect();
                } catch {}
              };
            }, []);
            const gridRef = React.useRef(null);

            React.useEffect(() => store.onChange(() => setTick((n) => n + 1)), []);

            React.useEffect(() => {
              const sessions = store.services.sessions;
              const list = sessions && sessions.list;
              setSnapshot(readList(list));
              if (!list || typeof list.subscribe !== 'function') return undefined;
              let off = null;
              try {
                off = list.subscribe(() => setSnapshot(readList(list)));
              } catch {
                off = null;
              }
              return () => {
                try {
                  if (typeof off === 'function') off();
                } catch {
                  /* ignore */
                }
              };
            }, [tick]);

            React.useEffect(() => {
              const timer = setTimeout(() => saveBoard(board), 250);
              return () => clearTimeout(timer);
            }, [board]);

            React.useEffect(() => {
              let alive = true;
              const sync = () => {
                fetch('/plugins/dsh-session-cards/popout/list')
                  .then((r) => r.json())
                  .then((body) => {
                    if (!alive || !body || !Array.isArray(body.sessions)) return;
                    const next = {};
                    for (const sid of body.sessions) next[sid] = true;
                    setPopped(next);
                  })
                  .catch(() => {});
              };
              sync();
              const timer = setInterval(sync, 15000);
              const onFocus = () => sync();
              window.addEventListener('focus', onFocus);
              return () => {
                alive = false;
                clearInterval(timer);
                window.removeEventListener('focus', onFocus);
              };
            }, []);

            React.useEffect(() => {
              const onDragStart = (event) => {
                const row = event.target && event.target.closest ? event.target.closest('[data-row-key^="session:"]') : null;
                dragSessionRef.current = row ? String(row.getAttribute('data-row-key')).slice(8) : null;
              };
              const onDragEnd = () => {
                dragSessionRef.current = null;
              };
              document.addEventListener('dragstart', onDragStart, true);
              document.addEventListener('dragend', onDragEnd, true);
              return () => {
                document.removeEventListener('dragstart', onDragStart, true);
                document.removeEventListener('dragend', onDragEnd, true);
              };
            }, []);

            React.useEffect(() => {
              const finish = (event) => {
                const fdrag = freeDragRef.current;
                if (fdrag) {
                  freeDragRef.current = null;
                  if (fdrag.moved && fdrag.rect) {
                    setBoard(setCardRect(boardRef.current, fdrag.id, fdrag.rect));
                  }
                  setResizePreview(null);
                  try {
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  } catch {}
                  return;
                }
                const rz = resizeRef.current;
                if (rz) {
                  resizeRef.current = null;
                  if (resizeRafRef.current != null) {
                    try {
                      cancelAnimationFrame(resizeRafRef.current);
                    } catch {
                      /* ignore */
                    }
                    resizeRafRef.current = null;
                  }
                  if (rz.rect) {
                    setBoard(setCardRect(boardRef.current, rz.id, rz.rect));
                    setResizePreview(null);
                    try {
                      document.body.style.cursor = '';
                      document.body.style.userSelect = '';
                    } catch {}
                    return;
                  }
                  const next = setCardSpan(boardRef.current, rz.id, rz.cols, rz.rows);
                  if (next.ok) {
                    setBoard(next.state);
                    saveDefaultSpan({ cols: rz.cols, rows: rz.rows });
                  }
                  setResizePreview(null);
                  try {
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  } catch {
                    /* ignore */
                  }
                  return;
                }
                const current = dragRef.current;
                dragRef.current = null;
                const px = event && Number.isFinite(event.clientX) ? event.clientX : null;
                const py = event && Number.isFinite(event.clientY) ? event.clientY : null;
                if (current && current.active && px !== null) {
                  const root = rootRef.current;
                  const rect = root ? root.getBoundingClientRect() : null;
                  const outside = !rect || px < rect.left - 24 || px > rect.right + 24 || py < rect.top - 24 || py > rect.bottom + 24;
                  if (outside) {
                    const card = boardRef.current.cards.find((c) => c.id === current.id);
                    if (card) {
                      popOut(card, { screenX: window.screenX + px, screenY: window.screenY + py });
                      setDrag({ id: null, active: false, overId: null });
                      return;
                    }
                  }
                }
                if (current && current.active && current.overId && current.overId !== current.id) {
                  const source = boardRef.current;
                  const i = source.cards.findIndex((c) => c.id === current.id);
                  const j = source.cards.findIndex((c) => c.id === current.overId);
                  if (i >= 0 && j >= 0) {
                    setBoard({ ...source, cards: swapItems(source.cards, i, j), updatedAt: Date.now() });
                  }
                }
                setDrag({ id: null, active: false, overId: null, outside: false });
              };
              const onMove = (event) => {
                const fdrag = freeDragRef.current;
                if (fdrag) {
                  const dx = event.clientX - fdrag.x0;
                  const dy = event.clientY - fdrag.y0;
                  if (!fdrag.moved && Math.hypot(dx, dy) < 4) return;
                  fdrag.moved = true;
                  const rect = normalizeRect({ ...fdrag.rect0, x: fdrag.rect0.x + dx, y: fdrag.rect0.y + dy });
                  fdrag.rect = rect;
                  setResizePreview({ id: fdrag.id, rect });
                  return;
                }
                const rz = resizeRef.current;
                if (rz) {
                  const dx = event.clientX - rz.x0;
                  const dy = event.clientY - rz.y0;
                  const sx = rz.edge && rz.edge.l ? -1 : 1;
                  const sy = rz.edge && rz.edge.t ? -1 : 1;
                  const hasX = rz.edge ? rz.edge.l || rz.edge.r : true;
                  const hasY = rz.edge ? rz.edge.t || rz.edge.b : true;
                  if (rz.rect0) {
                    const origin = rz.rect0;
                    let x = origin.x;
                    let y = origin.y;
                    let w = origin.w;
                    let h = origin.h;
                    if (rz.edge.l) { x = origin.x + dx; w = origin.w - dx; }
                    if (rz.edge.r) w = origin.w + dx;
                    if (rz.edge.t) { y = origin.y + dy; h = origin.h - dy; }
                    if (rz.edge.b) h = origin.h + dy;
                    if (w < 220) { if (rz.edge.l) x -= 220 - w; w = 220; }
                    if (h < 140) { if (rz.edge.t) y -= 140 - h; h = 140; }
                    const rect = normalizeRect({ x: Math.max(0, x), y: Math.max(0, y), w, h });
                    rz.rect = rect;
                    setResizePreview({ id: rz.id, rect });
                    return;
                  }
                  // 按「跨过多少个格子」算，而不是按绝对宽度算——1 格 ≈ cellW，手感与系统窗口一致。
                  const cols = hasX
                    ? Math.min(4, Math.max(1, (rz.cols0 || rz.cols) + Math.round((sx * dx) / rz.cellW)))
                    : rz.cols0 || rz.cols;
                  const rows = hasY
                    ? Math.min(4, Math.max(1, (rz.rows0 || rz.rows) + Math.round((sy * dy) / rz.cellH)))
                    : rz.rows0 || rz.rows;
                  // 连续像素尺寸：拖动时卡片跟着鼠标走，松手才吸附到网格跨度。
                  const rawW = (rz.w0 || 0) + (hasX ? sx * dx : 0);
                  const rawH = (rz.h0 || 0) + (hasY ? sy * dy : 0);
                  const minW = Math.max(120, (rz.cellW || 280) * 0.6);
                  const minH = Math.max(80, (rz.cellH || 168) * 0.6);
                  const maxW = (rz.cellW || 280) * 4 - 8;
                  const maxH = (rz.cellH || 168) * 4 - 8;
                  const pw = Math.round(Math.min(maxW, Math.max(minW, rawW)));
                  const ph = Math.round(Math.min(maxH, Math.max(minH, rawH)));
                  if (cols !== rz.cols || rows !== rz.rows || pw !== rz.pw || ph !== rz.ph) {
                    rz.cols = cols;
                    rz.rows = rows;
                    rz.pw = pw;
                    rz.ph = ph;
                    if (resizeRafRef.current == null) {
                      resizeRafRef.current = requestAnimationFrame(() => {
                        resizeRafRef.current = null;
                        const cur = resizeRef.current;
                        if (cur) setResizePreview({ id: cur.id, cols: cur.cols, rows: cur.rows, w: cur.pw, h: cur.ph });
                      });
                    }
                  }
                  const grid = gridRef.current;
                  if (grid && grid.scrollHeight > grid.clientHeight + 2) {
                    const box = grid.getBoundingClientRect();
                    if (event.clientY > box.bottom - 36) grid.scrollTop += 14;
                    else if (event.clientY < box.top + 36) grid.scrollTop -= 14;
                  }
                  return;
                }
                const current = dragRef.current;
                if (!current) return;
                const dx = event.clientX - current.x0;
                const dy = event.clientY - current.y0;
                const active = current.active || Math.hypot(dx, dy) > 6;
                const el = document.elementFromPoint(event.clientX, event.clientY);
                const hit = el && typeof el.closest === 'function' ? el.closest('[data-card-id]') : null;
                const overId = hit ? hit.getAttribute('data-card-id') : null;
                const root = rootRef.current;
                const rect = root ? root.getBoundingClientRect() : null;
                const outside = Boolean(
                  active &&
                    (!rect ||
                      event.clientX < rect.left - 24 ||
                      event.clientX > rect.right + 24 ||
                      event.clientY < rect.top - 24 ||
                      event.clientY > rect.bottom + 24),
                );
                if (current.active === active && current.overId === overId && current.outside === outside) return;
                dragRef.current = { ...current, active, overId, outside };
                setDrag({ id: current.id, active, overId, outside });
                if (active) setDragPos({ x: event.clientX, y: event.clientY });
              };
              const onKey = (event) => {
                if (event.key === 'Escape') {
                  dragRef.current = null;
                  setDrag({ id: null, active: false, overId: null });
                  setBoard((prev) => (prev.maximizedId ? { ...prev, maximizedId: null } : prev));
                }
              };
              window.addEventListener('pointermove', onMove, { passive: true });
              window.addEventListener('pointerup', finish);
              window.addEventListener('pointercancel', finish);
              window.addEventListener('keydown', onKey);
              return () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                window.removeEventListener('keydown', onKey);
              };
            }, []);

            React.useEffect(() => {
              const ids = [...new Set(board.cards.map((c) => c.sessionId))];
              const now = Date.now();
              for (const id of ids) {
                const prev = transcriptRef.current[id];
                const age = prev ? now - prev.at : Infinity;
                if (age < 5000 || inflightRef.current.has(id)) continue;
                inflightRef.current.add(id);
                fetch(`/plugins/dsh-session-cards/transcript?sessionId=${encodeURIComponent(id)}&limit=24`, {
                  credentials: 'same-origin',
                })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => {
                    if (!d || !d.ok) return;
                    transcriptRef.current = { ...transcriptRef.current, [id]: { blocks: d.blocks || [], at: Date.now() } };
                    setTranscripts({ ...transcriptRef.current });
                  })
                  .catch(() => {})
                  .finally(() => inflightRef.current.delete(id));
              }
            }, [board, snapshot, refreshAt]);

            React.useEffect(() => {
              const el = gridRef.current;
              if (!el) return undefined;
              const measure = () => {
                const r = el.getBoundingClientRect();
                setWidth(Math.round(r.width));
                setViewH(Math.round(el.clientHeight || r.height));
              };
              measure();
              if (typeof ResizeObserver !== 'function') return undefined;
              const ro = new ResizeObserver(measure);
              try {
                ro.observe(el);
              } catch {
                /* ignore */
              }
              return () => {
                try {
                  ro.disconnect();
                } catch {
                  /* ignore */
                }
              };
            }, [store.services.sessions]);

            const sendPrompt = async (card) => {
              const text = String(drafts[card.id] || '').trim();
              if (!text || sendState[card.id] === 'sending') return;
              setSendState((prev) => ({ ...prev, [card.id]: 'sending' }));
              try {
                const r = await fetch('/plugins/dsh-session-cards/prompt', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId: card.sessionId, text, mode: 'queue' }),
                });
                const data = await r.json().catch(() => null);
                if (r.ok && data && data.ok) {
                  setDrafts((prev) => ({ ...prev, [card.id]: '' }));
                  try {
                    const el = document.querySelector(`textarea[data-card-input="${card.id}"]`);
                    if (el) el.style.height = 'auto';
                  } catch {}
                  setSendState((prev) => ({ ...prev, [card.id]: 'ok' }));
                  if (transcriptRef.current[card.sessionId]) {
                    transcriptRef.current = {
                      ...transcriptRef.current,
                      [card.sessionId]: { ...transcriptRef.current[card.sessionId], at: 0 },
                    };
                  }
                  setRefreshAt((x) => x + 1);
                } else {
                  setSendState((prev) => ({ ...prev, [card.id]: 'err' }));
                }
              } catch {
                setSendState((prev) => ({ ...prev, [card.id]: 'err' }));
              }
              window.setTimeout(() => setSendState((prev) => ({ ...prev, [card.id]: null })), 2200);
            };

            const update = (next) => setBoard(next);
            const minimize = (id) =>
              setBoard((prev) => {
                const r = setMinimized(prev, id, true);
                return r.ok ? r.state : prev;
              });
            const restore = (id) =>
              setBoard((prev) => {
                const r = setMinimized(prev, id, false);
                return r.ok ? r.state : prev;
              });
            const maximize = (id) =>
              setBoard((prev) => {
                const r = setMaximized(prev, id);
                return r.ok ? r.state : prev;
              });
            const unmaximize = () => setBoard((prev) => ({ ...prev, maximizedId: null }));
            const sendMaxPrompt = async () => {
              const target = boardRef.current.cards.find((c) => c.id === boardRef.current.maximizedId);
              const text = draft.trim();
              if (!target || !text || sending) return;
              setSending(true);
              setSendResult(null);
              try {
                const res = await fetch('/plugins/dsh-session-cards/prompt', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId: target.sessionId, text }),
                });
                const json = await res.json().catch(() => null);
                if (res.ok) {
                  setSendResult('已发送');
                  setDraft('');
                } else {
                  setSendResult(`失败：${(json && json.error) || res.status}`);
                }
              } catch (error) {
                setSendResult(`失败：${(error && error.message) || error}`);
              } finally {
                setSending(false);
              }
            };
            const refreshCards = () => {
              const ids = snapshot.ids || [];
              const idSet = new Set(ids);
              setBoard((prev) => ({
                ...prev,
                cards: prev.cards
                  .filter((c) => idSet.size === 0 || idSet.has(c.sessionId))
                  .map((c) => {
                    const live = snapshot.byId[c.sessionId] || {};
                    return {
                      ...c,
                      title: live.displayTitle || live.title || c.title,
                      workspace: baseName(live.cwd) || c.workspace,
                      model: live.agentPreset || c.model,
                    };
                  }),
                updatedAt: Date.now(),
              }));
              /* 刷新只更新已有卡片的数据与对话，绝不自动新增卡片 */
              transcriptRef.current = {};
              setRefreshAt((x) => x + 1);
            };

            const autoArrange = (strategy) => {
              if (board.form === 'free') {
                const perRow = Math.max(1, Math.floor(((width || 1100) - 32 + 16) / (340 + 16)));
                const cards = board.cards.map((c, i) => ({
                  ...c,
                  rect: normalizeRect({
                    x: (i % perRow) * 356 + 16,
                    y: Math.floor(i / perRow) * 206 + 16,
                    w: c.rect ? c.rect.w : 340,
                    h: c.rect ? c.rect.h : 190,
                  }),
                }));
                update({ ...board, cards, updatedAt: Date.now() });
                return;
              }
              const cards = arrangeCards(
                board.cards.map((c) => {
                  const live = snapshot.byId[c.sessionId];
                  return { ...c, running: !!(live && live.running), updatedAt: (live && live.updatedAt) || 0 };
                }),
                strategy,
              );
              update({ ...board, cards, updatedAt: Date.now() });
            };
            const changeForm = (form) => {
              if (form === 'free' && board.form !== 'free') {
                const perRow = Math.max(1, Math.floor(((width || 1100) - 32 + 16) / (340 + 16)));
                let i = 0;
                const cards = board.cards.map((c) => {
                  const cols = Math.min(4, Math.max(1, c.cols || 1));
                  const rows = Math.min(4, Math.max(1, c.rows || 1));
                  const rect =
                    c.rect ||
                    {
                      x: (i % perRow) * 356 + 16,
                      y: Math.floor(i / perRow) * 206 + 16,
                      w: cols * 340 + (cols - 1) * 16,
                      h: rows * 190 + (rows - 1) * 16,
                    };
                  i += 1;
                  return { ...c, rect: normalizeRect(rect) };
                });
                update({ ...board, form: 'free', cards, updatedAt: Date.now() });
                return;
              }
              const next = setForm(board, form);
              if (next.ok) update(next.state);
            };

            const isMatrix = board.form === 'matrix' && board.cards.filter((c) => !c.minimized).length > 0;

            const summary = `${board.cards.length} 张卡片 · 共 ${(snapshot.ids || []).length} 个会话`;
            const btnStyle = () => ({
              fontSize: 11.5,
              padding: '4px 10px',
              borderRadius: 7,
              border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
              background: 'transparent',
              color: 'var(--dsw-alias-text-secondary, #6b7280)',
              cursor: 'pointer',
            });

            const segBtn = (active, label, onClick) =>
              h(
                'button',
                {
                  type: 'button',
                  onClick,
                  style: {
                    fontSize: 11.5,
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
                    background: active ? 'var(--dsw-alias-bg-accent, rgba(59,110,245,.16))' : 'transparent',
                    color: active ? 'var(--dsw-alias-text-accent, #3b6ef5)' : 'var(--dsw-alias-text-secondary, #6b7280)',
                    cursor: 'pointer',
                  },
                },
                label,
              );

            const addCurrent = () => {
              const current = snapshot.current || (snapshot.ids && snapshot.ids[0]);
              if (!current) return;
              const live = snapshot.byId[current] || {};
              setBoard((prev) => {
                const span = loadDefaultSpan();
                const next = addCard(
                  prev,
                  makeCard({
                    id: `card:${current}`,
                    sessionId: current,
                    title: live.displayTitle || live.title || current,
                    workspace: baseName(live.cwd),
                    model: live.agentPreset || '',
                    cols: span.cols,
                    rows: span.rows,
                    ...(prev.form === 'free' ? { rect: nextFreeRect(prev.cards, width || 1100) } : {}),
                  }),
                );
                return next.ok ? next.state : prev;
              });
            };

            const dropIn = (event) => {
              event.preventDefault();
              const sid = dragSessionRef.current;
              dragSessionRef.current = null;
              if (!sid) return;
              const live = snapshot.byId[sid] || {};
              setBoard((prev) => {
                const span = loadDefaultSpan();
                const next = addCard(
                  prev,
                  makeCard({
                    id: `card:${sid}`,
                    sessionId: sid,
                    title: live.displayTitle || live.title || sid,
                    workspace: baseName(live.cwd),
                    model: live.agentPreset || '',
                    cols: span.cols,
                    rows: span.rows,
                    ...(prev.form === 'free' ? { rect: nextFreeRect(prev.cards, width || 1100) } : {}),
                  }),
                );
                return next.ok ? next.state : prev;
              });
            };

            const closeCard = (id) =>
              setBoard((prev) => {
                const next = removeCard(prev, id);
                return next.ok ? next.state : prev;
              });

            const header = h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flex: 'none' } },
              h('div', { style: { fontSize: 14, fontWeight: 750 } }, '卡片桌布'),
              h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-text-secondary, #6b7280)' } }, summary),
              popError
                ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-text-danger, #d9534f)', marginLeft: 8 } }, popError)
                : null,
              drag.active && drag.outside
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: 11,
                        color: 'var(--dsw-alias-text-accent, #6b8cff)',
                        marginLeft: 8,
                        padding: '2px 8px',
                        borderRadius: 99,
                        background: 'var(--dsw-alias-bg-accent, rgba(59,110,245,.14))',
                      },
                    },
                    '松手 → 弹出为独立窗口',
                  )
                : null,
              h(
                'div',
                { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                segBtn(false, '自动排列', () => autoArrange('recent')),
                h(
                  'button',
                  { type: 'button', onClick: addCurrent, style: btnStyle() },
                  '＋ 当前会话',
                ),
                h(
                  'button',
                  { type: 'button', onClick: refreshCards, title: '刷新已有卡片的数据与对话（不会新增卡片）', style: btnStyle() },
                  '⟳ 刷新',
                ),
                segBtn(!isMatrix, '▦ 网格', () => changeForm('grid')),
                segBtn(isMatrix, '▦ 宫格', () => changeForm('matrix')),
                segBtn(board.form === 'free', '◱ 自由', () => changeForm('free')),
              ),
            );

            const readOnly = !!(store.drill && store.drill.disableSessions) || !store.services.sessions || !store.caps.sessions;
            if (readOnly) {
              return h(
                'div',
                { style: { position: 'absolute', inset: 0, padding: 18, overflow: 'auto' } },
                header,
                h(
                  'div',
                  {
                    style: {
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: '1px dashed var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                      fontSize: 12.5,
                      color: 'var(--dsw-alias-text-secondary, #6b7280)',
                      lineHeight: 1.7,
                    },
                  },
                  '当前宿主没有可用的会话目录服务（L3 只读降级）。卡片桌布展示空态，不会报错。',
                ),
              );
            }

            const popOut = (card, point) => {
              try {
                const el = document.querySelector(`[data-card-id="${card.id}"]`);
                const rect = el ? el.getBoundingClientRect() : null;
                const x = point && Number.isFinite(point.screenX)
                  ? Math.round(point.screenX)
                  : rect
                    ? Math.round(window.screenX + rect.left + rect.width / 2)
                    : Math.round(window.screenX + window.innerWidth / 2);
                const y = point && Number.isFinite(point.screenY)
                  ? Math.round(point.screenY)
                  : rect
                    ? Math.round(window.screenY + rect.top + 28)
                    : Math.round(window.screenY + 120);
                fetch('/plugins/dsh-session-cards/popout', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: card.sessionId,
                    x,
                    y,
                    mainRect: {
                      x: Math.round(window.screenX || 0),
                      y: Math.round(window.screenY || 0),
                      width: Math.round(window.innerWidth || 0),
                      height: Math.round(window.innerHeight || 0),
                    },
                  }),
                })
                  .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
                  .then(({ ok, body }) => {
                    if (ok) {
                      setPopped((prev) => ({ ...prev, [card.sessionId]: true }));
                      setPopError(null);
                    } else {
                      console.warn(`${TAG} 弹出失败`, body);
                      setPopError(`弹出失败：${(body && body.error) || 'unknown'}`);
                      setTimeout(() => setPopError(null), 5000);
                    }
                  })
                  .catch((error) => {
                    console.warn(`${TAG} 弹出失败`, error);
                    setPopError(`弹出失败：${String((error && error.message) || error)}`);
                    setTimeout(() => setPopError(null), 5000);
                  });
              } catch (error) {
                console.warn(`${TAG} 弹出异常`, error);
              }
            };

            const gridCols = Math.max(1, Math.floor((width + 12) / (280 + 12)));
            const plannedRows = board.cards.length ? planRows(board.cards, gridCols) : 1;
            const rowH = Math.max(
              128,
              Math.min(180, Math.floor((viewH - 12 * Math.max(0, plannedRows - 1) - 8) / plannedRows) || 168),
            );

            const visible = board.cards.filter((c) => !c.minimized);
            const minimized = board.cards.filter((c) => c.minimized);
            const maxCard = board.maximizedId ? board.cards.find((c) => c.id === board.maximizedId) : null;
            const dims = matrixDims(visible.length, width);
            const cols = isMatrix ? dims.cols : 0;
            const rows = isMatrix ? dims.rows : 0;

            const isFree = board.form === 'free';
            const freeContentH = isFree
              ? Math.max(320, ...visible.map((c) => (c.rect ? c.rect.y + c.rect.h : 0))) + 40
              : 0;
            const gridStyle = isFree
              ? {
                  position: 'relative',
                  display: 'block',
                  flex: 1,
                  minHeight: freeContentH,
                  overflow: 'auto',
                }
              : isMatrix
              ? {
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  gap: 12,
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }
              : {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gridAutoRows: `${rowH}px`,
                  gap: 12,
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  alignContent: 'start',
                  paddingBottom: 6,
                };

            const iconBtn = (label, title, onClick, active = false) =>
              h(
                'button',
                {
                  type: 'button',
                  title,
                  onPointerDown: (e) => e.stopPropagation(),
                  onPointerEnter: (e) => {
                    e.currentTarget.style.background = isDarkTheme() ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.10)';
                  },
                  onPointerLeave: (e) => {
                    e.currentTarget.style.background = isDarkTheme() ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.94)';
                  },
                  onClick: (e) => {
                    e.stopPropagation();
                    onClick();
                  },
                  style: {
                    flex: 'none',
                    width: 24,
                    height: 24,
                    ...(active ? { color: isDarkTheme() ? '#8fb0ff' : '#3b62e0' } : {}),
                    lineHeight: '22px',
                    textAlign: 'center',
                    borderRadius: 7,
                    ...(isDarkTheme()
                      ? {
                          border: '1px solid rgba(255,255,255,.30)',
                          background: 'rgba(255,255,255,.16)',
                          color: '#f7f7fa',
                          boxShadow: '0 1px 4px rgba(0,0,0,.45)',
                        }
                      : {
                          border: '1px solid rgba(0,0,0,.14)',
                          background: 'rgba(255,255,255,.94)',
                          color: '#3f3f46',
                          boxShadow: '0 1px 3px rgba(0,0,0,.16)',
                        }),
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  },
                },
                label,
              );

            const startResize = (event, card, edge) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              if (boardRef.current.form === 'matrix') {
                setBoard((prev) => (prev.form === 'matrix' ? { ...prev, form: 'grid' } : prev));
              }
              const grid = gridRef.current;
              if (!grid) return;
              const cs = getComputedStyle(grid);
              const firstCol = (cs.gridTemplateColumns || '').split(' ').filter(Boolean)[0];
              const cellW = parseFloat(firstCol) || 280;
              const rowDef = parseFloat(cs.gridAutoRows) || 168;
              const gap = parseFloat(cs.rowGap) || 12;
              const cardEl = event.currentTarget.closest ? event.currentTarget.closest('[data-card-id]') : null;
              const rect = (cardEl || event.currentTarget).getBoundingClientRect();
              resizeRef.current = {
                id: card.id,
                x0: event.clientX,
                y0: event.clientY,
                w0: rect.width,
                h0: rect.height,
                cols: card.cols || 1,
                rows: card.rows || 1,
                cols0: card.cols || 1,
                rows0: card.rows || 1,
                cellW: cellW + gap,
                cellH: rowDef + gap,
                rect0: boardRef.current.form === 'free' ? card.rect || { x: 0, y: 0, w: rect.width, h: rect.height } : null,
                edge: edge || { l: false, r: true, t: false, b: true },
              };
              setResizePreview({ id: card.id, cols: card.cols || 1, rows: card.rows || 1 });
              try {
                document.body.style.cursor = 'nwse-resize';
                document.body.style.userSelect = 'none';
              } catch {
                /* ignore */
              }
            };

            const renderCard = (c, index, size) => {
              const compact = size === 'small';
              const hovered = hoverId === c.id;
              const inputVisible = size !== 'small' && (size === 'max' || hovered || focusedId === c.id);
              const live = snapshot.byId[c.sessionId];
              const outline = live && live.projectionValues && Array.isArray(live.projectionValues.turnOutline)
                ? live.projectionValues.turnOutline
                : [];
              const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
              const turns = outline
                .filter((t) => t && typeof t === 'object')
                .map((t) => ({ prompt: clean(t.prompt), response: clean(t.response) }))
                .filter((t) => t.prompt || t.response);
              const maxTurns = size === 'max' ? 6 : compact ? 1 : Math.min(4, Math.max(1, c.rows || 1));
              const shown = turns.slice(-maxTurns);
              const lastPrompt = shown.length > 0 ? shown[shown.length - 1].prompt : '';
              const title = (live && (live.displayTitle || live.title)) || c.title || c.sessionId;
              return h(
                'div',
                {
                  key: c.id,
                  style: {
                    ...cardShell(status, compact, drag.id === c.id && drag.active),
                    outline:
                      drag.active && drag.overId === c.id && drag.id !== c.id
                        ? '2px dashed var(--dsw-alias-text-accent, #3b6ef5)'
                        : 'none',
                    outlineOffset: -2,
                    ...(size === 'max'
                      ? { flex: 1, width: '100%' }
                      : isMatrix
                        ? {}
                        : {
                            gridColumn: `span ${resizePreview && resizePreview.id === c.id ? resizePreview.cols : c.cols || 1}`,
                            gridRow: `span ${resizePreview && resizePreview.id === c.id ? resizePreview.rows : c.rows || 1}`,
                          }),
                    ...(resizePreview &&
                    resizePreview.id === c.id &&
                    resizePreview.w &&
                    size !== 'max' &&
                    board.form !== 'free'
                      ? {
                          width: resizePreview.w,
                          height: resizePreview.h,
                          zIndex: 5,
                          position: 'relative',
                        }
                      : {}),
                    padding: size === 'max' ? '18px 20px' : compact ? '9px 11px 8px' : '12px 13px 11px',
                  },
                  'data-card-id': c.id,
                  onPointerEnter: () => setHoverId(c.id),
                  onPointerLeave: (e) => {
                    setHoverId((prev) => (prev === c.id ? null : prev));
                    try {
                      e.currentTarget.style.cursor = '';
                    } catch {}
                  },
                  onPointerMove: (e) => {
                    if (size === 'max') return;
                    try {
                      e.currentTarget.style.cursor = cursorForEdge(edgeZoneOf(e));
                    } catch {}
                  },
                  onPointerDown: (e) => {
                    if (e.button !== 0) return;
                    if (size === 'max') return;
                    const zone = edgeZoneOf(e);
                    if (cursorForEdge(zone)) {
                      startResize(e, c, zone);
                      return;
                    }
                    if (board.form === 'free') {
                      const r = c.rect || { x: 16, y: 16, w: 340, h: 190 };
                      freeDragRef.current = { id: c.id, x0: e.clientX, y0: e.clientY, rect0: r, rect: r, moved: false };
                      return;
                    }
                    dragRef.current = { id: c.id, x0: e.clientX, y0: e.clientY, active: false, overId: null };
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flex: 'none',
                      minWidth: 0,
                      minHeight: 14,
                    },
                  },
                  h('span', {
                    style: { width: 6, height: 6, borderRadius: 99, background: status.color, flex: 'none' },
                  }),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: size === 'max' ? 16 : 11,
                        fontWeight: size === 'max' ? 700 : 500,
                        opacity: size === 'max' ? 1 : 0.72,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        flex: 1,
                        paddingRight: size === 'max' ? 0 : hovered ? 104 : 0,
                        transition: 'padding-right .15s ease',
                      },
                    },
                    title,
                  ),
                  h(
                    'span',
                    {
                      style: {
                        display: 'flex',
                        gap: 4,
                        flex: 'none',
                        position: 'absolute',
                        right: size === 'max' ? 12 : 6,
                        top: size === 'max' ? 12 : 6,
                        padding: '2px 3px',
                        borderRadius: 8,
                        background: 'var(--dsw-alias-bg-overlay, rgba(250,250,252,.86))',
                        backdropFilter: 'blur(6px)',
                        opacity: hoverId === c.id || size === 'max' ? 1 : 0,
                        pointerEvents: hoverId === c.id || size === 'max' ? 'auto' : 'none',
                        transition: 'opacity .15s ease',
                      },
                    },
                    c.minimized
                      ? iconBtn('▢', '还原到画布', () => restore(c.id))
                      : iconBtn('—', '最小化到底部', () => minimize(c.id)),
                    iconBtn('⧉', popped[c.sessionId] ? '已弹出（再点可开新窗）' : '弹出为独立窗口', () => popOut(c), Boolean(popped[c.sessionId])),
                    maxCard && maxCard.id === c.id
                      ? iconBtn('⤡', '还原大小（Esc）', () => unmaximize())
                      : iconBtn('⤢', '最大化', () => maximize(c.id)),
                    iconBtn('✕', '从桌布移除', () => closeCard(c.id)),
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: compact ? 5 : 7,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      flex: compact ? 'none' : 1,
                      marginTop: compact ? 6 : 8,
                      paddingRight: 2,
                      paddingBottom: inputVisible && size !== 'max' ? 46 : 0,
                    },
                  },
                  (() => {
                    const tr = transcripts[c.sessionId];
                    const all = tr && Array.isArray(tr.blocks) ? tr.blocks : [];
                    const cap = size === 'max' ? 12 : hovered ? Math.max(2, (c.rows || 1) * 2) : 1;
                    const blocks = all
                      .filter((b) => size === 'max' || b.role !== 'tool')
                      .slice(-cap);
                    if (blocks.length === 0) {
                      return shown.length === 0
                        ? h(
                            'div',
                            {
                              style: {
                                fontSize: compact ? 11 : size === 'max' ? 13 : 12,
                                lineHeight: 1.5,
                                color: 'var(--dsw-alias-text-secondary, #6b7280)',
                                overflow: 'hidden',
                              },
                            },
                            (live && baseName(live.cwd)) || c.workspace || '未标注工作区',
                          )
                        : shown.map((t, i) =>
                            h(
                              'div',
                              { key: `t${i}`, 'data-turn': i, style: { display: 'flex', flexDirection: 'column', gap: 1 } },
                              t.prompt
                                ? h(
                                    'div',
                                    {
                                      style: {
                                        fontSize: compact ? 11 : 11.5,
                                        fontWeight: 600,
                                        lineHeight: 1.35,
                                        color: 'var(--dsw-alias-text-primary, inherit)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      },
                                    },
                                    t.prompt,
                                  )
                                : null,
                              t.response
                                ? h(
                                    'div',
                                    {
                                      style: {
                                        fontSize: compact ? 10.5 : 11,
                                        lineHeight: 1.45,
                                        color: 'var(--dsw-alias-text-secondary, #6b7280)',
                                        overflow: 'hidden',
                                        display: '-webkit-box',
                                        WebkitLineClamp: size === 'max' ? 3 : compact ? 1 : 2,
                                        WebkitBoxOrient: 'vertical',
                                      },
                                    },
                                    t.response,
                                  )
                                : null,
                            ),
                          );
                    }
                    const clamp = (role) => {
                      if (size === 'max') return role === 'user' ? 4 : 12;
                      if (compact) return 1;
                      return Math.max(2, (c.rows || 1) * 3);
                    };
                    return blocks.map((b, i) => {
                      if (b.role === 'user') {
                        return h(
                          'div',
                          {
                            key: `b${i}`,
                            style: {
                              alignSelf: 'flex-end',
                              maxWidth: '90%',
                              background: 'var(--dsw-alias-fill-tertiary, rgba(127,127,127,0.14))',
                              borderRadius: 10,
                              padding: '5px 9px',
                              fontSize: compact ? 11 : 11.5,
                              lineHeight: 1.55,
                              color: 'var(--dsw-alias-text-primary, inherit)',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: clamp('user'),
                              WebkitBoxOrient: 'vertical',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            },
                          },
                          mdInline(b.text),
                        );
                      }
                      if (b.role === 'tool') {
                        return h(
                          'div',
                          {
                            key: `b${i}`,
                            style: {
                              fontSize: compact ? 9.5 : 10.5,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              color: 'var(--dsw-alias-text-secondary, #6b7280)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            },
                          },
                          `⚙ ${b.text}`,
                        );
                      }
                      return h(
                        'div',
                        {
                          key: `b${i}`,
                          style: {
                            fontSize: compact ? 11 : 11.8,
                            lineHeight: 1.62,
                            letterSpacing: 0.1,
                            color: 'var(--dsw-alias-text-primary, inherit)',
                            opacity: 0.92,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: clamp('assistant'),
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          },
                        },
                        mdInline(b.text),
                      );
                    });
                  })(),
                ),
                size === 'max'
                  ? h(
                      'div',
                      { style: { marginTop: 14, display: 'flex', gap: 8, flex: 'none' } },
                      h('textarea', {
                        value: draft,
                        onChange: (e) => setDraft(e.target.value),
                        placeholder: '发送到本卡片会话…',
                        style: {
                          flex: 1,
                          minHeight: 54,
                          resize: 'none',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
                          background: 'var(--dsw-alias-bg-primary, transparent)',
                          color: 'inherit',
                          fontSize: 12.5,
                          fontFamily: 'inherit',
                        },
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          disabled: sending || draft.trim() === '',
                          onClick: sendMaxPrompt,
                          style: {
                            flex: 'none',
                            alignSelf: 'flex-end',
                            padding: '7px 14px',
                            borderRadius: 8,
                            border: 'none',
                            background: 'var(--dsw-alias-bg-accent, rgba(59,110,245,.9))',
                            color: '#fff',
                            fontSize: 12.5,
                            fontWeight: 650,
                            cursor: sending || draft.trim() === '' ? 'default' : 'pointer',
                            opacity: sending || draft.trim() === '' ? 0.5 : 1,
                          },
                        },
                        sending ? '发送中…' : '发送',
                      ),
                      sendResult
                        ? h(
                            'span',
                            {
                              style: {
                                flex: 'none',
                                alignSelf: 'flex-end',
                                fontSize: 11,
                                color: 'var(--dsw-alias-text-secondary, #6b7280)',
                              },
                            },
                            sendResult,
                          )
                        : null,
                    )
                  : null,
                size === 'normal'
                  ? h('div', {
                      title: '拖动调整大小',
                      onPointerDown: (e) => startResize(e, c),
                      style: {
                        position: 'absolute',
                        right: 0,
                        bottom: 0,
                        zIndex: 6,
                        width: 16,
                        height: 16,
                        cursor: 'nwse-resize',
                        touchAction: 'none',
                        color: 'var(--dsw-alias-text-secondary, #6b7280)',
                        fontSize: 10,
                        lineHeight: '14px',
                        textAlign: 'center',
                        userSelect: 'none',
                      },
                    }, '◢')
                  : null,
                size === 'max' || !inputVisible
                  ? null
                  : h(
                      'div',
                      {
                        onPointerDown: (e) => e.stopPropagation(),
                        style:
                          size === 'max'
                            ? {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flex: 'none',
                                marginTop: 10,
                                paddingTop: 8,
                                borderTop: `1px solid ${dark ? 'rgba(255,255,255,.14)' : 'rgba(127,127,127,.14)'}`,
                              }
                            : {
                                position: 'absolute',
                                left: 8,
                                right: 30,
                                bottom: 8,
                                display: 'flex',
                                alignItems: 'flex-end',
                                gap: 6,
                                padding: '5px 5px 5px 9px',
                                borderRadius: 10,
                                background: dark ? 'rgba(34,34,39,.97)' : 'rgba(255,255,255,.98)',
                                border: `1px solid ${dark ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.14)'}`,
                                boxShadow: dark ? '0 8px 22px rgba(0,0,0,.55)' : '0 6px 18px rgba(15,23,42,.14)',
                                zIndex: 7,
                              },
                      },
                      h('textarea', {
                        rows: 1,
                        value: drafts[c.id] || '',
                        'data-card-input': c.id,
                        placeholder:
                          sendState[c.id] === 'sending'
                            ? '发送中…'
                            : sendState[c.id] === 'ok'
                              ? '已发送'
                              : sendState[c.id] === 'err'
                                ? '发送失败'
                                : size === 'max'
                                  ? '回复本会话…（Enter 发送，Shift+Enter 换行）'
                                  : '回复…（Enter 发送）',
                        onInput: (e) => {
                          const el = e.target;
                          try {
                            el.style.height = 'auto';
                            el.style.height = Math.min(el.scrollHeight, 52) + 'px';
                          } catch {}
                        },
                        onChange: (e) => {
                          const v = e.target.value;
                          setDrafts((prev) => ({ ...prev, [c.id]: v }));
                        },
                        onFocus: () => setFocusedId(c.id),
                        onBlur: () => setFocusedId((prev) => (prev === c.id ? null : prev)),
                        onKeyDown: (e) => {
                          // 中文输入法组合中的 Enter 是「选词」，不能当发送。
                          if (e.nativeEvent && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendPrompt(c);
                          }
                        },
                        style: {
                          flex: 1,
                          minWidth: 0,
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          resize: 'none',
                          overflowY: 'auto',
                          lineHeight: '16px',
                          maxHeight: 52,
                          fontSize: size === 'max' ? 13 : 11.5,
                          color: dark ? '#f4f4f6' : '#1f2328',
                          padding: '2px 0',
                          fontFamily: 'inherit',
                        },
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => sendPrompt(c),
                          title: '发送到本卡片会话',
                          style: {
                            flex: 'none',
                            width: 22,
                            height: 22,
                            borderRadius: 99,
                            border: 'none',
                            cursor: 'pointer',
                            background: dark ? 'rgba(255,255,255,.18)' : 'rgba(15,23,42,.10)',
                            color: dark ? '#f4f4f6' : '#1f2328',
                            fontSize: 12,
                            lineHeight: '22px',
                            padding: 0,
                          },
                        },
                        '↑',
                      ),
                    ),
                inputVisible && size !== 'max'
                  ? null
                  : h(
                  'div',
                  {
                    style: {
                      marginTop: size === 'max' ? 12 : 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 10.5,
                      color: 'var(--dsw-alias-text-secondary, #6b7280)',
                      flex: 'none',
                    },
                  },
                  h('span', null, formatAge(live && live.updatedAt) || '—'),
                  live && live.agentPreset ? h('span', null, `· ${live.agentPreset}`) : null,
                  snapshot.current === c.sessionId
                    ? h('span', { style: { marginLeft: 'auto' } }, '当前')
                    : h('span', { style: { marginLeft: 'auto' } }, `#${index + 1}`),
                ),
                resizePreview && resizePreview.id === c.id
                  ? h(
                      'div',
                      {
                        style: {
                          position: 'absolute',
                          right: 10,
                          bottom: 26,
                          zIndex: 8,
                          pointerEvents: 'none',
                          fontSize: 11,
                          fontWeight: 600,
                          lineHeight: '18px',
                          padding: '1px 7px',
                          borderRadius: 6,
                          color: 'var(--dsw-alias-text-primary, #111)',
                          background: 'var(--dsw-alias-bg-elevated, rgba(255,255,255,.92))',
                          border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                          boxShadow: '0 2px 8px rgba(0,0,0,.18)',
                        },
                      },
                      `${resizePreview.cols} × ${resizePreview.rows}`,
                    )
                  : null,
              );
            };

            const dragGhost = drag.active
              ? (() => {
                  const card = board.cards.find((c) => c.id === drag.id);
                  if (!card) return null;
                  const live = snapshot.byId[card.sessionId];
                  const title = (live && (live.displayTitle || live.title)) || card.title || card.sessionId;
                  return h(
                    'div',
                    {
                      style: {
                        position: 'fixed',
                        left: dragPos.x + 12,
                        top: dragPos.y + 12,
                        zIndex: 2147483002,
                        pointerEvents: 'none',
                        padding: '6px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 650,
                        color: 'var(--dsw-alias-text-primary, inherit)',
                        background: 'var(--dsw-alias-bg-elevated, rgba(40,42,48,.95))',
                        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                        boxShadow: '0 8px 20px rgba(0,0,0,.25)',
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    title,
                  );
                })()
              : null;

            return h(
              'div',
              {
                ref: rootRef,
                onDragOver: (e) => {
                  if (dragSessionRef.current) e.preventDefault();
                },
                onDrop: dropIn,
                style: {
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '16px 16px 132px',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                },
              },
              header,
              maxCard
                ? h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, renderCard(maxCard, 0, 'max'))
                : h(
                    'div',
                    { ref: gridRef, style: gridStyle },
                    visible.map((c, i) => {
                      if (!isFree) return renderCard(c, i, 'normal');
                      const r =
                        resizePreview && resizePreview.id === c.id && resizePreview.rect
                          ? resizePreview.rect
                          : c.rect || { x: 16, y: 16, w: 340, h: 190 };
                      return h(
                        'div',
                        {
                          key: c.id,
                          className: 'dsh-free-cell',
                          style: {
                            position: 'absolute',
                            left: r.x,
                            top: r.y,
                            width: r.w,
                            height: r.h,
                            display: 'flex',
                          },
                        },
                        renderCard(c, i, 'normal'),
                      );
                    }),
                    visible.length === 0
                      ? h(
                          'div',
                          {
                            style: {
                              gridColumn: '1 / -1',
                              padding: '28px 16px',
                              textAlign: 'center',
                              fontSize: 12.5,
                              color: 'var(--dsw-alias-text-secondary, #6b7280)',
                              border: '1px dashed var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                              borderRadius: 12,
                            },
                          },
                          '还没有卡片：把左侧会话拖进来，或点右上角「＋ 当前会话」',
                        )
                      : null,
                  ),
              dragGhost,
              minimized.length > 0 && !maxCard
                ? h(
                    'div',
                    {
                      style: {
                        flex: 'none',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        marginTop: 10,
                        overflowX: 'auto',
                      },
                    },
                    h(
                      'span',
                      { style: { fontSize: 10.5, color: 'var(--dsw-alias-text-secondary, #6b7280)', flex: 'none' } },
                      `最小化 ${minimized.length}`,
                    ),
                    minimized.map((c) =>
                      h(
                        'button',
                        {
                          key: c.id,
                          type: 'button',
                          onClick: () => restore(c.id),
                          title: '还原到画布',
                          style: {
                            flex: 'none',
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            padding: '5px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
                            background: 'var(--dsw-alias-bg-elevated, rgba(127,127,127,.06))',
                            color: 'var(--dsw-alias-text-secondary, #6b7280)',
                            fontSize: 11.5,
                            cursor: 'pointer',
                          },
                        },
                        `${statusOf(snapshot.byId[c.sessionId]).label} · ${(snapshot.byId[c.sessionId] && (snapshot.byId[c.sessionId].displayTitle || snapshot.byId[c.sessionId].title)) || c.title}`,
                      ),
                    ),
                  )
                : null,
            );
          };
        }


        /**
         * apply.js — 浏览器半侧入口：软探测能力 → 按降级阶梯注册 UI
         *
         * 依赖分级（对应设计 §6.5）：
         *   - 只有 `slots` 是硬注入（没有它插件无法贡献任何 UI）；
         *   - `theme` / `sessions` 用 `ctx.inject` 软探测，拿不到就降级，不阻断加载；
         *   - 探测结果放进 store，组件订阅 store 变化，而不是在 apply 时一把抓死。
         */

        function readService(ctx, name) {
          try {
            const direct = ctx ? ctx[name] : undefined;
            if (direct !== undefined && direct !== null) return direct;
            if (ctx && typeof ctx.get === 'function') {
              const got = ctx.get(name);
              if (got !== undefined && got !== null) return got;
            }
          } catch {
            /* 服务不存在时会 throw，按不可用处理 */
          }
          return null;
        }

        function createStore() {
          const store = {
            caps: { theme: false, sessions: false, slots: true, mount: 'conversation.view' },
            services: { theme: null, sessions: null },
            mode: 'L4',
            warnings: [],
            listeners: [],
          };
          store.onChange = (fn) => {
            store.listeners.push(fn);
            return () => {
              const i = store.listeners.indexOf(fn);
              if (i >= 0) store.listeners.splice(i, 1);
            };
          };
          store.emit = () => {
            for (const fn of [...store.listeners]) {
              try {
                fn();
              } catch {
                /* 单个订阅者出错不影响其它人 */
              }
            }
          };
          return store;
        }

        function adoptService(ctx, name, store) {
          const svc = readService(ctx, name);
          if (!svc) return false;
          store.services[name] = svc;
          store.caps[name] = true;
          store.emit();
          return true;
        }

        function softProbe(ctx, name, store) {
          if (adoptService(ctx, name, store)) return true;
          try {
            if (typeof ctx.inject === 'function') {
              ctx.inject([name], (child) => {
                adoptService(child, name, store);
              });
            }
          } catch (error) {
            store.warnings.push(String(name) + ': ' + String(error && error.message ? error.message : error));
          }
          return false;
        }

        function injectRegister(ctx, key, options, Component, store) {
          try {
            ctx.slots.inject(key, () => {
              try {
                ctx.slots.register(options, Component);
                console.info(`${TAG} 已注册 ${key}`);
              } catch (error) {
                store.warnings.push(String(key) + ': ' + String(error && error.message ? error.message : error));
                console.warn(`${TAG} register ${key} 失败`, error);
              }
            });
            return true;
          } catch (error) {
            store.warnings.push(String(key) + ': ' + String(error && error.message ? error.message : error));
            console.warn(`${TAG} inject ${key} 失败`, error);
            return false;
          }
        }

        /**
         * 降级演练开关（仅本地调试）：localStorage['dsh-session-cards/drill'] = {
         *   disableView, disableOverlay, disableHeader, disableSessions }
         * 用途：在没有旧版宿主的情况下，验证 L1/L2/L4 的降级路径不会白屏。
         */
        function readDrill() {
          try {
            const raw = localStorage.getItem('dsh-session-cards/drill');
            return raw ? JSON.parse(raw) || {} : {};
          } catch {
            return {};
          }
        }

        function createOverlayDrawer(Panel) {
          return function OverlayDrawer() {
            const [open, setOpen] = React.useState(true);
            if (!open) {
              return h(
                'button',
                {
                  type: 'button',
                  onClick: () => setOpen(true),
                  style: {
                    position: 'fixed',
                    right: 18,
                    bottom: 96,
                    zIndex: 40,
                    fontSize: 12,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                    background: 'var(--dsw-alias-bg-elevated, #1f2329)',
                    color: 'var(--dsw-alias-text-primary, inherit)',
                    cursor: 'pointer',
                    boxShadow: '0 8px 24px rgba(0,0,0,.24)',
                  },
                },
                '打开卡片桌布',
              );
            }
            return h(
              'div',
              {
                style: {
                  position: 'fixed',
                  right: 18,
                  top: 72,
                  bottom: 96,
                  width: 560,
                  maxWidth: 'calc(100vw - 36px)',
                  zIndex: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 14,
                  border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
                  background: 'var(--dsw-alias-bg-elevated, #171a1f)',
                  boxShadow: '0 16px 48px rgba(0,0,0,.35)',
                  overflow: 'hidden',
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.25))',
                    fontSize: 12,
                    color: 'var(--dsw-alias-text-secondary, #9aa4b2)',
                  },
                },
                h('span', { style: { flex: 1 } }, '卡片桌布 · 降级浮层（L1）'),
                h('button', { type: 'button', onClick: () => setOpen(false), style: { cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit' } }, '✕'),
              ),
              h('div', { style: { position: 'relative', flex: 1, minHeight: 0 } }, h(Panel)),
            );
          };
        }

        function HeaderFallback() {
          return h(
            'button',
            {
              type: 'button',
              title: 'dsh-session-cards（降级按钮）',
              onClick: () => console.info(`${TAG} L2 降级按钮被点击`),
              style: {
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.3))',
                background: 'transparent',
                color: 'var(--dsw-alias-text-secondary, #6b7280)',
                cursor: 'pointer',
              },
            },
            '卡片桌布',
          );
        }

        /**
         * P2 原生浮窗：窗口由自建 butler 进程创建，加载同一宿主 URL 并带 `#dsh-card=<sessionId>`。
         * 客户端检测到该 hash 就进入「浮窗模式」：隐藏外壳栏位、直接打开目标会话、不注册桌布页签。
         */
        const CARD_HASH = /#dsh-card=([^&]+)/;

        function cardSessionFromHash() {
          try {
            const m = CARD_HASH.exec(String(location.hash || ''));
            return m ? decodeURIComponent(m[1]) : null;
          } catch {
            return null;
          }
        }

        function applyFloatingWindow(ctx, sessionId) {
          try {
            document.documentElement.setAttribute('data-dsh-card-window', '1');
            const style = document.createElement('style');
            style.setAttribute('data-dsh-session-cards', 'floating');
            style.textContent = [
              'html[data-dsh-card-window] [data-pane="sidebar"]{display:none !important}',
              'html[data-dsh-card-window] [data-rightbar-col]{display:none !important}',
              'html[data-dsh-card-window] [data-shell-overlay]{display:none !important}',
            ].join('\\n');
            document.head.appendChild(style);
          } catch (error) {
            console.warn(`${TAG} 浮窗样式注入失败（可降级）`, error);
          }

          const showFloatingError = (message) => {
            try {
              const box = document.createElement('div');
              box.textContent = message;
              box.style.cssText = [
                'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
                'z-index:2147483001', 'padding:14px 18px', 'border-radius:12px',
                'background:var(--dsw-alias-bg-elevated, rgba(30,30,34,.92))',
                'color:var(--dsw-alias-text-secondary, #d7dae0)', 'font-size:13px',
                'border:1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
              ].join(';');
              document.body.appendChild(box);
            } catch {}
          };

          try {
            const back = document.createElement('button');
            back.type = 'button';
            back.textContent = '⤢ 回到画布';
            back.setAttribute('data-dsh-cards-back', '1');
            back.style.cssText = [
              'position:fixed', 'right:12px', 'top:52px', 'z-index:2147483000',
              'height:30px', 'padding:0 12px', 'border-radius:999px',
              'border:1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
              'background:var(--dsw-alias-bg-elevated, rgba(30,30,34,.86))',
              'color:var(--dsw-alias-text-secondary, #d7dae0)', 'font-size:12px', 'cursor:pointer',
              'box-shadow:0 6px 18px rgba(0,0,0,.28)',
            ].join(';');
            back.onclick = () => {
              try {
                fetch('/plugins/dsh-session-cards/popout/close', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId }),
                }).finally(() => {
                  try {
                    window.close();
                  } catch {}
                });
              } catch {
                try {
                  window.close();
                } catch {}
              }
            };
            document.body.appendChild(back);

            // 置顶开关：默认不置顶（卡片应能放在 desktop 旁边同时看），需要时手动钉住。
            const pinKey = 'dsh-session-cards/pin/' + sessionId;
            let pinned = false;
            try {
              pinned = localStorage.getItem(pinKey) === '1';
            } catch {}
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.setAttribute('data-dsh-cards-pin', '1');
            const paintPin = () => {
              pin.textContent = pinned ? '📌 已置顶' : '📌 置顶';
              pin.style.color = pinned
                ? 'var(--dsw-alias-text-accent, #7ea6ff)'
                : 'var(--dsw-alias-text-secondary, #d7dae0)';
              pin.title = pinned ? '取消置顶（回到普通窗口层）' : '置顶（窗口浮在所有应用之上）';
            };
            pin.style.cssText = [
              'position:fixed', 'right:12px', 'top:88px', 'z-index:2147483000',
              'height:28px', 'padding:0 10px', 'border-radius:999px',
              'border:1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
              'background:var(--dsw-alias-bg-elevated, rgba(30,30,34,.86))',
              'font-size:12px', 'cursor:pointer', 'box-shadow:0 6px 18px rgba(0,0,0,.28)',
            ].join(';');
            paintPin();
            const syncPin = (on) => {
              pinned = on;
              try {
                localStorage.setItem(pinKey, on ? '1' : '0');
              } catch {}
              paintPin();
            };
            pin.onclick = () => {
              const on = !pinned;
              syncPin(on);
              try {
                fetch('/plugins/dsh-session-cards/popout/top', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId, on }),
                }).catch(() => {});
              } catch {}
            };
            document.body.appendChild(pin);

            // 首次打开时按已保存的偏好恢复置顶状态。
            if (pinned) {
              try {
                fetch('/plugins/dsh-session-cards/popout/top', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId, on: true }),
                }).catch(() => {});
              } catch {}
            }
          } catch (error) {
            console.warn(`${TAG} 浮窗按钮注入失败（可降级）`, error);
          }

          ctx.inject(['uiWorkspace', 'sessions'], (c) => {
            let tries = 0;
            const tick = () => {
              let ready = true;
              try {
                const store = c.sessions && c.sessions.list;
                const snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null;
                ready = !snap || snap.phase === 'ready';
              } catch {
                ready = true;
              }
              if (ready) {
                try {
                  c.uiWorkspace.openSession(sessionId);
                  console.info(`${TAG} 浮窗已打开会话 ${sessionId}`);
                } catch (error) {
                  console.warn(`${TAG} 浮窗 openSession 失败`, error);
                  showFloatingError('会话不存在或已归档，无法在浮窗中打开');
                }
                return;
              }
              if (++tries < 40) {
                setTimeout(tick, 250);
                return;
              }
              showFloatingError('会话目录未就绪，浮窗退化为普通窗口');
            };
            tick();
          });
        }

        function apply(ctx) {
          const floatingSession = cardSessionFromHash();
          if (floatingSession) {
            applyFloatingWindow(ctx, floatingSession);
            return;
          }
          const store = createStore();
          const drill = readDrill();
          softProbe(ctx, 'theme', store);
          softProbe(ctx, 'sessions', store);
          if (drill.disableSessions) {
            store.caps.sessions = false;
            store.services.sessions = null;
          }

          const Panel = createBoardPanel(store);
          const Drawer = createOverlayDrawer(Panel);
          store.drill = drill;

          if (!drill.disableView && 
            injectRegister(
              ctx,
              'conversation.view',
              { name: 'conversation.view', id: 'session-cards', order: 20, label: () => '卡片桌布' },
              Panel,
              store,
            )
          ) {
            store.mode = 'L0';
            store.caps.mount = 'conversation.view';
            return;
          }

          if (
            !drill.disableOverlay &&
            injectRegister(ctx, 'shell.overlay', { name: 'shell.overlay', id: 'session-cards-overlay' }, Drawer, store)
          ) {
            store.mode = 'L1';
            store.caps.mount = 'shell.overlay';
            return;
          }

          if (
            !drill.disableHeader &&
            injectRegister(
              ctx,
              'conversation.session.header.actions',
              { name: 'conversation.session.header.actions', id: 'session-cards-action' },
              HeaderFallback,
              store,
            )
          ) {
            store.mode = 'L2';
            store.caps.mount = 'conversation.session.header.actions';
            return;
          }

          store.mode = 'L4';
          store.warnings.push('没有可用挂载点');
          console.warn(`${TAG} 没有可用挂载点，插件以 L4（不可用）运行`);
        }


        return { name: 'dsh-session-cards', inject: ['slots'], apply };
      },
    });
  } catch (error) {
    console.warn('[dsh-session-cards] client bundle 加载失败，已跳过', error);
  }
})();
