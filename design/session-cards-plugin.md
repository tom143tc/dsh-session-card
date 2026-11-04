# DSH 会话卡片桌布（`dsh-session-cards`）· 调研与设计 v2

> 状态：调研 + 设计（未实施）
> 修订：v2（2026-11-03）——按最新交互要求改为「桌布占据会话详情画布」；主题三模式、卡片拖动互不遮挡、最大化/最小化/标准三态；原生浮窗降为增强项。
> 目标平台：DSH Desktop / DSH NEXT（Electron）+ 上游 DeepSeek Harness（Cordis 插件体系）
> 参考先例：`dsh-session-popout` v0.2.0、`dsh-multi-session` v0.3.3、`dsh-sessions-manager` v3.7.10（本机均已安装）
> 预览图：`preview/board-light.png`、`preview/board-dark.png`、`preview/board-max.png`（HTML 源：`preview/board.html`，第一版浮卡方案存档于 `preview/archive/`）

---

## 0. 结论摘要（TL;DR）

1. **主形态改为「画布内桌布」**：卡片桌布作为一个 `conversation.view` 页签，**占据会话详情画布**（左侧会话栏与最右侧详情栏保持不动）。这是上游公开 slot，`dsh-multi-session` 的「多会话」页签已验证同一机制。
2. **不替换 `conversation` 根 slot**：`conversation`（single）被 `ConversationRoot` 占用，注册进去会顶掉整个会话面（含输入区）并移除其声明的所有子座位；只适合做「桌布/会话」二选一的整机替换，代价太大。页签方案保留头部与宿主能力。
3. **卡片布局用网格化自由摆位**：画布按 `cell(340×180) + gap(16)` 分格，每格最多一张卡；拖动时卡片跟随指针、目标格显示占位影子，松手落格；压到已占格就**交换位置**（不推挤、不重叠）。「互不遮掩」由网格结构保证，不靠碰撞检测兜底。
4. **三态**：标准（1 格）、最小化（340×52 条，停靠画布底部的最小化栏）、最大化（铺满画布，独占一层，其余卡隐藏）。同一时刻至多一张最大化。
5. **主题三模式为必备**：白天 / 黑夜 / 随系统。走上游 `ctx.theme`（`setTheme('light'|'dark')` 与偏好 `system`）+ `--dsw-alias-*` token，不写死颜色；原生卡片窗（增强项）通过宿主路由同步同一偏好。
6. **原生浮窗仍保留**（P2）：把卡片「弹出到桌面」用 `dsh-session-popout` 验证过的 Electron 管家路线；但它是增强而非主路径——主路径不依赖任何非官方 API。
7. 分期：**P1 画布桌布（含拖拽/三态/主题）→ P2 原生弹出 → P3 打磨（自动整理、通知、与 popout 联动）**。
8. **抗升级是硬约束**：宿主（DSH / Desktop）升级后，插件最坏只能是「能力降级」，不能「不可用/白屏」。只依赖公开契约，所有宿主接触点收口到一个适配层，每个能力都可探测、可降级、可自检（见 §6.5）。

---

## 1. 需求

### 1.1 布局（本次核心）

当前 DSH（桌面端与网页版同构）：

```
┌──────────┬───────────────────────────────┬──────────────┐
│ 会话标题栏 │        会话详情画布            │  额外侧边栏   │
│ (sidebar) │  header + 对话流 + 输入区       │  (rightbar)  │
└──────────┴───────────────────────────────┴──────────────┘
```

期望：

```
┌──────────┬───────────────────────────────┬──────────────┐
│ 会话标题栏 │   卡片桌布（占据会话详情画布）   │  额外侧边栏   │
│          │  工具栏 + 可拖动卡片网格          │              │
└──────────┴───────────────────────────────┴──────────────┘
```

- 桌布**不出窗**、不遮挡侧栏，只接管中间画布；
- 右栏/底部面板展开导致画布变窄时，桌布允许**画布内适度的纵向滚动**（不横向滚、不裁切卡片）；
- 画布内卡片可拖动、互不遮掩；
- 卡片三态：最大化 / 最小化 / 标准；
- 主题：白天 / 黑夜 / 随系统。

### 1.2 用户故事

| # | 故事 | 优先级 |
|---|---|---|
| U1 | 切换「卡片桌布」页签，中间画布变成会话卡片桌，侧栏位置不变 | P1 |
| U2 | 卡片可拖动换位，任意两张卡不重叠、不出画布 | P1 |
| U3 | 卡片可最大化铺满画布、最小化成一条停靠栏、恢复标准尺寸 | P1 |
| U4 | 卡片状态与主题跟随系统/手动三模式切换 | P1 |
| U5 | 双击卡片进入该会话（切回「对话」页签并打开会话） | P1 |
| U6 | 从左侧会话栏拖一个会话进画布，直接生成一张卡片 | P1 |
| U7 | 把卡片弹出成桌面独立浮窗（可选，进阶） | P2 |

### 1.3 非目标

- 不替换整个应用外壳，不改左侧会话栏与右侧详情栏；
- 不接管会话生命周期（不长期 retain）；
- 不修改上游源码；不依赖 `desktopRuntime` 等私有 service。

---

## 2. 调研：平台能力与边界（结论摘要）

### 2.1 插件模型

- Host：`export const name / inject / apply(ctx)`；路由 `webServer.register({kind:'exact'|'prefix', path, handler})`，必须自调 `connection.requestRejection(req)` 鉴权。
- Client：`window.__ModuleLoader__.load({id, factory(require){...}})`；**不能 import**，只能 `React.createElement` + `styles.insert(css)` + `--dsw-alias-*` 主题变量；返回 `{ inject:['slots', ...], apply }`。
- 桌面端公开服务只有 `desktopProfiles` / `desktopPnpm` / `desktopWindow`（只读几何）；`desktopRuntime` 私有，**没有官方开窗 API**。

### 2.2 会话数据

- Client：`useSessions()`（SessionMeta：title/displayTitle/running/updatedAt/blank/cwd…；projections：tokenUsage、contextPressure、inbox、userQuestions、todos、sessionStats、modelSelection…）、`useWorkspaces()`。
- Host：`sessionQuery.observeSession`（~5ms）/ `readSurface`（兜底）/ `readSession` / `listEvents`；`ctx.sessions.list()`；动作走 `sessionController`（方法名待实测）。
- 注入型消息（`Current runtime context`、`Time sampled while`、`[Compressed conversation section]`、`<system-reminder>`）必须从摘要中剔除。

### 2.3 `conversation.view` 契约（本设计的挂载点）

来自上游 `packages/client/ui-conversation/src/client/contract/slots.ts`：

```ts
'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps }
```

- 「一个页签一个 list entry」，由会话 body 用 `only: <active id>` 一次只渲染一个；
- 注册：`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id:'session-cards', order:21, label:()=>'卡片桌布' }, BoardView))`；
- 页签由会话头部的 tab ring 渲染（`dsh-multi-session` 的「多会话」即此机制，order 20）；
- 视图内容占满会话 body 区域（画布），`scope:'session'` 表示需要当前选中会话；页面刷新后 `view` 状态回落到 Chat（`ChatStoreState.view` 语义），可接受。

### 2.4 先例要点（直接复用）

| 能力 | 先例做法 | 本设计取舍 |
|---|---|---|
| 侧栏拖拽识别 | document 捕获阶段 `dragstart/dragend`，`[data-row-key="session:<id>"]` | 直接复用 |
| 坐标兜底 | `dragend.screenX/Y` 为 0 时主进程 `screen.getCursorScreenPoint()` | 仅原生浮窗需要 |
| 会话打开 | `ctx.uiWorkspace.openSession(id)` | 双击卡片时用 |
| 多视图页签 | `conversation.view` + `id/order/label` | 主挂载点 |
| 主题 | `ctx.theme.getTheme()/setTheme(id)/subscribe('theme/change')`，`light/dark/system` | 工具栏切换用 |
| 原生浮窗 | 自起 Electron 管家（`~/.dsh/electron`）+ HTTP token | P2 增强 |

---

## 3. 方案取舍

| 方案 | 描述 | 判断 |
|---|---|---|
| **A. 画布页签（推荐）** | `conversation.view` 注册「卡片桌布」，占满会话 body | ✅ 主方案：保留侧栏/头部，风险低，先例可行 |
| B. 替换 `conversation` 根 slot | 整个中心列自绘 | ❌ 会移除输入区与所有子座位，失去聊天能力 |
| C. 应用内浮层 `shell.overlay` | 悬浮在应用之上 | ⚠️ 可选：做「专注桌布」全屏层，但会遮挡侧栏 |
| D. 原生独立窗口 | 每个会话一个系统窗口 | ⚠️ P2 增强：非官方 API，作为「弹出到桌面」 |

---

## 4. 详细设计

### 4.1 架构

```
┌──────────── DSH 主窗口（Electron renderer）────────────┐
│ 侧栏（宿主）                                            │
│  ┌───────────────────────────────────────────────┐     │
│  │ 会话头：标题 + 页签 [对话] [轨迹] [卡片桌布]     │     │
│  ├───────────────────────────────────────────────┤     │
│  │ client.js  BoardView（conversation.view）      │     │
│  │   ├─ Toolbar（主题/自动整理/新建）              │     │
│  │   ├─ Canvas（网格 + 卡片 + 拖动层 + 占位影子）   │     │
│  │   └─ Dock（最小化栏）                           │     │
│  └───────────────────────────────────────────────┘     │
│ 右侧栏（宿主）                                          │
└────────────────────────────────────────────────────────┘
        │ 数据：useSessions / useWorkspaces（实时）
        │ 动作：uiWorkspace.openSession / 宿主路由（P2）
        ▼
   Host（index.js）：卡片布局持久化、卡片摘要、P2 管家与路由
```

### 4.2 文件布局

```
dsh-session-cards/
├── package.json          # dsh 清单：bundle.patch + client
├── cordis.patch.yml
├── index.js              # Host：布局存储、摘要路由、P2 管家
├── client.js             # Client：BoardView、拖动、三态、主题
├── assets/board.css      # 可选：样式较多时放文件（或用 styles.insert）
└── README.md
```

数据：`~/.dsh/dsh-session-cards/board.json`（布局/三态/主题偏好；原子写）。

### 4.3 挂载与页签

```js
apply(ctx) {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'session-cards', order: 21, label: () => '卡片桌布' },
    BoardView,
  ))
  // 头部加一个「桌布」快捷按钮（可选）
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'session-cards-open', order: 80 },
    OpenBoardButton,
  ))
}
```

- 页签激活后，宿主会话 body 只渲染 BoardView（`only` 机制）；
- **输入区是否仍在**：取决于 body 结构（composer 可能挂在 body 外层）。实现时必须实测：若输入区仍显示，P1 先接受（可当作桌布的「新任务输入」）；若需要隐藏，只在 BoardView 内用 `useEffect` 给最近的 body 容器加 `data-board-active` 属性并注入 CSS（不改宿主 DOM 结构）。
- 切回「对话」页签即恢复聊天；双击卡片 → `uiWorkspace.openSession(id)` + 切回 chat 视图（通过 chat store 的 `view` 动作，或页签点击）。

### 4.4 桌布布局引擎（核心：不重叠 + 拖动）

**网格模型**

- 画布 `width` 由 `ResizeObserver` 测量；`cell = 340×180`，`gap = 16`，`padding = 20`；
- `cols = max(1, floor((W - padding*2 + gap) / (cell.w + gap)))`；
- 卡片位置用 `{col, row}`；每格最多一张卡 → **结构上不可能重叠**；
- 卡片可留空格（自由摆放），「自动整理」把卡片按顺序填满最前面的空格。

**拖动（Pointer Events，不用 HTML5 DnD）**

1. `pointerdown` 在卡片（排除按钮/输入）→ 记录起点，移动 >4px 才进入拖动（区分点击）；
2. 拖动时卡片 `position:fixed` 跟随指针（`transform: translate`，走 `requestAnimationFrame`）；
3. 指针位置换算成目标格：`col = round((x - pad) / (cellW + gap))`，`row = round((y - pad) / (cellH + gap))`；
4. 目标格被占 → 显示「交换」影子（两格高亮），松手执行交换；
5. 目标格空 → 显示占位虚线框，松手落位（300ms 过渡）；
6. 指针离开画布边界 → 取消拖动，卡片回原位（或 P2：弹出为桌面窗）；
7. 拖动中画布上下接近边缘自动滚动；`Esc` 取消。

**为什么用交换而不是推挤**：推挤会连锁重排（拖一张动一片），在网格里还会产生不可预测空位；交换是稳定、可撤销、用户预期明确的最小操作。

**三态**

| 状态 | 尺寸 | 行为 |
|---|---|---|
| 标准 | 1 格（340×180） | 网格内自由摆位/交换 |
| 最小化 | 340×52 | 从网格移除，停靠画布底部「最小化栏」横向排列；点击恢复 |
| 最大化 | 铺满画布（padding 内） | 独占覆盖层，其余卡片隐藏；`Esc`/按钮还原到原格 |

- 同一时刻最多一张最大化；
- 最大化时画布背景变暗（`rgba(0,0,0,.18)`，主题变量），只显示该卡；
- 三态变更都写入 `board.json`，刷新后恢复（最小化栏顺序保持）。

**卡片内容（标准态）**

```
┌─────────────────────────────┐
│ ▎ 状态色条 4px               │
│ 标题（2 行）          [⋯]   │
│ [进行中] [模型/工作区]        │
│ 最近一条消息摘要（2 行）       │
│ ◷ 19:42  ⟳ 6 轮  ◈ 12.4k   │
└─────────────────────────────┘
```

- 状态：待办（blank）/ 进行中（running）/ 待确认（inbox 或 userQuestions）/ 已完成（跑完且已看）；
- 悬停出操作：最大化 / 最小化 / 打开（双击等效）/ 更多（置顶到桌布首位、从桌布移除）；
- 卡片高度固定，超出用省略号；不滚动。

### 4.5 数据模型

```json
{
  "version": 2,
  "theme": "system",
  "autoArrange": false,
  "cards": [
    {
      "id": "c-…",
      "sessionId": "…",
      "col": 0, "row": 0,
      "state": "standard",
      "order": 0,
      "createdAt": "…", "updatedAt": "…"
    }
  ],
  "dock": ["c-…"],
  "maximized": null
}
```

- `state`: standard | minimized | maximized；
- `dock`: 最小化栏顺序；
- 会话被删除/归档 → 卡片进入「失效」态（灰显 + 移除按钮），不静默消失。

### 4.6 主题（白天 / 黑夜 / 随系统）

- **数据源**：`ctx.theme`（`ThemeRuntime`）：
  - `ctx.theme.getTheme()` → `{ preference: 'light'|'dark'|'system', resolvedId, ... }`
  - `ctx.theme.setTheme('light'|'dark')`；恢复跟随用 `setTheme('system')`
  - `ctx.theme.subscribe('theme/change', fn)` 实时刷新
- **样式**：全部走 `var(--dsw-alias-*)`（背景/边框/文字/强调），禁止字面量颜色；暗色下由宿主切换 `body[data-ds-dark-theme]`，插件自动跟随。
- **工具栏控件**：`[☀ 白天] [☾ 黑夜] [⌂ 随系统]` 三选一，写 `ctx.theme`（与设置里的外观一致，全局生效，用户不会困惑「为什么只有桌布变了」）。
- **卡片窗（P2）**：管家页面读宿主 `/theme` 路由（Host 从 settings 读 `ui-theme.preference`，system 用 butler 内 `matchMedia` 解析），首帧前写入 `data-ds-dark-theme`，避免闪白。

### 4.7 路由契约（Host，P2 需要；P1 仅布局存取）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/board` | 读/写 `board.json`（布局、主题、dock、maximized） |
| GET | `/cards` | 卡片 + 会话摘要（标题/状态/最近消息/统计） |
| POST | `/spawn` | P2：把卡片弹出成桌面浮窗 |
| POST | `/close` `/focus` | P2：关窗/聚焦 |
| GET | `/theme` | 当前主题偏好（卡片窗用） |

所有路由先 `connection.requestRejection(req)`。

### 4.8 双击/点击语义

- 单击卡片：选中（高亮边框，可拖动）；
- 双击卡片：`uiWorkspace.openSession(id)` + 切回「对话」页签；
- 悬停按钮：最大化/最小化/更多；
- 空白处单击：取消选中；双击：无操作（或「自动整理」）。

### 4.9 与宿主页签的关系

- 页签顺序：对话（默认）、轨迹（ui-trajectory）、卡片桌布（order 21）；
- 切走再切回：BoardView 保持本地状态（`useRef` + board.json），不闪烁；
- 刷新页面：宿主 `view` 回落到 Chat（上游语义），桌布布局仍从 `board.json` 恢复。

### 4.10 原生弹窗（P2 增强）

- 复用 `dsh-session-popout` 验证过的「Electron 管家」路线（本机 `~/.dsh/dsh-session-popout/butler.json` 有运行记录，macOS 可用）；
- 卡片「弹出到桌面」→ Host `/spawn` → 管家创建 `frame:false, transparent, alwaysOnTop, skipTaskbar` 窗口，加载轻量卡片页；
- 桌面浮窗与画布卡片共享 `board.json`（同一卡片两种呈现），拖回画布即收回；
- 降级：找不到 Electron 时按钮隐藏。

---

### 4.11 布局形态与自适应（v3 增补，回应 2026-11-03 新要求）

> **2026-11-03 用户拍板**：去掉「扑克形态」；右栏 / 底部面板展开导致画布变窄时，**允许适度的满屏（画布内）纵向滚动**。

**两种形态**（同一份数据，纯前端布局引擎切换，刷新后记住上次形态）：

| 形态 | 规则 | 说明 |
|---|---|---|
| `grid`（自由网格，默认） | 基准网格 340×180，按容器 fit，可拖到任意空格 | 拖拽落格/交换；放不下时纵向滚动（见下） |
| `matrix`（宫格墙／九宫格・十二宫格） | 画布**均分**为 3×3（≤9 张）或 3×4（10–12 张）等大格子，卡片铺满、无空位、不滚动 | 「一眼看全」形态；拖动 = 交换两格；卡片内部自动 compact 一档（标题单行、摘要两行、精简 footer） |

> 2026-11-03 更正：用户所说的「table」指**九宫格／十二宫格**这类宫格墙，不是数据表格；数据表形态已删除，不再实现。宫格列数按画布宽高比自适应：宽 <720 时退 2 列（2×5 / 2×6），仍铺满不滚动；cell <200 宽时提示切回 `grid`。

**一键自动排列**：工具栏下拉三种策略——`按更新时间`（倒序）、`运行中优先`（running 置顶，其余按更新时间）、`自定义优先`（用户拖拽设定的手动顺序）。排列结果立即写回 `board.json`；另有「恢复默认网格」一键重置。排序只改位置，不改卡片状态。

**自适应：先 fit，放不下就纵向滚动（fit-or-scroll）**

1. 用 `ResizeObserver` 测量 `viewArea` 的 `W×H`（扣除 padding 16、工具栏高度、dock 高度）；
2. `N = min(12, cards.length)`，枚举 `cols = 2..4`、`rows = ceil(N / cols)`；
3. `cell_w = (W - 2p - (cols-1)g) / cols`，`cell_h = (H - 2p - (rows-1)g - dockH) / rows`；
4. 若存在 `cell_w ≥ 240` 且 `cell_h ≥ 150` 的方案 → 取面积最大者，**fit 模式：一屏放下、不滚动**；
5. 否则进入 **scroll 模式**：cell 固定为舒适尺寸 `280×170`（下限 240×150），按 `cols` 算内容高度 `content_h = rows*(cell_h+g) - g`，画布内出现**唯一的纵向滚动容器**（`overflow-y:auto; overflow-x:hidden`），工具栏 `position:sticky; top:0`；
6. 卡片宽高全部由 CSS 变量驱动，**不用 `transform:scale`**——保证文字清晰、命中区与视觉一致。

**滚动规则（适度，不失控）**

- 只有纵向、只在画布内、永无横向滚动条；卡片永不裁切、永不重叠；
- 拖动时坐标以内容坐标系计算并 clamp 到 `[0, contentW-w] × [0, contentH-h]`；拖到容器上下边缘 24px 内自动滚动（autoscroll，4px/帧）；
- `shell.bottom` / 右栏开合只改变 `viewArea` 尺寸：先保留滚动位置，再按比例重排；不跳回顶部；
- 溢出超过约 2 屏时，工具栏出现轻提示「卡片较多，可点『自动排列』或移除部分卡片」——提示不阻断操作。

**上限与容量**：数据层硬限制 12 张；满 12 时「新建卡片」禁用并提示。滚动模式只解决「放不下」，不改上限。

**结论（更新）**：窄画布不再牺牲信息密度（不压成 compact），改为**保住可读尺寸 + 纵向滚动**；代价是「一眼看全」在窄画布上不成立——例如 1280 宽屏 + 右栏 360 打开时 center ≈ 640，3 列只有 ~194 宽，于是改用 2 列 280 宽、纵向约 6 行，约 2 屏滚动。**该取舍已由用户确认。**

**拖拽边界**：Pointer Events + `setPointerCapture`；位置 clamp；侧栏/右栏/底栏变化时重新 clamp；拖到画布外松手 → 回弹到最近合法位（不隐藏、不丢卡）。关闭按钮固定卡片右上角 28×28，始终在可见区，`z-index` 高于内容。

**最大化与独立输入区**（两条路，取 A）：

- 结构事实：composer 常驻在 `viewArea` 之外，是 viewArea 的兄弟（安装版 CSS `.viewArea{flex:1;min-height:0;display:flex}`，composerSeat 为同级 flex 项）→ 「最大化」只占 viewArea，宿主输入区仍在下方可见、不被遮挡。
- **方案 A（已拍板，2026-11-03）**：最大化卡片内自带输入框，插件 host 半新增 `POST /plugins/dsh-session-cards/prompt { sessionId, text }`，调用宿主 `sessions.prompt`（`packages/host/apiproxy/src/api/sessions.ts:347`；客户端另有 scope 版 `ctx.conversation.send`，但只作用于当前会话）→ 可给任意卡片发消息，不必切换会话。
- **方案 B（不推荐）**：借用宿主 composer，先 `sessions.open(id)` 切当前会话——会触发 per-session View 偏好恢复，可能跳出桌布页签；且切会话会改动用户上下文。
- 兜底：host 路由不可用时，卡片输入框禁用并提示「输入需要 P1 host 半」，不静默失败。

**不遮挡左/右/底部**（结构 + 变量保证）：

- 桌布挂在 center 列的 `conversation.view` 内；左 `sidebar`、右 `rightbar`、`shell.bottom` 都是 root 的独立轨道/行，天然不重叠；
- 最大化用 `position:absolute; inset:0`（相对 viewArea），**绝不 `position:fixed`**，也不使用 `100vw/100vh`；
- macOS desktop 额外避让 `--dsh-frame-leading-clearance`（左上窗口控件）与 `--dsh-frame-top-clearance`（48px），工具栏 `padding-left` 取该变量、取不到用 0；Windows 用 `--dsh-windows-sidebar-width` / caption 变量；
- `shell.bottom` 可见时列高由宿主缩短，ResizeObserver 自动重排，无需特判。

**desktop / web 同源**：全部是客户端插件能力（client slot + DOM + 公开服务），desktop 与 web 的差异只在 chrome/inset 变量与 `data-platform` 标记，不进入业务逻辑；本轮所有要求都不需要 Electron/原生窗口。

**可行性判定表（拍板后）**

| # | 要求 | 结论 | 依据 | 风险 |
|---|---|---|---|---|
| 1 | 一键自动排列（时间/运行中/自定义优先） | ✅ | 纯前端排序 + 写回 board.json | 低 |
| 2 | 宫格（matrix）形态 | ✅ | 均分画布 3×3 / 3×4，等大铺满，拖动=交换 | 极窄画布退 2 列；cell<200 提示切回 grid |
| 3 | 最大化独立输入区 | ✅ | host `sessions.prompt` 路由 | 与宿主 composer 并存，需文案区分 |
| 4 | 不遮左列表/右栏/底部面板 | ✅ | center 列内 absolute；root 其余轨道独立 | 无（只要不用 fixed） |
| 5 | 卡片上限 12 | ✅ | 数据层硬限制 + 满员禁用新建 | 无 |
| 6 | 空间不足时适度滚动 | ✅（已拍板） | fit-or-scroll：舒适尺寸 + 画布内纵向滚动 | 窄画布需约 2 屏滚动 |
| 7 | 拖拽不越界、始终可选中/关闭 | ✅ | clamp + autoscroll + 固定关闭键 | 低 |
| 8 | 随画布缩放 | ✅ | ResizeObserver + CSS 变量 | 小尺度可读性下降 |
| 9 | desktop / web 双端 | ✅ | 同源客户端能力，无原生依赖 | desktop pin 版本差异走 compat 探测 |

## 5. 关键流程

### 5.1 从会话栏拖入画布生成卡片

```
侧栏行 dragstart（data-row-key=session:<id>）
  → 拖到画布 dragover：显示占位格
  → 松手：计算目标格 → 新建卡片（board.json）→ 卡片入格
  → （可选）双击卡片进入会话
```

宿主侧栏拖拽会与它的排序手势竞争：捕获阶段判断是否落在画布区域内，落画布才 `preventDefault` 并接管（落在侧栏行则让宿主处理）。

### 5.2 最大化/还原

```
点最大化 → 记录原 col/row → state=maximized → 覆盖层渲染大卡（其他卡隐藏）
点还原/Esc → state=standard → 回原格；若原格被占（极端）→ 找最近空格
```

### 5.3 最小化停靠

```
点最小化 → state=minimized → 从网格移除 → 加入 dock 尾部（340×52 条）
点 dock 条 → state=standard → 回最近空格（原格优先）
```

---

## 6. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | `conversation.view` 页签的高度/滚动容器不理想（画布可能被外层滚动） | P0 先在真实 DSH 上注册空页签，量测容器尺寸；必要时用 `position:absolute; inset:0` + 外层 `overflow:hidden` 的局部补丁（只改自己视图内 DOM） |
| R2 | 输入区在桌布页签下仍显示 | P1 接受；若需隐藏，用 body 上的 `data-board-active` + CSS（不改宿主结构） |
| R3 | 拖动与宿主拖拽冲突 | 画布内用 Pointer Events（非 HTML5 DnD），不与宿主 DnD 竞争；侧栏拖入用捕获阶段 + 区域判定 |
| R4 | 网格在窄画布下退化 | `cols=1` 时卡片宽度自适应；最小宽度 280；横向滚动关闭 |
| R5 | 大数量卡片性能 | 单页最多 30 张；拖动只改 transform；resize 用 rAF 节流 |
| R6 | 主题闪白（刷新） | 首帧读 `ctx.theme.getTheme()`；HTML 侧由宿主 boot 脚本已处理，插件只消费 token |
| R7 | 页签刷新后回落 Chat | 接受（上游语义）；可用 `board.json` 记住「上次是否桌布」，进入会话时自动切换到桌布页签（P2，需谨慎避免抢夺） |
| R8 | **宿主升级导致 slot/服务/插件加载器变化**（最高风险） | 只注册 `conversation.view` / `conversation.session.header.actions` 两个公开 slot；加装适配层与四步降级（桌布页签 → 浮层抽屉 → 头部按钮模态 → 只读提示）；任何注册都 try/catch；升级后最坏是「降级 + 可见提示」，不白屏 |
| R9 | 主题服务或 `--dsw-alias-*` token 改名 | 所有颜色写成 `var(--dsw-alias-x, <兜底色>)`；`ctx.theme` 缺失时退回 `body[data-ds-dark-theme]` + `prefers-color-scheme` + MutationObserver |
| R10 | desktop 升级后第三方插件加载机制变化 | 插件无法自救加载器本身；对策=发布支持矩阵 + 升级后 48h 快速跟随 + 保留独立 web 端可用路径；不把核心能力绑在 desktop 私有 API 上 |

---

### 6.5 版本韧性与降级（抗升级，硬约束）

**目标**：DSH 或 Desktop 升级后，最坏结果是「能力降级 + 明确提示」，不是「插件不可用 / 白屏 / 报错 / 写坏数据」。

**三条原则**：只依赖公开契约；一切宿主接触点收口到一个适配层；每个能力可探测、可降级、可自检。

**依赖分级与策略**

| 级别 | 依赖 | 用法 | 升级风险 | 对策 |
|---|---|---|---|---|
| A 公开契约 | `ctx.slots.register/inject`、`conversation.view`、`conversation.session.header.actions`、`ctx.theme`、`useSessions`/`useWorkspaces`、`ctx.sessions`、`ctx.webServer`/`connection` | 唯一入口 | 中（重命名/签名变化） | 适配层收口 + 能力探测 + 降级阶梯 |
| B 半公开 | 宿主 DOM 锚点（`[data-pane]`、`data-row-key`）、`--dsw-alias-*` token | 只做增强，能不用就不用 | 高 | 全部 try/catch；样式一律带兜底值；取不到就 no-op |
| C 私有 | `desktopRuntime`、preload、Electron IPC、`dsh-desktop` 内部 class / 路由 hash | **不使用** | 极高 | 连 P2 原生浮窗也只走「自建进程 + 公开 webServer」，不碰私有 |

**适配层**：新增 `src/platform/compat.ts`，作为唯一 `import` 宿主包、唯一访问 `window`/DOM 锚点的地方。它导出：

```ts
type Capabilities = {
  hostVersion: string | null;      // 探测不到=null，不猜
  boardSlot: boolean;              // conversation.view 可用
  headerActions: boolean;          // 头部按钮 slot 可用
  overlaySlot: boolean;            // shell.overlay 可用（降级用）
  theme: boolean;                  // ctx.theme 可用
  sessions: boolean;               // useSessions / ctx.sessions 可用
  persistence: 'file' | 'local' | 'memory';
  warnings: string[];
};
```

其余模块不直接接触宿主，只读 `capabilities` 决定渲染路径。

**降级阶梯（每一级都必须能渲染，不许白屏）**

| 级别 | 触发 | 行为 |
|---|---|---|
| L0 完整 | `boardSlot` | 桌布作为 `conversation.view` 页签，全功能 |
| L1 浮层 | `boardSlot=false`、`overlaySlot=true` | 同一套 `Board` 组件挂在 `shell.overlay` 的右侧抽屉；顶部一条「当前版本以浮层模式运行」提示；数据/拖拽/三态照常 |
| L2 模态 | 两个 slot 都不可用、`headerActions=true` | 会话头部按钮打开全屏模态（宿主 slot 内自渲染） |
| L3 只读 | `sessions=false` 或注册持续失败 | 只显示会话标题+状态；禁用拖拽与所有写操作，避免写坏布局 |
| L4 不可用 | 连 `headerActions` 也注册失败 | 不注册任何 UI；写 `compat-report.json`，在插件设置里展示「不支持当前版本」+ 原因 + 上报入口 |

**防升级的四条硬规则**

1. **不 patch**：不改宿主文件、不 monkey-patch `ctx`、不替换 `conversation` 根 slot、不改宿主 DOM 结构（只改自己视图内的节点）。
2. **不猜内部**：不依赖 `dsh-desktop` 的内部 class 名、URL hash、`data-platform` 语义；不假设 `dsh-session-popout` 的管家存在。
3. **不假设插件**：不依赖 `dsh-multi-session`、`dsh-sessions-manager` 等第三方插件在场；它们是「同生态参照」，不是运行时依赖。
4. **数据自持**：卡片布局、折叠状态存在插件自己的数据文件（`<dataDir>/session-cards/board.json`），`localStorage` 仅作兜底；升级不会因为宿主存储结构变化而丢布局。

**升级验证（发布前必须跑）**

- 能力自检：设置页展示 `hostVersion` + `Capabilities` + 降级原因，用户可一键复制诊断信息。
- 冒烟脚本（对 **当前版本 / 上一个 minor / beta（能装则装）** 各跑一遍）：注册成功 → 渲染 6 张卡 → 主题三态切换 → 拖动落格 → 刷新恢复。
- 双端矩阵：**desktop 与 web 各跑一遍**（同一套 client 代码，验证没有偷偷依赖 Electron）。
- 人工回归：真实桌面端 + 浏览器各点一遍三态与拖动；升级前后各一次，记录支持矩阵。

**诚实边界**：如果宿主连「第三方插件加载协议」本身都改了，插件无法自救——这部分只能快速跟随 + 发布支持矩阵 + 在 README 标注已支持版本区间。§6 的 R8/R10 已把该风险列为最高等级，不假装能 100% 免疫。


## 7. 分期

### P0 · 验证（0.5–1 天）

- 先做 `compat.ts` 的 `probe()`：打印 hostVersion 与 `Capabilities`，确认 A 级依赖全部存在（不存在就先设计降级，不进入 P1）。
1. 注册空 `conversation.view` 页签，占满画布，量测尺寸/滚动；
2. 验证页签切换、`only` 行为、输入区是否仍在；
3. 验证 `ctx.theme` 读取/切换与 token 跟随；
4. 验证 `useSessions` 在视图内可用（scope session）。

### P1 · 画布桌布 MVP
- 页签 + 工具栏（主题三态、自动整理）；
- 卡片渲染（标题/状态/摘要/统计）；
- 网格布局 + 拖动 + 交换 + 不重叠；
- 三态（标准/最小化/最大化）；
- 从侧栏拖入生成卡片；双击打开会话；
- `board.json` 持久化；
- 亮/暗/系统三主题。

### P2 · 增强
- 「弹出到桌面」原生浮窗（butler 路线）；
- 自动整理动画、键盘操作（Tab/方向键移动卡片）、多选；
- 通知（会话跑完/待确认时卡片高亮）；
- 与 `dsh-session-popout` 联动（最大化即完整会话）。

### P3 · 打磨
- 布局模板（按工作区分组、按状态分列）；
- 卡片尺寸档（S/M/L）；
- 跨显示器/缩放适配；
- 主题材质（`desktopWindow.material`）。

---

## 8. 待拍板（已随实现收敛，2026-11-03）

> 已拍板：去掉扑克形态；空间不足允许画布内纵向滚动；最大化输入区采用**方案 A**（卡内输入，不切会话）；抗升级为硬约束。

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | 桌布页签是否默认打开 | **不默认**，保留「对话」为默认页签，用户切到「卡片桌布」后按 `conversationViews` 记忆 | 不改变宿主既有心智；P1 实测刷新后页签可自动恢复 |
| 2 | 最大化是否隐藏侧栏（专注模式） | **不隐藏**，最大化只占 `viewArea` | 隐藏侧栏会动宿主布局，属于越权；保留侧栏还能继续切换会话 |
| 3 | 最小化栏位置 | **画布底部 dock** | 与预览一致；右侧竖排会和宿主右栏争夺空间 |
| 4 | 卡片字段 | 标题 / 状态 / 工作区 / 时间 + 最小化·最大化按钮；**轮次与 Token 仅在宿主提供 `projectionValues` 时追加**，不做重查询 | 安装版列表行的 `projectionValues` 不保证带 `sessionStats`，为此拉整份日志不划算 |
| 5 | 原生浮窗（P2） | **已实现**（2026-11-03）：butler 进程 + 公开 webServer；卡片「⧉」或**拖到画布外松手**生成窗口；原生标题栏可拖动、置顶、可缩放；「⤢ 回到画布」关闭；已弹出态标记；父进程消失自动退出；证据 `docs/p2-evidence.md` | 第三方插件只有公开 `desktopWindow` 只读几何，所以自建 Electron 进程；窗口用 macOS 原生标题栏保证可拖动（session-popout 用 hiddenInset 导致拖不动） |

实现状态：P0（页签/尺寸/主题/会话目录/host prompt 路由）与 P1（两形态、拖动交换、三态、持久化、刷新补卡、L0–L4 降级演练）均已实测通过，证据见 `docs/p0-evidence.md`、`docs/p1-evidence.md`。

---

## 9. 参考

- `~/.dsh/profiles/desktop/node_modules/dsh-multi-session/`（`conversation.view` 用法、数据 hooks）
- `~/.dsh/profiles/desktop/node_modules/dsh-session-popout/`（拖拽、Electron 管家、主题同步）
- 上游：`packages/client/ui-conversation/src/client/contract/slots.ts`（`conversation.view` 契约）
- 上游：`packages/client/ui-theme/src/client/index.ts`（`ctx.theme` 运行时）
- 上游：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`（slot 全表）
- 桌面端契约：`anywhere-labs/dsh-desktop` → `dsh-plugin-desktop/docs/plugin-services.zh.md`

---

## 10. 预览

- 亮色：`preview/board-light.png`
- 暗色：`preview/board-dark.png`
- 最大化：`preview/board-max.png`
- 源文件：`preview/board.html`（`?theme=light|dark&state=max`）

## 4.12 原生浮窗（P2/P3 实现状态）

- 由一个自建 Electron 管家进程（`popout/main.cjs`）持有所有浮窗；宿主侧只经 `POST /plugins/dsh-session-cards/popout`（含 `sessionId`、`x/y`、`mainRect`）转发，不使用 desktop 私有 IPC。
- 浮窗加载 `宿主URL#dsh-card=<sessionId>`，客户端进入浮窗模式（隐藏右栏、收窄侧栏、直接打开该会话）。
- **位置/尺寸记忆**：`window-state.json`（0600）按 sessionId 存 bounds；打开时优先恢复，越界则夹回工作区。
- **拖回主窗即收回**：`moved` 事件后若窗口中心落入主窗矩形则关闭；主窗矩形由客户端在弹窗请求里上报。
- **可测试性**：butler 提供 `/health`（含每个窗口的 bounds 与 sessionId）、`/move`（宿主机自动化用）、`/close`（按 sessionId 或 windowId）。
- 窗口上限 8；同会话复用；关闭走 `POST /popout/close`，刷新后由 `GET /popout/list` 同步「已弹出」态。

