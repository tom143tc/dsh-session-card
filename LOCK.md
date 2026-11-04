# 版本锁定：0.4.2

- 锁定时间：2026-11-04 11:35（Asia/Shanghai）
- 锁定人：用户确认「目前很好，锁定当前版本」
- 状态：**冻结**。此后任何改动必须升版本号，并另建 `releases/<新版本>/`；不得修改本版本产物。

## 产物与校验和（sha256）

```
0af10b88c950185e2e36c333bd9596a64a723ce9fc81b2486286b8e82bc5e45f  client.js
b4965f722a0f488ca1d3440d14853f904927dd22a03c6ed642767256e062acfc  index.js
0425a32d7f70b8ae3c913fc1e9e8196aa8664d52cbb1609a76bf9d1b1194625c  popout/main.cjs
d182fe555a2d1577cb26638ec809019b27ba4ad17b78f6a74f0bb16ce28c1240  cordis.patch.yml
cb4e718d89c92f86fda212e87b88a2b2b831de2d34c621aa513bc3b678c5d855  package.json
```

快照目录：`releases/0.4.2/`（含 `SHA256SUMS`）。

## 已验证

- 仓库产物 = 快照 = 桌面 profile 已安装副本（`~/.dsh/profiles/desktop/node_modules/dsh-session-cards/`），三个位置 `client.js` 与 `popout/main.cjs` 哈希一致。
- `node --test test/` → 34 pass / 0 fail。
- 能力面：桌布（网格/宫格/自由）、拖动与边缘缩放（拖动中连续预览、松手吸附）、最小化/最大化/Esc、卡片内输入（悬停出现）、会话记录流、主题跟随、原生浮窗（位置记忆、拖回收回、置顶、去重/上限）、降级 L0–L4、抗升级探测。

## 回滚方式

```bash
cd /Users/tom/work/DSH/plugin-session-card
cp releases/0.4.2/client.js releases/0.4.2/index.js releases/0.4.2/package.json releases/0.4.2/cordis.patch.yml .
cp releases/0.4.2/popout/main.cjs popout/
cd ~/.dsh/profiles/desktop && rm -rf node_modules/dsh-session-cards && pnpm install --prefer-offline
```

## 校验方式

```bash
cd /Users/tom/work/DSH/plugin-session-card && shasum -a 256 -c releases/0.4.2/SHA256SUMS
```
