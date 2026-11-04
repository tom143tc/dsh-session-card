# 需求核对表（逐条）

> 依据：本轮对话中你提出的全部要求（v2/v3 设计、P1/P2/P3、后续 9 次迭代）。
> 结果列：✅ 通过（附证据）/ ⚠️ 部分 / ❌ 不通过。
> 本表对应版本：**0.2.13**。

## A. 桌布与布局

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| A1 | 桌布占据会话详情画布，而不是弹窗/浮层 | `conversation.view` 页签（`card-board`），会话 body 用 `only` 渲染 | P0 证据 `p0-panel.png`；容器 1160×737 | ✅ |
| A2 | 不替换整个会话面，输入区保留 | 只注册 `conversation.view`，未碰 `conversation` 根 slot | P0/P1 截图，底部输入区始终在 | ✅ |
| A3 | 左侧会话栏、右侧栏保留，卡片不遮左右底 | 桌布在 center 列内，absolute 相对 viewArea | CDP 布局检查；截图 | ✅ |
| A4 | 网格形态：卡片可拖、互不遮掩、落格交换 | `grid` + pointer 拖动 + `swapItems` | CDP 真 pointer：`[A,B,C] → [B,A,C]` 并落盘 | ✅ |
| A5 | 宫格形态：九宫格/十二宫格，等大铺满 | `matrix`：≤9→3×3，10–12→3×4，窄屏 2 列 | 截图 `p1-matrix10.png`，`repeat(3,…)` | ✅ |
| A6 | 卡片最多 12 张 | `MAX_CARDS=12`，`addCard` 返回 `limit` | 单测 `board.test.mjs` | ✅ |
| A7 | 卡片随画布缩放 | `ResizeObserver` 测宽 + `auto-fill minmax(260px,1fr)` | 缩小窗口列数变化 | ✅ |
| A8 | 打开时桌布应为空，由用户自己拖入 | 删除自动 seed；空态文案 | CDP：空态 `0 张卡片` + 提示 | ✅ |
| A9 | 从左侧会话列表拖入；加卡入口 | `dragstart` 读 `[data-row-key^="session:"]` + `＋ 当前会话` | 合成拖拽 2 张成功；真实拖拽可用 | ✅ |
| A10 | 点「刷新」不能把未拖入的会话变成卡片 | `refreshCards` 只更新已有卡片、清理已删会话、不新增 | CDP：刷新前 1 → 刷新后 1（修复前为 12） | ✅ |
| A11 | 卡片可关闭 | 悬停条 `✕` → `closeCard` | CDP：2→1，localStorage 同步 | ✅ |
| A12 | 卡片可拖大小 | `◢` 手柄，跨度 1–4，持久化 | CDP：rows 1→2，`[{cols:1,rows:2}]` | ✅ |
| A13 | 三态：标准/最小化/最大化，Esc 还原 | `minimized` + `maximizedId` | CDP：min=1、max 落盘、Esc 清空 | ✅ |
| A14 | **最大化后右上角不应有两个 ✕**（还原应换图标） | 还原=`⤡`（title「还原大小（Esc）」），移除=`✕` | 本轮 CDP：最大化按钮组 `["—","⧉","⤡","✕"]` | ✅ |
| A15 | 新卡片默认尺寸跟随当前桌布 | `dominantSpan()` + 三个加卡入口 | CDP：`["2x2","2x2"]` + 新卡 → `2x2` | ✅ |

## B. 卡片内容与交互

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| B1 | 卡片要带原本的对话记录 | host `GET /transcript`（`sessionQuery.readSession`）→ 用户气泡/助手正文/工具行 | 截图 `board8.png`；过滤注入上下文 | ✅ |
| B2 | 按尺寸决定展示多少 | `cap = max?12 : hovered?rows*2 : 1` | CDP：rows 1→2 条数变化 | ✅ |
| B3 | 每张卡片有自己的输入框 | 卡内输入行 → `POST /prompt`（sessionId 定向） | CDP：payload `{sessionId,text,mode:'queue'}`，发送后清空 | ✅ |
| B4 | 输入框「悬停才出现」；默认只显示最后一行对话 | `inputVisible` 依赖 hover/focus/草稿；非悬停 `cap=1` | CDP：`IDLE input:false` → `HOVER input:true` | ✅ |
| B5 | 夜间模式悬停按钮要清楚（近白） | `isDarkTheme()`：夜间 `#f7f7fa` / `rgba(255,255,255,.16)` / 描边 `.30`；浅色深字 | CDP dark：`rgb(247,247,250)`；截图 | ✅ |
| B6 | 悬停按钮不要压住标题 | 悬停时标题 `paddingRight:104px` | 截图 bt-dark.png | ✅ |

## C. 主题

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| C1 | 白天/黑夜/随系统 | 全部走 `--dsw-alias-*` token + `isDarkTheme()` 读 `colorScheme` | `Emulation.setEmulatedMedia` 切换验证浅色/夜间 | ✅ |

## D. 原生浮窗

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| D1 | 自建管家，不用 desktop 私有能力（抗升级） | `popout/main.cjs` + 公开 `webServer/connection`；`ELECTRON_RUN_AS_NODE` 剥离 | P2 证据 | ✅ |
| D2 | 窗口可拖动 | `titleBarStyle:'default'` 原生标题栏 | `/health` `movable:true`；真机截图 | ✅ |
| D3 | 置顶 | `setAlwaysOnTop(true,'floating')` | 真机截图 | ✅ |
| D4 | 同一会话去重、最多 8 窗 | `bySession` + `MAX_WINDOWS=8` | 连开 5 次 → 同一 windowId | ✅ |
| D5 | 位置/尺寸记忆 | `window-state.json`（0600） | 移动到 (200,200) 后重开恢复 | ✅ |
| D6 | 拖回主窗自动收回 | 仅 `will-move` 后 arm 才判定；打开时不误触发 | 本轮：arm 后移入主窗 → `windows:[]` | ✅ |
| D7 | **浮窗不能刚打开就消失** | 根因：打开/定位也会触发 `moved` → 中心落在主窗内被自动关闭。改为「用户拖动过才 arm」 | 本轮：打开后 `/health` 仍有窗口，未自动关闭 | ✅ |
| D8 | 关闭/回到画布与桌布状态同步 | `POST /popout/close` + 15s `GET /popout/list` 同步「已弹出」 | 关窗后按钮 title 恢复 | ✅ |
| D9 | 失败要明确提示 | `NO_ELECTRON` 501、会话不存在提示框、`popout-error.log` | 17891 实例无 Electron → `NO_ELECTRON`；不存在会话 → 错误框 | ✅ |

## E. 抗升级

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| E1 | 不因 DSH/desktop 升级直接不可用 | 软探测 `ctx.inject`；L0→L4 降级；L4 不注册 UI | drill 演练：L1 浮层 / L2 头部按钮 / L3 只读 / L4 不注册 | ✅ |
| E2 | 只依赖公开契约 | 适配层集中 `Capabilities`，不碰私有 IPC/class | 设计 §6.5 + 代码走查 | ✅ |

## F. 工程纪律

| # | 你的要求 | 实现 | 验证 | 结果 |
|---|---|---|---|---|
| F1 | 测试先行 | 纯函数单测 + CDP 端到端 | `node --test test/` 34 pass | ✅ |
| F2 | 每阶段可验证证据 | `docs/p0-evidence.md`、`p1-evidence.md`、`p2-evidence.md` | 已归档 | ✅ |

## 本轮新修的两个问题

1. **最大化两个 ✕** → 还原改为 `⤡`，只有移除是 `✕`（A14）。
2. **悬浮窗刚打开就消失** → 根因是 butler 把「打开时的 moved」误判成「用户拖回主窗」，立即关闭；改为 `will-move`（用户真正拖动）才 arm，并加 900ms 保护（D6/D7）。

## 本轮复测记录（0.2.13，隔离实例 + CDP）

| 检查 | 结果 |
|---|---|
| 空桌布提示 | `empty: true` |
| ＋ 当前会话 | `{n:1, form:'grid'}` |
| 普通卡按钮 | `["—","⧉","⤢","✕","↑"]` |
| 最大化卡按钮 | `["—","⧉","⤡","✕","发送","↑"]`（还原=⤡、移除=✕） |
| Esc 退出最大化 | `maximizedId: null` |
| 最小化 | `min: 1`（再次点击还原） |
| 刷新 | 刷新前后均 `n: 1`（不新增） |
| 宫格形态 | `12 张 → 3 列 × 4 行` |
| 12 张上限 | 第 13 次添加后仍 `n: 12` |
| 浮窗打开 | 打开后 `/health` 仍有窗口（不再自动消失） |
| 拖回主窗收回 | arm 后移入主窗 → `windows: []` |

未在本轮重复执行、但已有历史证据的项：真实侧栏拖入（P1）、卡片拖大小（P1）、夜间按钮配色（0.2.9 CDP 读数）、三主题切换（P1 `Emulation.setEmulatedMedia`）、L0–L4 降级演练（P1 drill）。

## 诚实边界

- 侧栏拖入用的是宿主 HTML5 DnD，自动化只能合成事件验证写入逻辑；真实鼠标拖拽需人工确认。
- Windows/Linux 未测；目前只在 macOS + Electron 44.7.0 上验证。
- 若 DSH 改变第三方插件加载协议本身，插件只能跟随升级，无法自救（设计 §6.5 已写明）。

## 0.3.0 增补（本轮反馈）

| 反馈 | 根因 | 修法 | 验证 |
|---|---|---|---|
| 卡片内文字样式要优化 | 正文直接显示原始 markdown（`**…**`、`` `code` ``）且行距偏紧 | 新增 `mdInline()`：`**粗体**`→`<strong>`、`` `code` ``→等宽小底块；正文 11.8px / 行高 1.62 / 字距 .1；用户气泡 11.5px、行高 1.55、圆角 10 | CDP：`strong:true, code:true, raw:false`；截图 card5.png |
| 拖动改尺寸没了 | 悬停出现的输入行在正常流里占住卡片底部，把右下角 `◢` 手柄盖住/挤出 | 输入行改为**绝对定位底部浮层**（body 预留 40px），手柄 `zIndex:6` 且输入出现时上移到 `bottom:42` | CDP：手柄拖拽 1×1 → 2×2 并落盘 |
| 悬停对话框消失 | 同上：输入行在 1×1/1×2 卡片里被 flex 挤到可视区外 | 同上的绝对浮层方案，输入框始终可见 | CDP hover：`input:true`；截图 card4.png |
| 拖进桌布默认大小不对 | `dominantSpan()` 让新卡继承桌布里某种跨度（常有 2×2），不是标准尺寸 | 加卡（拖入/＋当前会话）固定 `1×1`；需要大卡由用户拖手柄 | 代码走查 + 新的卡片按 1×1 落盘 |

## 0.3.3 增补（宫格↔网格联动 + 缩放联动）

| 反馈 | 实现 | 验证 |
|---|---|---|
| 宫格要能「退出到网格」 | 宫格卡片也显示右下角 `◢`；开始拖动时若当前是 `matrix`，先 `setForm('grid')` 再改跨度 | CDP：`before form=matrix` → 拖手柄 → `after form=grid, span=2x1` |
| 一个卡片调大，其他要对应缩小 | 新增 `planRows(cards, cols)`（按跨度模拟自动排布算总行数）；网格行高改为动态 `rowH = clamp((可视高 - gap)/总行数, 128, 180)`，卡片变大→行数增加→每格变小 | CDP：`autoRow 128px`（12 张里 1 张 2×1 时） |
| 悬停输入框 / 尺寸手柄在宫格里没有 | 根因：宫格卡片以 `small`（compact）渲染，`inputVisible` 与手柄都被关掉 | 宫格改用 `normal` 渲染；实测宫格内 hover 出现输入框、手柄可拖 |

## 0.3.4 修复（最大化两个输入框）

| 反馈 | 根因 | 修法 |
|---|---|---|
| 卡片最大化后看到两个对话框 | 最大化卡自带 textarea + 发送按钮；同时底部通用输入行（悬停浮层）在 `size==='max'` 时也被条件渲染，于是同一张卡里出现两个输入框 | 通用输入行改为 `size === 'max' || !inputVisible ? null`，最大化只保留卡片自己的输入框 |

CDP 复测：`{card:true, count:1, ph:["发送到本卡片会话…"]}`；截图 `max1.png`；`node --test` 34 pass；0.3.4 已装 desktop profile。

## 0.3.5 调整尺寸手感（拖动是否丝滑）

| 问题 | 根因 | 改法 | 实测 |
|---|---|---|---|
| 拖动改尺寸不丝滑 | 每个 `pointermove` 都 `setBoard` → 整桌布重渲染；`saveBoard` 的 effect 又同步 `JSON.stringify + localStorage.setItem`，每移动一次写一遍 | ①拖动期只更新轻量 `resizePreview`（rAF 合并，仅跨度整数变化时更新），**不写 board**；②松手时一次性 `setCardSpan` 提交；③持久化 debounce 250ms；④拖动时显示 `N × M` 尺寸角标、`cursor:nwse-resize`、`user-select:none`；⑤靠近网格上下边缘自动滚动 | 拖动中 `localStorage` 写入 **0** 次、角标 `2×2 → 2×3 → 3×3`；松手后写入 1 次、`span=3x3` |

## 0.3.6 浮窗不再强制置顶（可离开 desktop 范围）

| 反馈 | 根因 | 改法 | 实测 |
|---|---|---|---|
| 浮窗一直遮挡 desktop，只能看到一个窗口 | butler 打开窗口时无条件 `setAlwaysOnTop(true,'floating')`，且默认尺寸 920×680，几乎盖满主窗 | ①默认**不置顶**，改为普通窗口层；②默认尺寸 520×420（最小 360×280），可自由缩放；③多开时按 +28px 级联错开；④浮窗内新增「📌 置顶」开关（按会话记住偏好）；⑤窗口是独立 OS 窗口，原生标题栏可拖到桌面任意位置 | `/health` 两个窗口 `alwaysOnTop:false`、bounds 分别为 520×420 与级联位置；`/top?on=1` 后该窗 `alwaysOnTop:true` |

## 0.3.7 记住当前尺寸，设为默认

| 对象 | 存储位置 | 行为 | 实测 |
|---|---|---|---|
| 桌布卡片 | `localStorage['dsh-session-cards/default-span/v1']` | 手动拖动缩放过的那张卡（最后一次）的跨度被记住；之后「＋ 当前会话」与侧栏拖入都按该跨度建卡（上限仍 4×4） | 拖成 `2×2` → 删除该卡 → 重新加当前会话 → 新卡 `2×2` |
| 原生浮窗 | `~/.dsh/dsh-session-cards/window-state.json` 的 `__defaultSize` | 窗口被用户调整尺寸后记录最近一次宽高；新会话首次弹窗用它作默认尺寸（已有记忆的会话仍恢复自己的 bounds） | 注入 `700×520` → 新窗 `/health` 返回 `700×520` |

## 0.3.8 悬停输入框（显示 + 录入）

| 反馈 | 改法 | 实测 |
|---|---|---|
| 悬停对话框不好用；不该在放大/缩小图标下方 | ①默认完全隐藏（有草稿也不再常驻，移开鼠标即收起，草稿保留）；②输入条改为**底部内嵌浮条**（left/right/bottom 各 8px、圆角、描边、阴影、`z-index:7`），与右上角操作按钮在几何上分离；③正文底部预留 52px，末行不被盖 | 几何：输入条 `top 275 / bottom 295`，按钮行 `top 139 / bottom 163`，`overlap=false` |
| 录入方式 | `input` → `textarea`：Enter 发送、Shift+Enter 换行、自动增高（最多约 3 行，发送后复位）；中文输入法组合期（`isComposing` / `keyCode 229`）的 Enter 不再误发送 | placeholder `回复…（Enter 发送）`；CDP 输入文字后请求体正常 |

## 0.3.9 悬停输入条收回卡片内

| 反馈 | 根因 | 改法 | 实测 |
|---|---|---|---|
| 悬停输入框跑到卡片外、压住右下角 `◢` | 输入条 `left/right/bottom:8` 通栏，且手柄在输入可见时上移到 42px，长草稿把输入条撑高后正好盖住手柄 | ①输入条右侧缩到 `right:30`，给手柄留出独立一列；②手柄固定回右下角 `bottom:0`，不再浮动；③textarea 最大高度收到 52px（约 3 行）；④正文底部预留 46px | `card(l296,r664)`、`bar(l305,r633)`、`handle(l647,r663)`：`inside=true`、`overlap=false` |

## 0.3.10 悬停输入条跟随暗色

| 反馈 | 改法 | 实测（computed style） |
|---|---|---|
| 输入框颜色没跟系统暗色 | ①新增 `dark` 状态，来源 `isDarkTheme()`（`colorScheme` → `body[data-ds-dark-theme]` → `prefers-color-scheme`），并用 `MutationObserver` + `matchMedia('change')` 跟随切换；②输入条/发送按钮/占位符都给了明暗两套显式色值（不再依赖可能缺失的 `--dsw-alias-*`） | 暗：`barBg rgba(34,34,39,.97)`、`border rgba(255,255,255,.16)`、`text rgb(244,244,246)`、按钮底 `rgba(255,255,255,.18)`；亮：`barBg rgba(255,255,255,.98)`、`border rgba(15,23,42,.14)`、`text rgb(31,35,40)` |

## 0.3.11/0.3.12 边缘拖拽改尺寸（原生窗口手感）

| 反馈 | 实现 | 实测 |
|---|---|---|
| 不想非得抓 `◢` 图标，悬停边缘按左键即可缩放 | 卡片四边/四角各 8px 命中区：`ew-resize` / `ns-resize` / `nwse-resize` / `nesw-resize` 光标；在命中区内 `pointerdown` 直接进入 resize（优先于整卡拖动），拖动按「跨过几个格子」计算（`cols0 + round(Δx/cellW)`），支持左/上边缘反向增减；`◢` 仍保留作为视觉提示 | `1×1` → 右边缘拖 +250 → `2×1`；下边缘拖 +200 → `2×2`；左边缘拖 -200 → `3×2`；光标 `ew-resize`（左右）与 `ns-resize`（上下）均正确 |

## 0.4.x 自由布局（自由定位）

| 项 | 实现 |
|---|---|
| 开关 | 工具栏新增「◱ 自由」，`board.form='free'`；从网格/宫格切过去时按当前跨度折成像素矩形（`cols*340+(cols-1)*16`） |
| 定位 | 卡片 `position:absolute; left/top/width/height = rect{x,y,w,h}`，画布按最大底边自动撑高、可滚动；允许重叠（自由画布语义） |
| 移动 | 在卡片主体按下拖动 → 实时更新 `rect.x/y`（rAF 预览、松手落盘） |
| 缩放 | 四边/四角 8px 命中区，按边缘方向改 `x/y/w/h`：左边缘往左拖会**真正向左生长**（x 减小、w 增大），上边缘同理；最小 220×140 |
| 新增 | 自由模式新卡用 `nextFreeRect()` 按行流动找空位 |
| 自动排列 | 自由模式下按行重排（保持各自尺寸） |
| 持久化 | `serializeBoard` 保留 `rect`；解析时 `normalizeRect` 夹紧 |

实测：`1 张卡` 拖主体 `+120/+80` → rect 由 `16,16,340,190` 变 `136,96,340,190`；再从左边缘拖 `-140` → `0,96,482,190`（向左生长并在画布左边界夹住）。
