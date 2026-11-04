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
export const MODES = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);

/**
 * @param {{boardSlot?:boolean, overlaySlot?:boolean, headerActions?:boolean, sessions?:boolean}} caps
 * @returns {'L0'|'L1'|'L2'|'L3'|'L4'}
 */
export function pickMode(caps = {}) {
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
export function describeMode(mode) {
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
export function needsNotice(mode) {
  return mode !== 'L0';
}
