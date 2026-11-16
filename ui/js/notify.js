/*
 * tack · 轻提示
 * 不用系统通知，不弹 Toast 库：在窗口底部浮一条纸片，1.6 秒自己走。
 */

(function () {
  let el = null;
  let timer = null;

  window.notify = function (text) {
    if (!el) {
      el = document.createElement("div");
      el.className = "mini-note";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove("on"), 1600);
  };
})();
