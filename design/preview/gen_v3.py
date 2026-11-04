import re, sys

src = open('board.html', encoding='utf-8').read()
style = re.search(r'<style>(.*?)</style>', src, re.S).group(1)

cards = [
    ("与设计师沟通卡片交互需求", "run", "进行中", "deepseek-flash", "16:42", "6 轮 · 12.4k", "我们把桌布做成 conversation.view 页签，宿主输入区保持不动；最大化时卡片内自带输入框。", "林"),
    ("v2.3 卡片窗技术验证", "run", "进行中", "deepseek-pro", "16:20", "9 轮 · 28.1k", "宿主 sessions.prompt 路由已验证：可按 sessionId 给任意卡片发消息，不必切会话。", "陈"),
    ("跟进 bug：卡片位置漂移", "done", "已完成", "deepseek-flash", "15:02", "4 轮 · 6.2k", "clamp + 回弹已修；ResizeObserver 重排后仍保持在合法格。", "周"),
    ("合作方在线沟通会", "todo", "待办", "deepseek-flash", "14:30", "0 轮 · 0", "会前材料待整理：议题、参会人、上次结论。", "—"),
    ("官网卡片页更新", "wait", "待确认", "deepseek-pro", "13:55", "3 轮 · 9.8k", "文案已改，等确认后发布；涉及三处入口截图。", "吴"),
    ("社区运营初步方案", "done", "已完成", "deepseek-flash", "11:40", "2 轮 · 4.4k", "首月排期与预算表已出，转为执行阶段。", "郑"),
    ("前端开发人员招聘", "run", "进行中", "deepseek-pro", "10:12", "5 轮 · 15.6k", "JD 改到第二版，待补团队介绍与面试流程。", "王"),
    ("季度复盘材料", "todo", "待办", "deepseek-flash", "昨天", "1 轮 · 2.1k", "模板已选，待填数据：增长、留存、成本。", "—"),
    ("插件市场调研", "done", "已完成", "deepseek-flash", "昨天", "7 轮 · 18.9k", "对比 6 个同类插件，结论是三处可复用。", "许"),
    ("卡片吸附动画", "wait", "待确认", "deepseek-pro", "昨天", "2 轮 · 5.5k", "两版曲线，等你选：ease-out 120ms 或 spring 160ms。", "何"),
    ("主题三模式联调", "run", "进行中", "deepseek-flash", "昨天", "3 轮 · 8.0k", "light/dark/system 已跟 ctx.theme 打通，token 全部用 --dsw-alias-*。", "冯"),
    ("文档：拖拽状态机", "todo", "待办", "deepseek-flash", "前天", "1 轮 · 1.7k", "idle → dragging → over-cell → dropped，补异常路径。", "—"),
]

rows = [
    ("与设计师沟通卡片交互需求", "run", "进行中", "dsh-desktop", "16:42", "6", "12.4k"),
    ("v2.3 卡片窗技术验证", "run", "进行中", "dsh-desktop", "16:20", "9", "28.1k"),
    ("跟进 bug：卡片位置漂移", "done", "已完成", "dsh-desktop", "15:02", "4", "6.2k"),
    ("合作方在线沟通会", "todo", "待办", "dsh-desktop", "14:30", "0", "—"),
    ("官网卡片页更新", "wait", "待确认", "dsh-desktop", "13:55", "3", "9.8k"),
    ("社区运营初步方案", "done", "已完成", "dsh-desktop", "11:40", "2", "4.4k"),
    ("前端开发人员招聘", "run", "进行中", "dsh-desktop", "10:12", "5", "15.6k"),
    ("季度复盘材料", "todo", "待办", "dsh-desktop", "昨天", "1", "2.1k"),
    ("插件市场调研", "done", "已完成", "dsh-desktop", "昨天", "7", "18.9k"),
    ("卡片吸附动画", "wait", "待确认", "dsh-desktop", "昨天", "2", "5.5k"),
    ("主题三模式联调", "run", "进行中", "dsh-desktop", "昨天", "3", "8.0k"),
    ("文档：拖拽状态机", "todo", "待办", "dsh-desktop", "前天", "1", "1.7k"),
]

def card_html(c, i):
    t, cls, st, model, time, meta, msg, av = c
    ops = '<div class="ops"><button class="primary">打开</button><button>最大化</button><button>最小化</button></div>' if i == 1 else ''
    return f'''<div class="cell"><div class="card c-{cls}"><div class="bar"></div><div class="inner">
      {ops}
      <div class="ct">{t}</div>
      <div class="chips"><span class="chip s"><i></i>{st}</span><span class="chip">{model}</span></div>
      <div class="cmsg">{msg}</div>
      <div class="cfoot"><span>{time}</span><span>{meta}</span><span class="av" style="background:#3b6ef5">{av}</span></div>
    </div></div></div>'''

tr = []
for i, (t, cls, st, ws, up, turns, tok) in enumerate(rows):
    hot = ' class="hot"' if i == 1 else ''
    tr.append(f'<tr{hot}><td class="tdtitle"><span class="dotm c-{cls}-dot"></span>{t}</td>'
              f'<td><span class="chip s2 c-{cls}-s"><i></i>{st}</span></td>'
              f'<td class="dim">{ws}</td><td class="dim">{up}</td>'
              f'<td class="num">{turns}</td><td class="num">{tok}</td>'
              f'<td class="opcell"><button>打开</button><button>最大</button></td></tr>')

extra_css = '''
  body[data-view="scroll"] #view-matrix,body[data-view="scroll"] #view-max,
  body[data-view="matrix"] #view-scroll,body[data-view="matrix"] #view-max,
  body[data-view="max"] #view-scroll,body[data-view="max"] #view-matrix{display:none}
  .stage{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--bg)}

  #view-scroll{position:absolute;inset:0;display:flex;flex-direction:column}
  .scrollbox{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(20,24,36,.22) transparent}
  .grid2{display:grid;grid-template-columns:repeat(2,340px);grid-auto-rows:180px;gap:16px;padding:20px;align-content:start;background-image:radial-gradient(var(--line) 1px, transparent 1px);background-size:16px 16px;background-position:8px 8px;min-height:100%}
  .scrollnote{position:absolute;right:18px;bottom:14px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:99px;padding:7px 14px;font-size:11.5px;color:var(--muted);display:flex;gap:8px;align-items:center;z-index:5;white-space:nowrap}
  .scrollnote b{color:var(--accent);font-weight:650}
  .track{position:absolute;right:4px;top:20px;bottom:20px;width:6px;border-radius:99px;background:var(--line-2)}
  .track i{position:absolute;left:0;width:6px;height:52%;top:0;border-radius:99px;background:rgba(20,24,36,.22)}
  body[data-theme="dark"] .track i{background:rgba(255,255,255,.24)}

  /* ---- matrix: 九宫格 / 十二宫格 ---- */
  #view-matrix{position:absolute;inset:0;padding:18px}
  .matrix{width:100%;height:100%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:14px}
  .matrix .cell{min-width:0;min-height:0}
  .matrix .card{height:100%}
  .matrix .card .inner{padding:10px 12px 8px}
  .matrix .card .ct{font-size:12px;-webkit-line-clamp:1}
  .matrix .chips{gap:5px}
  .matrix .chip{height:18px;font-size:10px;padding:0 6px}
  .matrix .cmsg{margin-top:6px;padding-top:6px;font-size:10.5px}
  .matrix .cfoot{padding-top:6px;font-size:9.5px;gap:7px}
  .matrix .ops{right:7px;top:7px;gap:4px}
  .matrix .ops button{height:20px;padding:0 6px;font-size:9.5px}
  .cellsize{position:absolute;left:14px;bottom:9px;font-size:10px;color:var(--faint);background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:3px 9px}
  .axis{position:absolute;right:14px;bottom:9px;font-size:10px;color:var(--faint);background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:3px 9px}

  #view-max{position:absolute;inset:0;padding:16px 16px 0}
  .maxcard{height:100%;border-radius:16px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow-lift);overflow:hidden;display:flex;flex-direction:column}
  .maxcard .mbar{height:5px;flex:0 0 5px;background:linear-gradient(90deg,#4f8ef7,#7aa8ff)}
  .mhead{display:flex;align-items:center;gap:10px;padding:16px 22px 0}
  .mtitle{font-size:19px;font-weight:750}
  .mops{margin-left:auto;display:flex;gap:8px}
  .mops .btn{height:26px}
  .mbody{padding:12px 22px 0;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:hidden}
  .mchips{display:flex;gap:6px}
  .mmsg{font-size:13px;line-height:1.75;color:var(--muted);max-width:820px}
  .mlog{margin-top:2px;border-top:1px dashed var(--line);padding-top:12px;font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:8px}
  .mline{display:flex;gap:8px;line-height:1.6}
  .mline b{color:var(--text);font-weight:650;flex:0 0 auto}
  .minput{border-top:1px solid var(--line);padding:12px 22px 14px;display:flex;flex-direction:column;gap:8px;background:var(--panel)}
  .minput .box{border:1px solid var(--line);background:var(--panel-2);border-radius:11px;padding:10px 12px;font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:10px}
  .minput .box .ph{flex:1;color:var(--faint)}
  .minput .send{height:28px;padding:0 14px;border-radius:8px;background:var(--accent);color:#fff;font-size:11.5px;font-weight:650;display:inline-flex;align-items:center;gap:6px;border:0}
  .minput .hint{font-size:10.5px;color:var(--faint);display:flex;justify-content:space-between}
  .minput .hint b{color:var(--accent);font-weight:600}
  .eschint{font-size:10.5px;color:var(--faint);align-self:center;margin-right:2px}

  .hostcomposer{flex:0 0 58px;border-top:1px solid var(--line);background:var(--panel-2);display:none;align-items:center;gap:10px;padding:0 18px}
  body[data-view="max"] .hostcomposer{display:flex}
  .hostcomposer .hc-label{font-size:10px;color:var(--faint);letter-spacing:.4px;border:1px dashed var(--line);border-radius:5px;padding:2px 5px;white-space:nowrap}
  .hostcomposer .hcbox{flex:1;height:32px;border:1px solid var(--line);border-radius:9px;background:var(--panel);display:flex;align-items:center;padding:0 12px;font-size:12px;color:var(--faint)}
  .hostcomposer .hcsend{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--faint);font-size:11.5px}
'''

sidebar = '''<aside class="sidebar">
      <div class="brand"><div class="logo">D</div><div class="name">DeepSeek Harness</div><div class="ver">v0.2</div></div>
      <div class="newchat">＋ 新建会话</div>
      <div class="ws-title">工作区 · dsh-desktop</div>
      <div class="row active"><span class="dot" style="background:#3b82f6"></span><span class="t">与设计师沟通卡片交互需求</span><span class="cnt">6</span></div>
      <div class="row"><span class="dot" style="background:#3b82f6"></span><span class="t">v2.3 卡片窗技术验证</span><span class="cnt">9</span></div>
      <div class="row"><span class="dot" style="background:#2fb37f"></span><span class="t">跟进 bug：卡片位置漂移</span><span class="cnt">4</span></div>
      <div class="row"><span class="dot" style="background:#94a3b8"></span><span class="t">合作方在线沟通会</span><span class="cnt">0</span></div>
      <div class="row"><span class="dot" style="background:#e8a33d"></span><span class="t">官网卡片页更新</span><span class="cnt">3</span></div>
      <div class="row"><span class="dot" style="background:#2fb37f"></span><span class="t">社区运营初步方案</span><span class="cnt">2</span></div>
      <div class="row"><span class="dot" style="background:#94a3b8"></span><span class="t">前端开发人员招聘</span><span class="cnt">0</span></div>
      <div class="row"><span class="dot" style="background:#3b82f6"></span><span class="t">季度复盘材料</span><span class="cnt">1</span></div>
      <div class="side-foot"><span>已归档 4</span><span>存储 2.1 GB</span></div>
    </aside>'''

rightbar = '''<aside class="rightbar">
      <div class="rb-head"><span>会话详情</span><span class="x">✕</span></div>
      <div class="rb-body">
        <div><div class="rb-title">与设计师沟通卡片交互需求</div><div class="rb-chips"><span class="chip">进行中</span><span class="chip">dsh-desktop</span></div></div>
        <div><div class="kv"><span>模型</span><b>deepseek-flash</b></div><div class="kv"><span>轮次</span><b>6</b></div><div class="kv"><span>Token</span><b>12.4k</b></div></div>
        <div><div class="rb-sec">上下文</div><div class="progress"><i></i></div><div class="kv"><span>已用 42%</span><b>剩余 58%</b></div></div>
        <div><div class="rb-sec">待办</div>
          <div class="todo done"><span class="box">✓</span>确定页签挂载点</div>
          <div class="todo done"><span class="box">✓</span>拖拽落格交互</div>
          <div class="todo"><span class="box"></span>最大化输入区（方案 A）</div>
          <div class="todo"><span class="box"></span>宫格形态重排</div>
        </div>
        <div><div class="rb-sec">最近改动</div><div class="kv"><span>4.11 布局形态与自适应</span><b>20:35</b></div><div class="kv"><span>§8 待拍板 · 6 条</span><b>20:35</b></div></div>
      </div>
      <div class="rb-foot"><button class="btn">打开会话</button><button class="btn primary" style="background:var(--accent);border-color:var(--accent);color:#fff">最大化</button></div>
    </aside>'''

body = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH · 会话卡片桌布 v3 预览</title>
<style>{style}
{extra_css}</style></head>
<body data-theme="light" data-view="scroll">
  <div class="titlebar">
    <div class="lights"><i></i><i></i><i></i></div>
    <span class="tb-title">会话卡片桌布 · v3</span>
    <div class="tb-right"><span>deepseek-flash</span><b>◈ 12.4k</b></div>
  </div>
  <div class="app">
    {sidebar}
    <main class="main">
      <div class="conv-head">
        <span class="status-dot"></span><span class="conv-title">与设计师沟通卡片交互需求</span><span class="conv-sub">进行中</span>
        <div class="tabs"><div class="tab">对话</div><div class="tab">轨迹</div><div class="tab on">▦ 卡片桌布</div><div class="tab">＋</div></div>
        <div class="head-right"><span>◷ 19:48</span><span>⋯</span></div>
      </div>
      <div class="toolbar">
        <span class="tb-label"><b>12</b> 张卡片 · 上限 12</span>
        <span class="spacer"></span>
        <button class="btn">▦ 自动整理</button><button class="btn">＋ 新建卡片</button>
        <div class="seg"><div class="opt on">☀ 白天</div><div class="opt">☾ 黑夜</div><div class="opt">⌂ 随系统</div></div>
        <div class="seg segview"><div class="opt on">▦ 网格</div><div class="opt">▦ 宫格</div></div>
      </div>
      <div class="stage">
        <section id="view-scroll">
          <div class="scrollbox"><div class="grid2">{''.join(card_html(c,i) for i,c in enumerate(cards))}</div></div>
          <div class="track"><i></i></div>
          <div class="scrollnote">12 张卡 · 2 列 × 340 · 约 1.6 屏 <span style="color:var(--faint)">|</span> 仅纵向滚动，无横向滚动条</div>
        </section>
        <section id="view-matrix">
          <div class="matrix">{''.join(card_html(c,i) for i,c in enumerate(cards[:12]))}</div>
        </section>
        <section id="view-max">
          <div class="maxcard">
            <div class="mbar"></div>
            <div class="mhead"><span class="mtitle">与设计师沟通卡片交互需求</span>
              <span class="chip s" style="background:rgba(59,130,246,.13);color:var(--run)"><i style="width:5px;height:5px;border-radius:50%;background:currentColor;display:block"></i>进行中</span>
              <span class="chip">deepseek-flash</span><span class="chip">dsh-desktop</span>
              <div class="mops"><span class="eschint">Esc 退出最大化</span><button class="btn">最小化</button><button class="btn">打开会话</button><button class="btn">✕</button></div>
            </div>
            <div class="mbody">
              <div class="mchips"><span class="chip">上下文 42%</span><span class="chip">12.4k tokens</span><span class="chip">6 轮</span></div>
              <div class="mmsg">把桌布做成 <b style="color:var(--text)">conversation.view</b> 页签后，宿主输入区不需要动；最大化时卡片内自带输入框，走 host 的 <b style="color:var(--text)">/prompt</b> 路由即可给这张卡对应的会话发消息，不用切换会话。</div>
              <div class="mlog">
                <div class="mline"><b>你</b><span>最大化时如果卡片里能直接输入，宿主那个输入框是不是就重复了？</span></div>
                <div class="mline"><b>助手</b><span>会有两个入口，但语义不同：卡片输入框发往「这张卡对应的会话」，宿主输入框发往「当前会话」。两个都保留，卡片输入框加提示文案即可。</span></div>
                <div class="mline"><b>你</b><span>那就按方案 A 做，别切会话。</span></div>
                <div class="mline"><b>助手</b><span>已记录。输入框标注「发送到本卡片会话」，宿主输入框保持「当前会话」不变；Enter 发送、Shift+Enter 换行。</span></div>
                <div class="mline"><b>你</b><span>宫格形态和滚动那条也一并画出来。</span></div>
              </div>
            </div>
            <div class="minput">
              <div class="box"><span class="ph">给这张卡片发消息…</span><button class="send">发送 ↵</button></div>
              <div class="hint"><span>Enter 发送 · Shift+Enter 换行 · 发送到「与设计师沟通卡片交互需求」</span><b>方案 A · 不切换会话</b></div>
            </div>
          </div>
        </section>
      </div>
      <div class="hostcomposer"><span class="hc-label">宿主输入区</span><div class="hcbox">给当前会话发消息…（最大化不遮挡它，作用于当前会话）</div><button class="hcsend">发送</button></div>
    </main>
    {rightbar}
  </div>
'''

js = '''<script>
  const q = new URLSearchParams(location.search);
  const v = q.get('view'); if (v) document.body.dataset.view = v;
  const t = q.get('theme'); if (t) document.body.dataset.theme = t;
  if ((v || 'scroll') === 'matrix') {
    const segs = document.querySelectorAll('.segview .opt');
    segs[0].classList.remove('on'); segs[1].classList.add('on');
    document.querySelector('.tb-label').innerHTML = '<b>12</b> 张卡片 · 宫格 3×4 · 拖动 = 交换';
  }
  if ((v || 'scroll') === 'max') {
    document.querySelector('.tb-label').innerHTML = '<b>12</b> 张卡片 · 1 张最大化';
  }
</script>
</body></html>'''

open('board-v3.html', 'w', encoding='utf-8').write(body + js)
print('written')
