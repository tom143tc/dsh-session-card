import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBoard,
  makeCard,
  addCard,
  removeCard,
  setCardSpan,
  setForm,
  reorder,
  setMinimized,
  setMaximized,
  parseBoard,
  serializeBoard,
  isValidCard,
  BOARD_VERSION,
} from '../src/lib/board.js';
import { MAX_CARDS } from '../src/lib/layout.js';

const card = (i) => makeCard({ id: `c${i}`, sessionId: `s${i}`, title: `卡 ${i}` }, i);

test('emptyBoard: 空桌布结构稳定', () => {
  const b = emptyBoard(7);
  assert.deepEqual(b, { version: BOARD_VERSION, form: 'grid', cards: [], maximizedId: null, updatedAt: 7 });
});

test('makeCard: 缺字段直接抛错，不产生半张卡', () => {
  assert.throws(() => makeCard({ id: 'x' }), TypeError);
  assert.ok(isValidCard(makeCard({ id: 'x', sessionId: 's', title: 't' })));
});

test('addCard: 满 12 张后拒绝（数据层硬上限）', () => {
  let b = emptyBoard();
  for (let i = 0; i < MAX_CARDS; i++) {
    const r = addCard(b, card(i));
    assert.equal(r.ok, true, `第 ${i + 1} 张应加入成功`);
    b = r.state;
  }
  const over = addCard(b, card(99));
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'limit');
  assert.equal(over.state.cards.length, MAX_CARDS);
});

test('addCard: 重复 id 拒绝', () => {
  let b = addCard(emptyBoard(), card(1)).state;
  const dup = addCard(b, card(1));
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
});

test('removeCard: 删不存在的卡返回 ok:false 且状态不变', () => {
  const b = addCard(emptyBoard(), card(1)).state;
  const miss = removeCard(b, 'nope');
  assert.equal(miss.ok, false);
  assert.equal(miss.state.cards.length, 1);
  const hit = removeCard(b, 'c1');
  assert.equal(hit.ok, true);
  assert.equal(hit.state.cards.length, 0);
});

test('setForm: 只接受 grid/matrix', () => {
  assert.equal(setForm(emptyBoard(), 'matrix').state.form, 'matrix');
  assert.equal(setForm(emptyBoard(), 'poker').ok, false);
});

test('reorder: 未知 id 忽略，漏掉的卡补在后面', () => {
  let b = emptyBoard();
  for (let i = 0; i < 3; i++) b = addCard(b, card(i)).state;
  const out = reorder(b, ['c2', 'ghost', 'c0']);
  assert.deepEqual(out.cards.map((c) => c.id), ['c2', 'c0', 'c1']);
});

test('parseBoard: 空串/坏 JSON/版本不符都退回空桌布并带 warning', () => {
  assert.equal(parseBoard('').warning, 'empty');
  assert.equal(parseBoard('{oops').warning, 'corrupt-json');
  assert.equal(parseBoard('null').warning, 'not-object');
  const old = parseBoard(JSON.stringify({ version: 0, form: 'grid', cards: [] }));
  assert.equal(old.ok, false);
  assert.match(old.warning, /version-mismatch/);
});

test('parseBoard: 过滤非法卡片并计数', () => {
  const raw = JSON.stringify({
    version: BOARD_VERSION,
    form: 'matrix',
    cards: [{ id: 'a', sessionId: 's', title: 'ok' }, { id: 'b' }, null],
    updatedAt: 5,
  });
  const r = parseBoard(raw);
  assert.equal(r.ok, true);
  assert.equal(r.state.cards.length, 1);
  assert.equal(r.state.form, 'matrix');
  assert.equal(r.warning, 'dropped:2');
});

test('serialize/parse 往返一致', () => {
  let b = emptyBoard(1);
  b = addCard(b, card(1)).state;
  b = setForm(b, 'matrix').state;
  const r = parseBoard(serializeBoard(b));
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.cards, b.cards);
  assert.equal(r.state.form, 'matrix');
});


test('setMinimized: 只改目标卡，未知 id 返回 not-found', () => {
  let b = emptyBoard();
  b = addCard(b, card(1)).state;
  b = addCard(b, card(2)).state;
  const r1 = setMinimized(b, 'c1', true);
  assert.equal(r1.ok, true);
  assert.equal(r1.state.cards[0].minimized, true);
  assert.equal(r1.state.cards[1].minimized, false);
  const r2 = setMinimized(b, 'nope', true);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'not-found');
  assert.equal(r2.state, b, '失败时状态原样返回');
});

test('setMaximized: 只能指向已存在的卡，null 表示还原', () => {
  let b = emptyBoard();
  b = addCard(b, card(1)).state;
  assert.equal(setMaximized(b, 'c1').state.maximizedId, 'c1');
  assert.equal(setMaximized(b, 'c1').state.cards.length, 1, '最大化不增删卡');
  assert.equal(setMaximized(b, null).state.maximizedId, null);
  const bad = setMaximized(b, 'ghost');
  assert.equal(bad.ok, false);
  assert.equal(bad.state, b);
});

test('serialize/parse: minimized 与 maximizedId 往返不丢', () => {
  let b = emptyBoard(1);
  b = addCard(b, card(1)).state;
  b = setMinimized(b, 'c1', true).state;
  b = setMaximized(b, 'c1').state;
  const round = parseBoard(serializeBoard(b), 2);
  assert.equal(round.ok, true);
  assert.equal(round.state.cards[0].minimized, true);
  assert.equal(round.state.maximizedId, 'c1');
  assert.equal(round.state.form, 'grid');
});

test('parseBoard: maximizedId 指向不存在的卡时清空', () => {
  const raw = JSON.stringify({ version: BOARD_VERSION, form: 'grid', cards: [], maximizedId: 'ghost', updatedAt: 1 });
  const parsed = parseBoard(raw, 2);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.maximizedId, null);
  assert.equal(parsed.state.cards.length, 0);
});

test('setCardSpan：只改目标卡并把跨度夹到 1..4', () => {
  const a = makeCard({ id: 'a', sessionId: 's1', title: 'A' });
  const b = makeCard({ id: 'b', sessionId: 's2', title: 'B' });
  const state = { ...emptyBoard(0), cards: [a, b] };
  const wider = setCardSpan(state, 'a', 3, 2);
  assert.equal(wider.ok, true);
  assert.deepEqual([wider.state.cards[0].cols, wider.state.cards[0].rows], [3, 2]);
  assert.deepEqual([wider.state.cards[1].cols, wider.state.cards[1].rows], [1, 1]);
  const clamped = setCardSpan(state, 'a', 99, 0);
  assert.deepEqual([clamped.state.cards[0].cols, clamped.state.cards[0].rows], [4, 1]);
  assert.equal(setCardSpan(state, 'nope', 2, 2).ok, false);
});

test('parseBoard：跨度缺省为 1，越界被夹紧', () => {
  const raw = JSON.stringify({
    version: 1,
    form: 'grid',
    cards: [
      { id: 'a', sessionId: 's1', title: 'A' },
      { id: 'b', sessionId: 's2', title: 'B', cols: 9, rows: -3 },
    ],
    maximizedId: null,
    updatedAt: 0,
  });
  const parsed = parseBoard(raw, 0);
  assert.equal(parsed.state.cards[0].cols, 1);
  assert.equal(parsed.state.cards[0].rows, 1);
  assert.equal(parsed.state.cards[1].cols, 4);
  assert.equal(parsed.state.cards[1].rows, 1);
});

test('serializeBoard/parseBoard 往返保留卡片跨度', () => {
  const a = makeCard({ id: 'a', sessionId: 's1', title: 'A' });
  const state = setCardSpan({ ...emptyBoard(0), cards: [a] }, 'a', 3, 2).state;
  const parsed = parseBoard(serializeBoard(state), 0);
  assert.equal(parsed.state.cards[0].cols, 3);
  assert.equal(parsed.state.cards[0].rows, 2);
});
