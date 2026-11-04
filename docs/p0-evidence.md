# P0 验证记录（2026-11-03）

P0 的目标只有四件事：**`conversation.view` 能否承载桌布、尺寸是否可测、主题服务可用、会话目录可用**，外加宿主 prompt 路由可用。全部通过。

## 环境

- 宿主：DSH NEXT 0.2.2（`/Applications/DSH NEXT.app/Contents/Resources/app.asar`）
- 隔离 profile：`~/.dsh/profiles/p0cards`（base + web-app + 本插件，**未改动 desktop profile**）
  - `package.json`：`dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`
  - `cordis.patch.yml`：`- insert: [{ id: dsh-session-cards, name: dsh-session-cards }]`
  - `node_modules/dsh-session-cards` → symlink 到本仓库，改代码后重载页面即可生效
- 启动：`dsh --profile p0cards --no-open --host 127.0.0.1 --port 17890`
- 浏览器：headless Chrome 156 + CDP（`Runtime.evaluate` 点击、`Page.captureScreenshot`）

## 结果

| 检查项 | 期望 | 实测 |
|---|---|---|
| 客户端 bundle 被加载 | 页面模块清单含 `dsh-session-cards/client.js` | ✅ 出现在 `plugins/??...` 清单 |
| slot 注册 | 控制台 `已注册 conversation.view` | ✅ `[dsh-session-cards] 已注册 conversation.view` |
| 页签可见 | 会话头部出现「卡片桌布」 | ✅ 与「对话 / 轨迹」并列，可点击切换 |
| 容器尺寸 | 宽高 > 0，且不覆盖输入区 | ✅ **1160 × 737 px**，输入区仍可见 |
| ResizeObserver | 可用 | ✅ |
| 主题服务 | `ctx.theme.getTheme()` | ✅ `system → dark` |
| 会话目录 | `ctx.sessions.list` 快照 | ✅ **703 个会话** |
| host prompt 路由 | 已注册且校验入参 | ✅ `POST /plugins/dsh-session-cards/prompt` → 400 `{"error":"sessionId is required"}` / `{"error":"session \"nope\" not found"}` |

证据截图：`docs/p0-panel.png`（L0 模式、1160×737、system→dark、703 会话）。

## 过程中修掉的坑

1. **client bundle 必须返回插件对象**：`window.__ModuleLoader__.load({ id, factory(require){ return { name, inject, apply } } })`。少了 `return`，宿主直接整页报错 `invalid plugin, expect function or object with an "apply" method, received undefined`。
2. **服务形态与猜测不同**：
   - `ctx.sessions.list` 是 **snapshot store**（`getSnapshot()` / `subscribe()`），不是返回数组的函数；状态形如 `{ ids, byId, current, phase }`。
   - `ctx.theme.getTheme()` 返回 `{ preference, active: { id, ... }, themes, revision }`，解析后的主题 id 在 `active.id`（不是 `resolvedId`）。
3. **host 与 client 的服务名一样，但注入是硬依赖**：`inject: ['slots', 'theme', 'sessions']` 才能直接读 `ctx.theme` / `ctx.sessions`。当前版本是硬注入（宿主若改名，插件不加载而不是降级）——**P1 要改成 `ctx.inject([...])` 软探测**，见待办。
4. 验收 UI 需要先关掉「预览版说明」弹窗并选中一个会话，`conversation.view` 才会挂载。

## 待办（P1 起步）

- [ ] 把硬注入改成软探测（`ctx.inject` 或能力位探测），保持「宿主升级只降级不白屏」的设计约束。
- [ ] 面板替换为真实桌布：`grid`/`matrix` 两形态 + 拖动交换 + 三态 + 持久化。
- [ ] 卡片数据接 `useSessions` 的 SessionMeta 投影（标题/运行态/轮次/token）。
- [ ] `prompt` 路由接真会话验证一次（发一条真实消息，确认归到目标 sessionId）。
- [ ] 刷新后恢复：验证 `conversationViews` 持久化把桌布页签记住。
