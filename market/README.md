# 市场收录（awesome-dsh-plugin / dsh-market）

dsh-market 的「发现」只读 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的目录；
收录方式是向该仓库提 **一个 YAML 文件** 的 PR（不是提给 dsh-market 本身）。

## 已准备好的条目

文件：[`tom143tc__dsh-session-card.yml`](./awesome-dsh-plugin/tom143tc__dsh-session-card.yml)

内容（随本仓库一起提交，作为待提交副本）：

```yaml
url: https://github.com/tom143tc/dsh-session-card
name: tom143tc/dsh-session-card
category: session
description:
  en: "Draggable session cards on a board inside the session canvas, with grid, matrix and freeform layouts, a per-card composer, and native floating windows."
  zh: "把会话做成卡片桌布：网格 / 宫格 / 自由布局、卡片内直接发消息、可弹出原生浮窗。"
icon: https://raw.githubusercontent.com/tom143tc/dsh-session-card/main/assets/icon-180.png
```

## 提交步骤

```sh
# 1) fork 并克隆目录仓
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin

# 2) 放入条目（文件名必须是 <owner>__<repo>.yml）
cp <本仓库>/market/awesome-dsh-plugin/tom143tc__dsh-session-card.yml data/plugins/

# 3) 提交并开 PR
git switch -c add/dsh-session-card
git add data/plugins/tom143tc__dsh-session-card.yml
git commit -m "Add dsh-session-cards"
git push -u origin add/dsh-session-card
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add dsh-session-cards (session cards board)" \
  --body "Session board for DSH: draggable cards with grid/matrix/freeform layouts, per-card composer, native floating windows. Package declares dsh.bundle + cordis.patch.yml."
```

## 收录要求核对

- [x] `package.json` 声明 `dsh.bundle.patch`（`./cordis.patch.yml`）与 `dsh.client`
- [x] 仓库根有 `cordis.patch.yml`
- [x] 有真实可运行代码（host 路由 + 客户端 UI + Electron 管家 + 单测）
- [x] 描述只陈述功能，无营销词
- [ ] 仓库创建满 1 天（本仓库 2026-11-04 创建，次日再提交 PR）
- [ ] 仓库加 topic `dsh-plugin`（Settings → Topics）
- [ ] 先 push 到 GitHub（见根目录 README 安装命令）
