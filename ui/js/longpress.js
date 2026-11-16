/*
 * tack · 长按选中
 * 在阅读区按住鼠标/手指 450ms 不松开且几乎不移动 → 触发 onSelect(selectedText, anchorRect)。
 * 拖动、滚轮、离开元素都会取消；进度环画在指针旁。
 */

(function () {
  const HOLD_MS = 450;
  const MOVE_TOL = 6;

  const ringSvg = `
    <svg viewBox="0 0 26 26" aria-hidden="true">
      <circle class="bg" cx="13" cy="13" r="9"></circle>
      <circle class="fg" cx="13" cy="13" r="9"></circle>
    </svg>`;

  function makeRing() {
    const el = document.createElement("div");
    el.className = "press-ring";
    el.innerHTML = ringSvg;
    document.body.appendChild(el);
    return el;
  }

  /**
   * @param {Element} zone   监听区域
   * @param {(text:string, rect:DOMRect)=>void} onSelect
   * @param {Element} [hint] 可选：接近触发时显示的提示条
   */
  window.installLongPress = function (zone, onSelect, hint) {
    const ring = makeRing();
    let timer = null;
    let startX = 0;
    let startY = 0;
    let pressing = false;

    function reset() {
      clearTimeout(timer);
      timer = null;
      pressing = false;
      ring.classList.remove("on", "charging");
      if (hint) hint.classList.remove("on");
    }

    function charge(x, y) {
      ring.style.left = x + "px";
      ring.style.top = y + "px";
      ring.classList.add("on");
      void ring.offsetWidth;
      ring.classList.add("charging");
      if (hint) hint.classList.add("on");
    }

    function pickText(x, y) {
      const sel = window.getSelection();
      const inside =
        sel && sel.rangeCount && zone.contains(sel.anchorNode || sel.focusNode);
      if (inside && sel.toString().trim()) return sel.toString().trim();

      // 没有手动选择：取指针所在段落里最近的一句话
      const el = document.elementFromPoint(x, y);
      const p = el && el.closest("p, li, blockquote, .card-parent, .card-title");
      if (!p) return "";
      const text = (p.textContent || "").trim();
      if (!text) return "";
      const cut = text.split(/(?<=[。！？；.!?;])\s*/);
      return cut[0] ? cut[0].trim() : text.slice(0, 60);
    }

    zone.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (target.closest("button, input, textarea, a, summary")) return;
      pressing = true;
      startX = e.clientX;
      startY = e.clientY;
      charge(e.clientX, e.clientY);
      timer = setTimeout(() => {
        if (!pressing) return;
        const text = pickText(e.clientX, e.clientY);
        reset();
        if (text) onSelect(text, { x: e.clientX, y: e.clientY });
      }, HOLD_MS);
    });

    zone.addEventListener("pointermove", (e) => {
      if (!pressing) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOL) reset();
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      zone.addEventListener(ev, reset)
    );

    document.addEventListener("wheel", reset, { passive: true });
    window.addEventListener("blur", reset);
  };
})();
