(function () {
  const b=window.tackBridge, $=id=>document.getElementById(id);
  let seed=null, submitting=false, saved=false;
  const requests=new Map();
  function error(err) {
    $("anchor-error").textContent=err?.message||String(err);
    $("anchor-error").hidden=false;
  }
  async function load() {
    if(submitting) { error("正在保存，请等待当前操作结束后再打开新锚点。"); return; }
    saved=false; $("btn-pin").disabled=true; $("anchor-error").hidden=true;
    try {
      seed=await b.invoke("anchor_seed");
      $("name").value=seed.title;
      $("name").disabled=false;
      $("name-field").classList.add("on");
      $("quote").textContent=seed.selected;
      $("line").textContent="确认原文，再钉到当前科目";
      $("src").textContent=`科目：${seed.subject}`;
      $("parent-list").replaceChildren();
      const item=document.createElement("li");item.textContent=seed.parent;$("parent-list").append(item);
      $("shell").classList.remove("pinned");$("save-status").textContent="";
      $("btn-pin").disabled=false;
    } catch(err){error(err);}
  }
  async function pin() {
    if(submitting||saved||!seed) return;
    const title=$("name").value.trim();
    if(!title){error("请填写概念名。");return;}
    const body={op:"pin",subject:seed.subject,selected:seed.selected,title};
    const signature=JSON.stringify(body);
    if(!requests.has(signature)) requests.set(signature,crypto.randomUUID());
    submitting=true;$("btn-pin").disabled=true;$("name").disabled=true;
    $("btn-discard").disabled=true;$("btn-x").disabled=true;
    $("anchor-error").hidden=true;$("save-status").textContent="正在保存…";
    try {
      await b.core({...body,request_id:requests.get(signature)});
      saved=true; requests.delete(signature); $("shell").classList.add("pinned");
      $("save-status").textContent="已保存。";
      try {
        await b.invoke("data_changed");
        await b.invoke("close_anchor");
      } catch(err){error("卡片已保存，但窗口更新失败。请在主窗点击刷新。");}
    } catch(err) {
      $("save-status").textContent="未确认保存，可重试（同一请求不会重复制卡）。";
      error(err);
    } finally {
      submitting=false;$("btn-pin").disabled=saved;$("name").disabled=saved;
      $("btn-discard").disabled=false;$("btn-x").disabled=false;
    }
  }
  function close() {if(!submitting)b.invoke("close_anchor").catch(error);}
  $("btn-pin").addEventListener("click",pin);
  $("btn-discard").addEventListener("click",close);
  $("btn-x").addEventListener("click",close);
  document.addEventListener("keydown",e=>{
    if(e.isComposing||e.defaultPrevented||document.querySelector(".ctx"))return;
    if(e.key==="Escape"){e.preventDefault();close();}
    else if(e.key==="Enter" && e.target.tagName!=="BUTTON"){e.preventDefault();pin();}
  });
  b.on("anchor:refresh",load).then(load).catch(error);
})();
