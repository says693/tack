/*
 * tack · 主窗逻辑（G0 骨架，数据为内置演示）
 * 真数据接线点已用 DATA_SOURCE 标出，后续接 Python 内核时只换这里。
 */

(function () {
  const b = window.tackBridge;
  const say = (t) => window.notify(t);

  /* ---------- 演示数据 ---------- */

  const DATA_SOURCE = "demo"; // 之后改为 "db"：由内核经 IPC 推 due 卡列表，这里只负责渲染

  const SUBJECTS = ["生物 · 细胞与能量", "微积分 · 级数与收敛", "近代史 · 条约与秩序"];

  const CARDS = [
    {
      title: "钠钾泵为什么属于主动运输",
      parent:
        "钠钾泵每消耗一分子 ATP，把 3 个 Na⁺ 泵出细胞、2 个 K⁺ 泵入细胞，逆浓度梯度进行，因此是主动运输。",
      tier: "1",
      due: "今天",
      state: "new",
      keys: ["atp", "na", "k", "梯度", "浓度"],
      points: [
        "方向逆浓度梯度——这是主动运输的判据",
        "能量来自 ATP 水解，而非顺浓度差",
        "3 Na⁺ 出、2 K⁺ 入，比例决定电性",
      ],
    },
    {
      title: "ATP 为什么叫能量货币",
      parent:
        "ATP 只在酶的作用下按需水解，释放的能量用于吸能反应；细胞像花钱一样花 ATP，而不是一次性烧掉全部能量。",
      tier: "2",
      due: "今天",
      state: "learning",
      keys: ["水解", "酶", "吸能", "磷酸"],
      points: [
        "按需水解，能量分次释放",
        "高能磷酸键的断裂是可逆循环的一环",
        "与吸能反应直接耦合",
      ],
    },
    {
      title: "有氧呼吸第二阶段的场所",
      parent:
        "在线粒体基质中，丙酮酸被彻底分解为 CO₂，并与 NAD⁺ 结合生成 NADH，同时释放少量能量。",
      tier: "3",
      due: "今天",
      state: "learning",
      keys: ["线粒体基质", "丙酮酸", "co2", "nadh"],
      points: [
        "第二阶段在基质，不是内膜",
        "丙酮酸全程被彻底氧化",
        "少量 ATP 与大量 NADH 同时产生",
      ],
    },
    {
      title: "光反应把光能变成了什么",
      parent:
        "光反应在水解水的过程中把光能转化为 ATP 和 NADPH 中的活跃化学能，供暗反应碳固定使用。",
      tier: "2",
      due: "今天",
      state: "review",
      keys: ["atp", "nadph", "水解", "光能"],
      points: [
        "光能先变成活跃化学能而不直接变成糖",
        "ATP 与 NADPH 是暗反应的原料",
        "水的光解同时释放氧气",
      ],
    },
  ];

  /* ---------- 状态 ---------- */

  const state = {
    index: 0,
    subjectIndex: 0,
    cards: CARDS.map((c) => ({ ...c, verdict: null, answering: false })),
  };

  const $ = (id) => document.getElementById(id);
  const stream = $("stream");

  /* ---------- 渲染 ---------- */

  function todayText() {
    const d = new Date();
    const wd = "日一二三四五六"[(d.getDay() + 7) % 7];
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${wd}`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  const PIN_SVG =
    '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M7.4 1.2l3.4 3.4-1.6.4-2 2 .4 2.6-1.2 1.2-2.3-2.3L1.6 11l-.9-.9 2.6-2.6L1 5.2 2.2 4l2.6.4 2-2 .6-1.2z"/></svg>';

  const TAG_BY_STATE = { new: "[S]", learning: "", review: "[T1]" };

  function cardHTML(card, i) {
    const focus = i === state.index;
    return `
      <article class="card ${focus ? "is-focus" : ""}" data-tier="${card.tier}" data-index="${i}" tabindex="0" role="button" aria-label="复习卡：${esc(card.title)}">
        <div class="card-top">
          <span class="card-num">No.${String(i + 1).padStart(2, "0")}</span>
          <div class="card-tags">
            ${card.verdict ? '<span class="tag tag-pin-label"></span>' : ""}
            ${TAG_BY_STATE[card.state] ? `<span class="tag">${TAG_BY_STATE[card.state]}</span>` : ""}
            <span class="tier-dot" title="知识层级 T${card.tier}"></span>
          </div>
        </div>
        <h2 class="card-title">${esc(card.title)}</h2>
        <p class="card-parent">${esc(card.parent)}</p>
        <div class="card-meta">
          <span>${card.due}</span><i class="dot"></i><span>T${card.tier}</span><i class="dot"></i><span>第 ${i + 1} 天</span>
        </div>
        ${focus ? answerHTML(card) : ""}
        <button class="card-pin" title="钉住这张卡" tabindex="-1">${PIN_SVG}</button>
      </article>`;
  }

  function answerHTML(card) {
    if (card.verdict) {
      const good = card.verdict.score >= 2;
      return `
        <div class="answer-zone">
          <div class="verdict">
            <b>${good ? "答对了 · 就钉在这里" : "差一点 · 再看一眼"}</b>
            ${card.verdict.notes.map((n) => esc(n)).join("<br>")}
          </div>
          <div class="answer-actions">
            <button class="btn" data-act="pause">稍后</button>
            <button class="btn btn-pin" data-act="next">下一张</button>
          </div>
        </div>`;
    }
    return `
      <div class="answer-zone">
        <textarea placeholder="用自己的话写下来，越短越好" aria-label="你的答案"></textarea>
        <div class="answer-actions">
          <button class="btn" data-act="hint">提示</button>
          <button class="btn btn-pin" data-act="check">交卷</button>
        </div>
      </div>`;
  }

  function syncChrome() {
    const total = state.cards.length;
    const pct = total ? Math.round(((state.index + 1) / total) * 100) : 0;
    $("progress").style.width = pct + "%";
    $("stepper").textContent = `${Math.min(state.index + 1, total)} / ${total}`;
    $("day-date").textContent = todayText();
    $("subject").querySelector("span").textContent = SUBJECTS[state.subjectIndex];
    document.title = `tack · ${SUBJECTS[state.subjectIndex]}`;
    b.invoke("notify_hud", {
      due: Math.max(0, total - state.index),
      mode: "flow",
    }).catch(() => {});
  }

  function render() {
    stream.innerHTML = state.cards.length
      ? state.cards.map(cardHTML).join("")
      : `<div class="empty">
           <p class="empty-title">今天没有要复习的卡</p>
           <p class="empty-hint">把教材拖进来，或者按住任意一段文字 450ms 钉一张新卡。</p>
         </div>`;
    syncChrome();
    wireCardEvents();
    const focusEl = stream.querySelector(".card.is-focus");
    if (focusEl && "scrollIntoView" in focusEl) {
      focusEl.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------- 批改（离线启发式，G0 用） ---------- */

  function heuristicGrade(card, answer) {
    const a = answer.toLowerCase();
    const hit = card.keys.filter((k) => a.includes(k.toLowerCase()));
    const score = Math.min(3, hit.length);
    if (score >= 2) {
      return { score, notes: card.points };
    }
    const missing = card.keys.filter((k) => !a.includes(k.toLowerCase())).slice(0, 2);
    const notes = [
      "答案里缺了：" + (missing.length ? missing.join("、") : "关键的一环") + "。",
      "参考这条：" + card.points[0],
    ];
    return { score, notes };
  }

  /* ---------- 交互 ---------- */

  function wireCardEvents() {
    stream.querySelectorAll(".card").forEach((el) => {
      const idx = Number(el.dataset.index);
      el.addEventListener("click", (e) => {
        if (e.target.closest("button, textarea")) return;
        if (idx !== state.index) {
          state.index = idx;
          render();
        }
      });

      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (idx !== state.index) {
          state.index = idx;
          render();
        }
        cardMenu(e.clientX, e.clientY, state.index);
      });

      const pinBtn = el.querySelector(".card-pin");
      if (pinBtn) {
        pinBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (idx !== state.index) {
            state.index = idx;
            render();
          }
          pinCard(state.cards[state.index], stream.querySelector(".card.is-focus"));
        });
      }

      el.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          act(idx, btn.dataset.act, el);
        });
      });
    });
  }

  /* ---------- 右键菜单 ---------- */

  function cardMenu(x, y, idx) {
    const card = state.cards[idx];
    if (!card) return;
    const reviewing = !!card.verdict;
    window.openMenu(x, y, [
      {
        label: "钉住这张卡",
        hint: "P",
        run: () => {
          const el = stream.querySelector(".card.is-focus");
          pinCard(card, el);
          say("已钉住 · 明天先回看");
        },
      },
      {
        label: reviewing ? "再练一次" : "现在练习一次",
        hint: "Enter",
        run: () => {
          card.verdict = null;
          render();
          const ta = stream.querySelector(".card.is-focus textarea");
          if (ta) ta.focus();
        },
      },
      { sep: true },
      {
        label: "今晚再看",
        hint: "L",
        run: () => {
          card.due = "今晚";
          render();
          say("已排到今晚 20:00");
        },
      },
      {
        label: reviewing ? "明天再来" : "跳过这张",
        hint: "S",
        run: () => {
          state.cards.splice(idx, 1);
          state.index = Math.min(state.index, state.cards.length - 1);
          render();
          say("已挪到明天");
        },
      },
      { sep: true },
      {
        label: "放下这张卡",
        danger: true,
        run: () => {
          state.cards.splice(idx, 1);
          state.index = Math.min(state.index, state.cards.length - 1);
          render();
          say("已放下 · 想它回来就重新拖动原文");
        },
      },
    ]);
  }

  function subjectMenu(x, y) {
    const items = SUBJECTS.map((name, i) => ({
      label: name,
      checked: i === state.subjectIndex,
      run: () => {
        state.subjectIndex = i;
        syncChrome();
        say("已切到 " + name);
      },
    }));
    items.push(
      { sep: true },
      { label: "Ctrl+Tab 循环切换", disabled: true, run: null }
    );
    window.openMenu(x, y, items);
  }

  /* ---------- 过卡动作 ---------- */

  function act(idx, action, cardEl) {
    const card = state.cards[idx];
    if (!card || !cardEl) return;
    const ta = cardEl.querySelector("textarea");

    if (action === "check") {
      const answer = (ta?.value || "").trim();
      if (!answer) {
        if (ta) {
          ta.focus();
          ta.placeholder = "先写一句再交卷，哪怕只有半句";
        }
        return;
      }
      card.verdict = heuristicGrade(card, answer);
      card.state = card.verdict.score >= 2 ? "review" : "learning";
      render();
      return;
    }

    if (action === "next") {
      if (idx + 1 < state.cards.length) {
        state.index = idx + 1;
        render();
      } else {
        finishDay();
      }
      return;
    }

    if (action === "hint") {
      if (ta) {
        ta.value = card.points[0];
        ta.focus();
      }
      return;
    }

    if (action === "pause") {
      state.cards.splice(idx, 1);
      state.index = Math.min(state.index, state.cards.length - 1);
      render();
    }
  }

  function finishDay() {
    stream.innerHTML = `
      <div class="empty">
        <p class="tag tag-ready"></p>
        <p class="empty-title">今天的线走完了</p>
        <p class="empty-hint">错的卡会在明天先出现，对的卡往后挪。明早这里自动铺开。</p>
      </div>`;
    $("progress").style.width = "100%";
    $("stepper").textContent = "完成";
    $("foot-hint").textContent = "今天到此为止";
    $("btn-solid").disabled = true;
    b.invoke("notify_hud", { due: 0, mode: "ready" }).catch(() => {});
  }

  /* ---------- 长按开钉 ---------- */

  function openAnchor(text, pointer) {
    const card = state.cards[state.index];
    b.invoke("open_anchor", {
      selected: text,
      title: card ? card.title : "新概念",
      parent: card ? card.parent.slice(0, 500) : "",
      prev: "上一轮：你把它归到了 T" + (card ? card.tier : "2"),
      next: "下一轮：明天先回看这一张",
    }).catch((err) => console.warn("open_anchor:", err));

    if (!b.hasTauri) {
      // 浏览器预览：用一个小悬浮窗模拟锚点窗，方便调 UI
      previewAnchor(text, card, pointer);
    }
  }

  function previewAnchor(text, card, pointer) {
    document.querySelectorAll(".preview-anchor").forEach((n) => n.remove());
    const el = document.createElement("aside");
    el.className = "preview-anchor";
    el.style.cssText = `
      position:fixed;z-index:50;width:272px;min-height:260px;
      left:${Math.min((pointer?.x ?? 200) + 20, innerWidth - 292)}px;
      top:${Math.min((pointer?.y ?? 120), innerHeight - 300)}px;
      background:var(--paper-raised);border:1px solid var(--hair);
      border-radius:14px;box-shadow:0 12px 40px rgba(30,28,25,.18);
      padding:14px 16px;font-size:12px;color:var(--ink-soft)`;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span class="pinhead" style="transform:scale(.8)"></span>
        <span class="tag tag-fork"></span>
        <span style="margin-left:auto;color:var(--ink-faint);font-family:var(--font-data);font-size:10px">预览</span>
      </div>
      <div style="font-family:var(--font-display);font-size:16px;font-weight:600;line-height:1.5;color:var(--ink)">${esc(text)}</div>
      <div class="hair" style="margin:12px 0"></div>
      <div style="border-left:2px solid var(--pin);padding-left:10px;line-height:1.7;opacity:.8">${esc(card ? card.parent : "")}</div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn" style="flex:1">[X] 丢弃</button>
        <button class="btn btn-pin" style="flex:1">[PIN] 钉住</button>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) el.remove();
    });
    document.body.appendChild(el);
  }

  /* ---------- 钉住 ---------- */

  function pinCard(card, el) {
    if (!card) return;
    b.invoke("pin_anchor", {
      card: { title: card.title, line: card.points[0], at: new Date().toISOString() },
    }).catch(() => {});
    if (el && el.animate) {
      el.animate(
        [
          { transform: "scale(0.995)" },
          { transform: "scale(1.004)" },
          { transform: "scale(1)" },
        ],
        { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" }
      );
    }
  }

  /* ---------- 顶部与底栏 ---------- */

  $("btn-down").addEventListener("click", async () => {
    if (!b.hasTauri) return;
    const w = window.__TAURI__.window.getCurrentWindow();
    await w.minimize();
  });

  $("btn-close").addEventListener("click", async () => {
    if (!b.hasTauri) {
      $("shell").style.opacity = "0.2";
      return;
    }
    const w = window.__TAURI__.window.getCurrentWindow();
    await w.hide();
  });

  $("subject").addEventListener("click", () => {
    state.subjectIndex = (state.subjectIndex + 1) % SUBJECTS.length;
    syncChrome();
  });

  $("subject").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    subjectMenu(e.clientX, e.clientY);
  });

  $("btn-help").addEventListener("click", () => window.toggleKeys());
  $("btn-help").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.openMenu(e.clientX, e.clientY, [
      { label: "键位表", hint: "?", run: () => window.toggleKeys() },
      {
        label: "复制当前卡原文",
        run: () => {
          const card = state.cards[state.index];
          if (!card) return;
          copyText(`${card.title}\n${card.parent}`);
        },
      },
      { sep: true },
      { label: "今天到这里，收窗", run: () => $("btn-close").click() },
    ]);
  });

  function copyText(text) {
    const done = () => say("已复制");
    const fail = () => say("这台机器不允许剪贴板写入");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  $("btn-solid").addEventListener("click", () => {
    const card = state.cards[state.index];
    if (!card) return;
    card.verdict = { score: 3, notes: card.points };
    card.state = "review";
    if (state.index + 1 < state.cards.length) state.index += 1;
    render();
  });

  $("btn-later").addEventListener("click", () => {
    if (!state.cards.length) return;
    state.cards.splice(state.index, 1);
    state.index = Math.min(state.index, state.cards.length - 1);
    render();
  });

  /* ---------- 空白处右键 ---------- */

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (e.target.closest(".card, .subject-chip, .icon-btn, .ctx, input, textarea")) return;
    window.openMenu(e.clientX, e.clientY, [
      { label: "拖入教材开始导入", run: () => say("把 PDF / Markdown 拖到这里就行") },
      { label: "键位表", hint: "?", run: () => window.toggleKeys() },
      { sep: true },
      {
        label: "回到今天开头",
        hint: "Ctrl+N",
        run: () => stream.scrollTo({ top: 0, behavior: "smooth" }),
      },
      { label: "收窗", run: () => $("btn-close").click() },
    ]);
  });

  /* ---------- 快捷键 ---------- */

  function isTyping(e) {
    const t = e.target;
    return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
  }

  function currentCardEl() {
    return stream.querySelector(".card.is-focus");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.querySelector(".keys-veil.on")) {
        e.preventDefault();
        window.toggleKeys();
        return;
      }
      if (document.querySelector(".preview-anchor")) return;
    }

    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      state.subjectIndex = (state.subjectIndex + 1) % SUBJECTS.length;
      syncChrome();
      return;
    }
    if (e.ctrlKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      stream.scrollTo({ top: 0, behavior: "smooth" });
      $("foot-hint").textContent = "新的一天从这里开始";
      return;
    }

    if (isTyping(e)) {
      // 输入框内只认 Ctrl+Enter：交卷
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        act(state.index, "check", currentCardEl());
      }
      return;
    }

    const card = state.cards[state.index];
    const cardEl = currentCardEl();

    switch (e.key) {
      case "?":
        e.preventDefault();
        window.toggleKeys();
        break;
      case "Enter":
        if (!cardEl || !card) break;
        e.preventDefault();
        act(state.index, card.verdict ? "next" : "check", cardEl);
        break;
      case " ":
        if (!cardEl || !card || card.verdict) break;
        e.preventDefault();
        act(state.index, "hint", cardEl);
        break;
      case "n":
      case "N":
        if (!cardEl || !card) break;
        e.preventDefault();
        act(state.index, card.verdict ? "next" : "check", cardEl);
        break;
      case "s":
      case "S":
        if (!cardEl) break;
        e.preventDefault();
        $("btn-later").click();
        say("已挪到明天");
        break;
      case "p":
      case "P":
        if (!cardEl || !card) break;
        e.preventDefault();
        pinCard(card, cardEl);
        say("已钉住 · 明天先回看");
        break;
      case "l":
      case "L":
        if (!card) break;
        e.preventDefault();
        card.due = "今晚";
        render();
        say("已排到今晚 20:00");
        break;
      case "c":
      case "C":
        if (!cardEl || !card) break;
        e.preventDefault();
        copyText(`${card.title}\n${card.parent}`);
        break;
    }
  });

  /* ---------- 拖动导入 ---------- */

  const veil = $("veil");
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    veil.classList.add("on");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) veil.classList.remove("on");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    veil.classList.remove("on");
    const names = [...(e.dataTransfer?.files || [])].map((f) => f.name);
    if (names.length) {
      $("foot-hint").textContent = `已收到 ${names.length} 个文件 · 正在切片`;
      setTimeout(() => ($("foot-hint").textContent = "切片完成 · 从任意一段长按开钉"), 1400);
    }
  });

  b.on("main:dropped", (paths) => {
    $("foot-hint").textContent = `已收到 ${paths.length} 个文件 · 正在切片`;
    setTimeout(() => ($("foot-hint").textContent = "切片完成 · 从任意一段长按开钉"), 1400);
  });

  b.on("main:pinned", (card) => {
    $("foot-hint").textContent = `已钉住：${card.title}`;
  });

  /* ---------- 启动 ---------- */

  window.installLongPress(stream, openAnchor, $("press-hint"));
  render();
})();
