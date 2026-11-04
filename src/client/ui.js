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
