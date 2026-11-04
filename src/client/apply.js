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
