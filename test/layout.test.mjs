import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGrid, matrixDims, clampPos, swapItems, arrangeCards, GRID, MAX_CARDS } from '../src/lib/layout.js';

test('fitGrid: 非法画布尺寸直接抛错（不静默返回坏布局）', () => {
  assert.throws(() => fitGrid(0, 100, 3), RangeError);
  assert.throws(() => fitGrid(100, NaN, 3), RangeError);
});

test('fitGrid: 880×760 放 12 张 → fit，3 列 4 行，格子不重叠', () => {
  const l = fitGrid(880, 760, 12);
  assert.equal(l.mode, 'fit');
  assert.equal(l.cols, 3);
  assert.equal(l.rows, 4);
  assert.ok(l.cellW >= GRID.minW);
  assert.ok(l.cellH >= GRID.minH);
  // 3*cellW + 2*gap + 2*pad <= W（不越界）
  assert.ok(l.cols * l.cellW + (l.cols - 1) * GRID.gap + 2 * GRID.pad <= 880 + 0.01);
});

test('fitGrid: 640×700 放 12 张 → scroll，保住舒适尺寸', () => {
  const l = fitGrid(640, 700, 12);
  assert.equal(l.mode, 'scroll');
  assert.equal(l.cellW, GRID.comfortW);
  assert.equal(l.cellH, GRID.comfortH);
  assert.ok(l.contentH > 700, '内容高度应超过画布，才需要纵向滚动');
  assert.ok(l.cols >= 2 && l.cols <= 4);
});

test('fitGrid: 0 张卡也不崩', () => {
  const l = fitGrid(880, 760, 0);
  assert.equal(l.cols, 2);
  assert.equal(l.rows, 1);
});

test('fitGrid: 超过上限按 12 处理', () => {
  const a = fitGrid(880, 760, 99);
  const b = fitGrid(880, 760, MAX_CARDS);
  assert.deepEqual(a, b);
});

test('matrixDims: 12 张 → 3×4，9 张 → 3×3', () => {
  assert.deepEqual(matrixDims(12, 880), { cols: 3, rows: 4 });
  assert.deepEqual(matrixDims(9, 880), { cols: 3, rows: 3 });
  assert.deepEqual(matrixDims(10, 880), { cols: 3, rows: 4 });
});

test('matrixDims: 窄画布退 2 列', () => {
  assert.deepEqual(matrixDims(12, 600), { cols: 2, rows: 6 });
  assert.deepEqual(matrixDims(7, 600), { cols: 2, rows: 4 });
});

test('clampPos: 越界坐标被夹回内容区', () => {
  assert.deepEqual(clampPos(1000, 1000, 340, 180, 880, 760), { x: 540, y: 580 });
  assert.deepEqual(clampPos(-50, -20, 340, 180, 880, 760), { x: 0, y: 0 });
  assert.deepEqual(clampPos(NaN, undefined, 340, 180, 880, 760), { x: 0, y: 0 });
});

test('swapItems: 交换两个位置且不改原数组', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(swapItems(list, 0, 2), ['c', 'b', 'a']);
  assert.deepEqual(list, ['a', 'b', 'c']);
  assert.deepEqual(swapItems(list, 1, 1), ['a', 'b', 'c']);
  assert.deepEqual(swapItems(list, 0, 9), ['a', 'b', 'c'], '越界下标原样返回');
});

test('arrangeCards: 三种策略', () => {
  const cards = [
    { id: 'a', running: false, updatedAt: 10, customOrder: 2 },
    { id: 'b', running: true, updatedAt: 5, customOrder: 1 },
    { id: 'c', running: false, updatedAt: 20, customOrder: 3 },
  ];
  assert.deepEqual(arrangeCards(cards, 'recent').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(arrangeCards(cards, 'running').map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(arrangeCards(cards, 'custom').map((x) => x.id), ['b', 'a', 'c']);
  assert.throws(() => arrangeCards(cards, 'nope'), RangeError);
});
