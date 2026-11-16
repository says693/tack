/* Production has one IPC path. Browser preview never impersonates a working backend. */
(function () {
  const api = window.__TAURI__;
  const hasTauri = !!api && typeof api.core?.invoke === "function";
  window.tackBridge = {
    hasTauri,
    invoke(command, args) {
      if (!hasTauri) return Promise.reject(new Error("这是静态预览；请启动桌面应用使用学习功能。"));
      return api.core.invoke(command, args);
    },
    async on(event, handler) {
      if (!hasTauri) return () => {};
      return api.event.listen(event, e => handler(e.payload));
    },
    core(request) { return this.invoke("core_request", {request}); },
  };
})();
