import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMode, describeMode, needsNotice, MODES } from '../src/lib/caps.js';

test('pickMode: 全部能力 → L0 完整', () => {
  assert.equal(pickMode({ boardSlot: true, sessions: true }), 'L0');
});

test('pickMode: 无页签但有浮层 → L1', () => {
  assert.equal(pickMode({ overlaySlot: true, sessions: true }), 'L1');
});

test('pickMode: 只剩 headerActions → L2', () => {
  assert.equal(pickMode({ headerActions: true, sessions: true }), 'L2');
});

test('pickMode: 读不到会话目录 → L3 只读', () => {
  assert.equal(pickMode({ boardSlot: true, sessions: false }), 'L3');
});

test('pickMode: 什么都没有 → L4 不可用', () => {
  assert.equal(pickMode({}), 'L4');
  assert.equal(pickMode(), 'L4');
});

test('MODES 顺序固定，describeMode 覆盖全部', () => {
  assert.deepEqual([...MODES], ['L0', 'L1', 'L2', 'L3', 'L4']);
  for (const m of MODES) assert.ok(describeMode(m).length > 0);
});

test('needsNotice: 只有 L0 不提示', () => {
  assert.equal(needsNotice('L0'), false);
  for (const m of ['L1', 'L2', 'L3', 'L4']) assert.equal(needsNotice(m), true);
});
