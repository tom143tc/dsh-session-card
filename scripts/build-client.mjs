/**
 * build-client.mjs — 把 src/lib（可测试的纯逻辑）与 src/client（浏览器 UI）
 * 拼成单个 client.js。
 *
 * 为什么需要拼接：宿主浏览器半侧只能拿到一个 `client.js`，模块加载器只提供
 * `require('react')` 这类白名单依赖，不能用相对路径 import。于是把纯逻辑源码
 * 原样内联（去掉 export/import 语法），保证「测试的对象」与「线上跑的对象」
 * 是同一份实现，而不是两份手抄。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 去掉 ESM 语法，让源码可以整体嵌进 factory 函数体。 */
function inline(code) {
  return code
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .replace(/^export\s+default\s+/gm, '')
    .trim();
}

const libs = ['src/lib/layout.js', 'src/lib/board.js', 'src/lib/caps.js']
  .map((f) => `/* ---- ${f} ---- */\n${inline(read(f))}`)
  .join('\n\n');

const ui = read('src/client/ui.js');
const apply = read('src/client/apply.js');

const out = `/**
 * dsh-session-cards · 浏览器半侧（client half）
 *
 * 本文件由 scripts/build-client.mjs 生成，不要手改。
 * 源码：src/client/{ui,apply}.js + src/lib/{layout,board,caps}.js
 */

(() => {
  try {
    window.__ModuleLoader__.load({
      id: 'dsh-session-cards',
      factory(require) {
        const React = require('react');
        const h = React.createElement;

${libs
  .split('\n')
  .map((l) => (l ? `        ${l}` : ''))
  .join('\n')}

${ui
  .split('\n')
  .map((l) => (l ? `        ${l}` : ''))
  .join('\n')}

${apply
  .split('\n')
  .map((l) => (l ? `        ${l}` : ''))
  .join('\n')}

        return { name: 'dsh-session-cards', inject: ['slots'], apply };
      },
    });
  } catch (error) {
    console.warn('[dsh-session-cards] client bundle 加载失败，已跳过', error);
  }
})();
`;

fs.writeFileSync(path.join(ROOT, 'client.js'), out);
console.log(`client.js written (${out.length} bytes)`);
