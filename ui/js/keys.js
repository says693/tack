/* Native dialog provides focus containment, Escape, and focus restoration. */
(function () {
  let dialog;
  window.toggleKeys=function () {
    if(!dialog){
      dialog=document.createElement("dialog");dialog.className="app-dialog keys-sheet";dialog.id="keys-dialog";
      dialog.setAttribute("aria-label","键位表");
      dialog.innerHTML=`<form method="dialog"><button class="btn dialog-close">关闭</button></form>
        <h2>键位表</h2>
        <p>Enter：交卷 / 下一张</p><p>输入框内 Ctrl+Enter：交卷</p>
        <p>Space：查看提示（不覆盖答案草稿）</p><p>N：下一张待复习卡</p>
        <p>S：安排明天复习</p><p>L：安排今天 20:00 复习</p>
        <p>P：从原文钉新卡</p><p>? / F1：打开键位表</p>
        <p>Ctrl+Shift+T：全局打开 / 收起主窗</p><p>Esc：关闭当前对话框</p>
        <p>菜单或对话框开启时，背景复习快捷键暂停。</p>`;
      document.body.append(dialog);
    }
    if(dialog.open)dialog.close();else dialog.showModal();
  };
})();
