# P2 原生浮窗验证记录（2026-11-03）

目标：会话卡片能以**独立原生窗口**浮在桌面之上，且**窗口可拖动**（session-popout 的痛点）。

## 做法

1. 宿主插件拿不到 desktop 的私有 IPC，所以自建一个 **butler** 进程：
   `~/.dsh/electron/Electron.app/Contents/MacOS/Electron popout/main.cjs`
   只做「开窗 + 载入宿主公开 URL」，通过 `127.0.0.1:<随机端口>` + 一次性 token 与插件 host 通信。
2. 插件 host 侧（`index.js`）增加 `POST /plugins/dsh-session-cards/popout`：
   校验 `connection.requestRejection` → `ensureButler()`（复用 `~/.dsh/dsh-session-cards/butler.json`，10s 内 `/health` 就绪）→ 转发 `/open`。
3. 窗口加载 `http://127.0.0.1:<port>/?token=...#dsh-card=<sessionId>`；
   客户端检测到 hash 进入**浮窗模式**：隐藏侧栏/右栏、直接 `uiWorkspace.openSession(sessionId)`、不注册桌布页签。
4. **可拖动**：窗口使用 macOS 原生标题栏（`titleBarStyle: 'default'`），`movable: true`；标题自动跟随页面（`DSH · <会话标题>`）。
5. 置顶：`setAlwaysOnTop(true, 'floating')`，浮窗不会被主窗口盖住。

## 实测（隔离实例 17890 + 真机 screencapture）

| 检查项 | 结果 |
|---|---|
| 卡片「⧉ 弹出」按钮 | 点击后 `POPOUT-HTTP 200`，butler 自动拉起 |
| 原生窗口 | 出现，标题 `DSH · PSA项目实施监督 — DeepSeek Harness` |
| 可拖动 | `health.windows[0].movable === true`，原生标题栏可拖（截图见 `docs/p2-native.png`）|
| 可缩放 | `resizable === true` |
| 总会话内容 | 浮窗内直接打开目标会话，侧栏/右栏隐藏，输入区保留 |
| 置顶 | `alwaysOnTop`，主窗口在前时浮窗仍可见 |
| 降级 | 无 `~/.dsh/electron` → `501 NO_ELECTRON`；butler 起不来 → `503 BUTLER_TIMEOUT`；不影响主页面 |

## 已知问题

- 浮窗宽度 920 时宿主把侧栏降为 56px 图标轨道；CSS 只隐藏了展开态 `[data-pane="sidebar"]`，轨道还在（不影响使用，后续可加选择器）。
- 从 headless 浏览器触发时拿不到真实窗口坐标，会退到屏幕左上；真实使用（desktop/web 可视窗口）会用按钮中心坐标。
- butler 进程常驻（窗口全关也不退出），需要显式 `/shutdown` 或随宿主退出清理；当前实现尚未接退出清理。

## 追加：拖拽生成、回到画布、已弹出态、孤儿清理（同日）

- **拖拽生成**：在桌布上按住卡片拖到画布外松手 → 走 `popOut(card, {screenX,screenY})`，窗口出现在松手位置。
  自动化：CDP `Input.dispatchMouseEvent`（pressed → 3×moved → 移到 (60,40) → released）→ 日志出现 `POPOUT-HTTP 200`，butler 窗口创建成功。
- **回到画布**：浮窗右上角固定按钮「⤢ 回到画布」→ `window.close()`；原生红绿灯关闭同效。
- **已弹出态**：卡片上的 ⧉ 按钮在成功后变为强调色，title 改为「已弹出（再点可开新窗）」（CDP 实测 TITLE0 → TITLE1）。
- **孤儿清理**：butler 每 5s 检查 `DSH_BUTLER_PARENT` 是否存活，父进程消失即 `app.quit()`。
  实测：手动 butler 的父 shell 退出后 6s 内进程消失；用不存在的 pid 启动的 butler 也在 7s 内退出。
- **置顶**：`setAlwaysOnTop(true,'floating')`，主窗口在前时浮窗仍可见（截图 `docs/p2-native.png`）。

### 已知边界（如实记录）
- 浮窗保留宿主 56px 图标轨道（尝试用 `[class*="sidebarCol"]` 隐藏会连带压坏主列布局，已回退；只隐藏 `[data-pane="sidebar"]` 与右栏）。
- 从 headless 浏览器触发拿不到真实窗口坐标 → 退到屏幕原点；真实可视窗口里用按钮中心/松手点。
- 拖拽生成依赖 Pointer Events，触屏同样可用；拖到画布外才生成，拖到画布内仍是交换。

## 深入测试与修正（2026-11-03 第二轮）

| 发现的非合理点 | 实测现象 | 修正 |
|---|---|---|
| 并发弹出无互斥 | 5 个并发 POST → 起了 **5 个 butler**，只有 1 个成功，其余 `BUTLER_TIMEOUT` | `ensureButler` 加 in-flight promise 锁；实测 5 并发 → 1 个 butler、5 个请求全 200 且同一 windowId |
| 同会话重复弹窗 | 同 session 连点两次 → 两个窗口 | butler 按 sessionId 复用+聚焦，`/open` 返回 `reused` |
| info 文件全局共享 | 多 profile/多实例会互相覆盖 token | 改为 `butler-<sha1(origin)[0:10]>.json`；17891 实例（缺 Electron）不干扰 17890 |
| token 文件 0644 | `butler.json` 世界可读 | butler 与 host 写入都用 `mode: 0o600`（实测 `-rw-------`） |
| 关闭依赖 `window.close()` | 无法验证、也不可控 | 新增 `POST /plugins/dsh-session-cards/popout/close`（按 sessionId 关窗）；「回到画布」先走路由再兜底 close；实测健康列表从 2 窗减到 1 |
| 刷新后「已弹出」态丢失 | 按钮回到未弹出样式，但窗口还在 | 新增 `GET /popout/list`，桌布挂载时与每 15s 同步已弹出会话 |
| 拖出即弹窗过于敏感 | 拖到侧栏/输入区边缘就会开窗 | 阈值 24px + 拖动时显示「松手 → 弹出为独立窗口」提示 |
| 浮窗打开失败无反馈 | 会话不存在/目录未就绪 → 空白窗 | 浮窗内居中错误提示（实测缺会话时 `ERRBOX true`、`BACKBTN true`） |
| 弹出失败只有 console | 用户看不到 | 工具栏红字 5s 自动清除 |
| 窗口数量无上限 | 可无限开窗 | butler 上限 8，超限 429 |

安装前提与使用边界已写入 README。


## P3：位置记忆与拖回收回（2026-11-03 第三轮）

| 能力 | 实测 |
|---|---|
| 位置/尺寸记忆 | `/move` 到 (200,200) → `window-state.json` 记录；关闭后重开（不带坐标）→ `/health` 返回 bounds `{x:200,y:200,width:920,height:680}`；文件权限 `-rw-------` |
| 拖回主窗收回 | 带 `mainRect {0,0,800,600}` 打开后 `/move` 到 (100,100) → 窗口关闭，`/health.windows` 变空 |
| 去重不泄漏窗口 | 同一会话连开 5 次 → 全部返回同一 `windowId`，`/health` 只有 1 个窗口（修掉「先建窗后判重」导致的孤儿窗口） |
| 打开不被误收回 | 位置恢复后即使落在主窗矩形内，也不会在打开时触发收回（只在 `moved` 后判定） |

新增/修改：`popout/main.cjs`（状态文件、恢复与夹取、`/move`、去重前置）、`index.js`（`mainRect` 透传）、`src/client/ui.js`（上报主窗矩形、焦点时同步已弹出态）。
