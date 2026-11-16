/*
 * tack · 右键菜单（纸片弹出）
 * 用法：
 *   window.openMenu(x, y, [
 *     { label: "钉住", hint: "P", run: () => ... },
 *     { sep: true },
 *     { label: "删除", danger: true, run: () => ... },
 *   ]);
 * Esc / 点空白 / 失焦 关闭；上下键与 Enter 可纯键盘操作。
 */

(function () {
  let menu = null;
  let index = -1;

  function close() {
    if (menu) {
      menu.remove();
      menu = null;
      index = -1;
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
    }
  }

  function outside(e) {
    if (menu && !menu.contains(e.target)) close();
  }

  function rows() {
    return menu ? [...menu.querySelectorAll(".ctx-row:not(.is-disabled)")] : [];
  }

  function focusRow(next) {
    const items = rows();
    if (!items.length) return;
    index = (next + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("is-active", i === index));
    items[index].focus({ preventScroll: true });
  }

  function openMenu(x, y, items) {
    close();
    menu = document.createElement("div");
    menu.className = "ctx";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items
      .map((it, i) => {
        if (it.sep) return '<div class="ctx-sep" role="separator"></div>';
        const cls = [
          "ctx-row",
          it.danger ? "is-danger" : "",
          it.disabled ? "is-disabled" : "",
          it.checked ? "is-checked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const tick = it.checked ? '<span class="ctx-tick" aria-hidden="true"></span>' : "";
        const hint = it.hint ? `<span class="ctx-hint">${it.hint}</span>` : "";
        return `<button class="${cls}" role="menuitem" data-i="${i}" ${it.disabled ? "disabled" : ""}>
          ${tick}<span class="ctx-label">${it.label}</span>${hint}
        </button>`;
      })
      .join("");
    document.body.appendChild(menu);

    // 贴边翻转：先放在指针处，量完尺寸再收进窗口内
    menu.style.left = "0px";
    menu.style.top = "0px";
    const r = menu.getBoundingClientRect();
    const left = x + r.width > window.innerWidth - 8 ? x - r.width : x;
    const top = y + r.height > window.innerHeight - 8 ? y - r.height : y;
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";

    menu.querySelectorAll(".ctx-row").forEach((el) => {
      const it = items[Number(el.dataset.i)];
      el.addEventListener("click", () => {
        if (it.disabled) return;
        close();
        it.run && it.run();
      });
    });

    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    const first = rows()[0];
    if (first) {
      index = 0;
      first.classList.add("is-active");
      first.focus({ preventScroll: true });
    }
  }

  document.addEventListener("keydown", (e) => {
    if (!menu) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(index - 1);
    }
  });

  window.openMenu = openMenu;
  window.closeMenu = close;
})();
