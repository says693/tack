(async function () {
  const b=window.tackBridge, due=document.getElementById("due");
  function error(err){due.textContent="连接失败";due.title=err?.message||String(err);}
  function paint(status){
    if(status && typeof status.due==="number"){
      due.textContent=`${status.due} 待复习`; due.title=status.mode==="online"?"在线模式":"离线模式";
    }
  }
  document.getElementById("toggle-main").addEventListener("click",()=>b.invoke("toggle_main").catch(error));
  const menu=()=>b.invoke("show_hud_menu").catch(error);
  document.getElementById("hud-menu").addEventListener("click",menu);
  document.addEventListener("contextmenu",e=>{e.preventDefault();menu();});
  try {await b.on("hud:status",paint);paint(await b.invoke("hud_status"));} catch(err){error(err);}
})();
