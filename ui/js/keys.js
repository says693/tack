/*
 * tack · 键位表
 * 由主窗动态建出：遮罩 + 纸片 + 分组键位。按 ? / F1 / Esc 开合。
 */

(function () {
  const GROUPS = [
    {
      title: "主窗 · 过卡",
      rows: [
        { label: "提示（填入参考要点）", keys: ["Space"] },
        { label: "交卷 / 下一张", keys: ["Enter"] },
        { label: "输入框里交卷", keys: ["Ctrl", "Enter"] },
        { label: "跳过，明天再来", keys: ["S"] },
        { label: "钉住这张卡", keys: ["P"] },
        { label: "排到今晚", keys: ["L"] },
        { label: "复制原文", keys: ["C"] },
      ],
    },
    {
      title: "主窗 · 窗口",
      rows: [
        { label: "切换科目", keys: ["Ctrl", "Tab"] },
        { label: "回到今天开头", keys: ["Ctrl", "N"] },
        { label: "键位表", keys: ["?"], alt: "F1" },
      ],
    },
    {
      title: "锚点窗",
      rows: [
        { label: "用当前名字钉住", keys: ["Enter"] },
        { label: "丢弃并关闭", keys: ["Esc"] },
        { label: "丢弃并关闭（备用）", keys: ["Ctrl", "W"] },
      ],
    },
    {
      title: "全局",
      rows: [
        { label: "随时唤出 / 收起主窗", keys: ["Ctrl", "Shift", "T"] },
      ],
    },
  ];

  let veil = null;

  function combo(keys) {
    return `<span class="key-combo">${keys
      .map((k, i) => (i ? "<em>+</em>" : "") + `<kbd>${k}</kbd>`)
      .join("")}</span>`;
  }

  function build() {
    veil = document.createElement("div");
    veil.className = "keys-veil";
    veil.addEventListener("pointerdown", (e) => {
      if (e.target === veil) toggle();
    });
    veil.innerHTML = `
      <section class="keys-sheet" role="dialog" aria-label="键位表">
        <header class="keys-head">
          <span class="keys-title">键位表</span>
          <span class="keys-sub">ESC 关闭</span>
        </header>
        ${GROUPS.map(
          (g) => `
          <div class="keys-group">
            <h3>${g.title}</h3>
            ${g.rows
              .map(
                (r) => `
              <div class="keys-row">
                <span>${r.label}</span>
                ${combo(r.keys)}
                ${r.alt ? `<em style="font-style:normal;font-size:9px;color:var(--ink-faint)">或</em>${combo([r.alt])}` : ""}
              </div>`
              )
              .join("")}
          </div>`
        ).join("")}
      </section>`;
    document.body.appendChild(veil);
  }

  function toggle() {
    if (!veil) build();
    veil.classList.toggle("on");
  }

  window.toggleKeys = toggle;

  document.addEventListener("keydown", (e) => {
    if (e.key === "F1") {
      e.preventDefault();
      toggle();
    }
  });
})();
