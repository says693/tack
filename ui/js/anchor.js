/*
 * tack · 锚点窗
 * 只读钉子：一句话提炼 + 原文对照。关闭 = 丢弃或钉住，二者都把
 * 一句话结晶带回主窗（钉住时额外落一张卡）。
 */

(function () {
  const b = window.tackBridge;
  const $ = (id) => document.getElementById(id);

  let seed = null;
  let pinned = false;

  /* 取 seed，再按 seed 填内容 */
  async function load() {
    seed = (await b.invoke("anchor_seed").catch(() => null)) || {};
    paint(seed);
  }

  function paint(s) {
    const selected = (s.selected || "").trim();
    const title = (s.title || "").trim();

    // 命名框：默认选中文字，用户可直接改名
    const nameInput = $("name");
    if (!pinned) {
      nameInput.value = selected || "";
      $("name-field").classList.add("on");
    }

    // 一句话提炼：G0 先做可读的本地提炼（取首句），之后由内核替换
    const firstSentence = splitFirst(selected);
    $("line").textContent = firstSentence || title || "这里会出现一句话提炼";

    // 原文对照
    $("quote").textContent = selected || "（没有选中原文）";
    $("src").textContent = title ? "来自 · " + title : "";

    // 父会话脉络：前后各一条 + 摘要
    const list = $("parent-list");
    list.innerHTML = "";
    const lines = [s.prev, s.parent, s.next].filter(Boolean);
    if (!lines.length) {
      $("parent-box").hidden = true;
    } else {
      $("parent-box").hidden = false;
      lines.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        list.appendChild(li);
      });
    }

    // 正文顶部滚回起点
    $("body").scrollTop = 0;
    $("shell").classList.remove("pinned");
  }

  function splitFirst(text) {
    if (!text) return "";
    const cut = text.split(/(?<=[。！？；.!?;])\s*/);
    const first = (cut[0] || text).trim();
    return first.length > 28 ? first.slice(0, 28) + "…" : first;
  }

  /* 命名即概念名 */
  function currentName() {
    const v = $("name").value.trim();
    return v || (seed?.selected || "").trim().slice(0, 24);
  }

  /* 钉住 */
  async function pin() {
    if (pinned) return;
    pinned = true;

    const name = currentName();
    const line = splitFirst(seed?.selected || "") || name;
    const card = {
      title: name || "未命名概念",
      line,
      at: new Date().toISOString(),
    };

    await b.invoke("pin_anchor", { card }).catch((err) => console.warn(err));
    $("shell").classList.add("pinned");

    // 小停顿让用户看见"钉下去"的动作，再关窗
    setTimeout(() => closeWindow(), 340);
  }

  /* 丢弃：一句话结晶仍回到父会话，但不落卡 */
  async function discard() {
    await b.invoke("close_anchor").catch(() => {});
    closeWindow();
  }

  function closeWindow() {
    if (b.hasTauri) {
      const w = window.__TAURI__.window.getCurrentWindow();
      w.hide();
    } else {
      // 浏览器预览：留一句话在页面上，不真的关
      $("kicker").textContent = "锚点已关闭";
      document.body.style.opacity = "0.55";
      setTimeout(() => {
        document.body.style.opacity = "";
        $("kicker").textContent = "锚点 · 只读";
      }, 900);
    }
  }

  /* 事件 */

  $("btn-pin").addEventListener("click", pin);
  $("btn-discard").addEventListener("click", discard);
  $("btn-x").addEventListener("click", discard);

  $("name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pin();
    }
  });

  /* 右键菜单：锚点窗只做四件事 */
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.openMenu(e.clientX, e.clientY, [
      {
        label: "复制原文",
        hint: "C",
        run: () => {
          navigator.clipboard?.writeText((seed && seed.selected) || "").then(
            () => window.notify("已复制原文"),
            () => window.notify("这台机器不允许剪贴板写入")
          );
        },
      },
      {
        label: "改名后再钉",
        hint: "F2",
        run: () => {
          $("name-field").classList.add("on");
          $("name").focus();
          $("name").select();
        },
      },
      { sep: true },
      {
        label: "钉住并关闭",
        hint: "Enter",
        run: pin,
      },
      {
        label: "丢弃",
        hint: "Esc",
        danger: true,
        run: discard,
      },
    ]);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      e.preventDefault();
      $("name-field").classList.add("on");
      $("name").focus();
      $("name").select();
    }
    if (e.key === "Escape" && !e.target.closest("input")) {
      e.preventDefault();
      discard();
    }
    if ((e.key === "c" || e.key === "C") && !e.target.closest("input")) {
      navigator.clipboard?.writeText((seed && seed.selected) || "").then(
        () => window.notify("已复制原文"),
        () => {}
      );
    }
  });

  // 主窗每次开钉，Rust 会发 anchor:refresh；此时重新取种子，避免看到上一次的内容
  b.on("anchor:refresh", () => {
    pinned = false;
    $("name-field").classList.add("on");
    load();
  });

  // Ctrl+W 关闭
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      discard();
    }
  });

  load();
})();
