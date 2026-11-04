# P1 验证记录（2026-11-03）

P1 = 把 P0 的诊断面板换成真实桌布：两形态、拖动交换、三态、持久化。全部在隔离实例（`~/.dsh/profiles/p0cards`，端口 17890）里用 CDP 实测。

## 结果

| 能力 | 验证方式 | 结果 |
|---|---|---|
| 网格形态 | 默认渲染 | ✅ 12 卡自适应列（1440 宽下 4 列），每卡 260+ 宽 |
| 宫格形态 | 点「▦ 宫格」→ 读 `getComputedStyle` | ✅ `form=matrix`，`grid-template-columns` 3 列、`grid-template-rows` 4 行 |
| 拖动交换 | CDP `Input.dispatchMouseEvent`（pressed → 5×moved → released） | ✅ localStorage 顺序 `[A,B,C]` → `[B,A,C]`，即真实 pointer 事件触发落格交换 |
| 最小化 | 点卡片「—」 | ✅ 卡片移出画布、写入 `minimized: true`，底部 dock 出现 chip |
| 最大化 | 点卡片「⤢」 | ✅ `maximizedId` 落盘；卡片铺满画布，内含输入框 + 发送按钮 |
| Esc 退出最大化 | `keydown Escape` | ✅ `maximizedId=null`，最小化状态保留 |
| 刷新恢复 | `Page.reload` 后重开同一会话 | ✅ 卡片数、形态、`minimized` 全保留；页签自动回到「卡片桌布」并挂载 |
| 底部不遮挡 | 宫格 3×4 在 1440×813 下 | ✅ 根节点预留 `padding-bottom: 132px`，第 4 行完整可见，宿主输入区仍在 |

证据截图：`docs/p1-grid.png`（网格）、`docs/p1-matrix.png`（宫格 3×4）、`docs/p1-max.png`（最大化）、`docs/p1-reload.png`（刷新后）。

## 关键实现

- **拖动用 Pointer Events**，不用 HTML5 DnD：CDP 能产生真实 pointer 事件，合成 `DragEvent` 在 React 委托下不可靠（试过 dragstart/dragover/drop 全链路，localStorage 顺序不变）。
- **落格 = 交换**，不是推挤；目标格虚线高亮，`document.elementFromPoint(...).closest('[data-card-id]')` 命中。
- **状态模型**（`src/lib/board.js`）：卡片 `minimized`、桌布 `maximizedId`，`setMinimized` / `setMaximized` 为纯函数，未知 id 返回 `{ok:false,reason:'not-found'}` 且状态原样返回。
- **持久化**：`localStorage['dsh-session-cards/board/v1']`，`serializeBoard` 只写白名单字段；`parseBoard` 对坏 JSON / 版本不符 / 非法卡 / 幽灵 `maximizedId` 全部兜底。
- **主题**：全部颜色走 `var(--dsw-alias-*, 兜底)`，日间/夜间实测正常。
- **抗升级**：客户端只硬注入 `slots`；`theme` / `sessions` 用 `ctx.inject` 软探测，读不到时能力位为 false、走 L3 只读或 L4。

## 补充验证（同日晚些时候）

- **真实发送已验证**：对一条空白会话执行 `POST /plugins/dsh-session-cards/prompt`，返回 `200 {"ok":true,"sessionId":"session-22c19a48…","accepted":true}`，宿主 admission 成功（该测试会话随后已归档、对应卡片已从桌布移除）。
- **「⟳ 刷新」已实现**：按最近会话补齐桌布空位（上限 12），已实测点击无崩溃、计数正确（12 张卡片 · 共 706 个会话）。
- 修掉两个渲染期崩溃：`refreshCards` 定义顺序导致的 TDZ `ReferenceError`、`btnStyle` 未定义；另修正 `readList` 未暴露 `ids` 导致「共 0 个会话」。

## 主题跟随（light / dark / system）

用 CDP `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'light'}]})` 切换系统外观，宿主 `color-scheme` 与 token 同步变化，桌布随之变浅（截图 `docs/p1-theme-light.png`），切回 dark 恢复。桌布不使用任何硬编码色值，全部 `var(--dsw-alias-*, 兜底)`。

## 降级演练（抗升级）

用本地演练开关 `localStorage['dsh-session-cards/drill']` 模拟「宿主 slot 缺失」，验证 L1/L2/L4 不白屏：

| 演练 | 设置 | 结果 |
|---|---|---|
| L1 浮层 | `{disableView:true}` | 控制台 `已注册 shell.overlay`，右侧 560px 浮层出现完整桌布（截图 `docs/p1-degrade-l1.png`）|
| L2 头部按钮 | `{disableView:true, disableOverlay:true}` | 控制台 `已注册 conversation.session.header.actions`，会话头部出现「卡片桌布」按钮 |
| L4 不可用 | 三项全禁 | 控制台 `没有可用挂载点，插件以 L4（不可用）运行`，不注册任何 UI，也不抛错 |
| L3 只读 | `{disableSessions:true}` | 控制台正常注册 `conversation.view`；桌布显示「L3 只读降级」提示、不再渲染卡片、不崩溃 |
| 复原 | `{}` | 回到 L0，页签与桌布正常 |

这一层是「抗升级」的真正证据：宿主升级拿掉某个 slot 时，插件逐级退到浮层 → 按钮 → 静默，而不是整页白屏。

## 已知问题（下一阶段）

1. 卡片的「轮数/Token」摘要：列表行的 `projectionValues` 在安装版里并不总是带 `sessionStats`，目前多数卡只显示时间；需要按会话订阅投影。
2. 「自动排列」只按更新时间/运行态重排已有卡，不做补卡（补卡已由「刷新」承担）。
3. 空桌布 seed 只在首次挂载时发生（取最近 12 个会话），之后新增会话不会自动补位。
4. 卡片内容仍是标题/工作区/时间，尚未接 `useSessions` 的轮次、token、运行态摘要。

## 复跑

```bash
cd plugin-session-card
node --test test/                 # 31 pass / 0 fail
node scripts/build-client.mjs     # 生成 client.js
dsh --profile p0cards --no-open --host 127.0.0.1 --port 17890
# 用打印出的 ?token=... 打开页面，选会话 → 点「卡片桌布」
```
