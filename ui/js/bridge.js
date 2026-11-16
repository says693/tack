/*
 * tack · 前后端桥
 * - 在 Tauri 里：走 invoke / 事件
 * - 在浏览器里（预览 ui/preview.html 或直接开 main.html）：走内存 mock，
 *   所有交互都能玩，只是不落盘。这样调 UI 不用每次编译 Rust。
 */

(function () {
  const TAURI = window.__TAURI__;
  const hasTauri =
    !!TAURI && typeof TAURI.core?.invoke === "function";
  const listening = new Set();

  function mockPins() {
    if (!window.__tackMock) window.__tackMock = { pins: [], seed: null };
    return window.__tackMock;
  }

  const bridge = {
    hasTauri,

    async invoke(cmd, args) {
      if (hasTauri) return TAURI.core.invoke(cmd, args);
      const m = mockPins();
      switch (cmd) {
        case "toggle_main":
          return true;
        case "notify_hud":
          return null;
        case "anchor_seed":
          return (
            m.seed || {
              selected: "两个方向都逆浓度梯度，因此属于主动运输。",
              title: "钠钾泵为什么属于主动运输",
              parent:
                "钠钾泵每消耗一分子 ATP，把 3 个 Na⁺ 泵出细胞、2 个 K⁺ 泵入细胞，逆浓度梯度进行。",
              prev: "上一轮：你把它归到了 T1",
              next: "下一轮：明天先回看这一张",
            }
          );
        case "open_anchor":
          m.seed = {
            selected: args.selected,
            title: args.title,
            parent: args.parent,
            prev: args.prev,
            next: args.next,
          };
          return null;
        case "pin_anchor":
          m.pins.push(args.card);
          return null;
        case "close_anchor":
          return null;
        default:
          return null;
      }
    },

    on(event, handler) {
      if (hasTauri && !listening.has(event)) {
        TAURI.event.listen(event, (e) => {
          window.dispatchEvent(new CustomEvent("tack:" + event, { detail: e.payload }));
        });
        listening.add(event);
      }
      const wrapped = (e) => handler(e.detail);
      window.addEventListener("tack:" + event, wrapped);
      return () => window.removeEventListener("tack:" + event, wrapped);
    },
  };

  window.tackBridge = bridge;
})();
