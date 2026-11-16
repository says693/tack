/* Small existing menu, using text nodes; captures its own keyboard context. */
(function () {
  let menu=null, previous=null;
  const rows=()=>menu?[...menu.querySelectorAll("button:not(:disabled)")]:[];
  function close(){
    if(!menu)return;
    menu.remove();menu=null;
    document.removeEventListener("keydown",key,true);
    window.removeEventListener("pointerdown",outside,true);
    window.removeEventListener("blur",close);
    if(previous?.isConnected)previous.focus();
  }
  function outside(e){if(menu&&!menu.contains(e.target))close();}
  function key(e){
    if(!menu)return;
    e.stopImmediatePropagation();
    const items=rows(), index=items.indexOf(document.activeElement);
    if(e.key==="Escape"||e.key==="Tab"){e.preventDefault();close();}
    else if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault();items[(index+(e.key==="ArrowDown"?1:items.length-1))%items.length]?.focus();
    }else if(e.key==="Enter"||e.key===" "){e.preventDefault();document.activeElement?.click();}
  }
  window.openMenu=function(x,y,items){
    close();previous=document.activeElement;
    menu=document.createElement("div");menu.className="ctx";menu.setAttribute("role","menu");
    items.forEach(item=>{
      if(item.sep){const sep=document.createElement("hr");menu.append(sep);return;}
      const button=document.createElement("button");button.className="ctx-row";button.type="button";
      button.textContent=item.label;button.disabled=!!item.disabled;button.setAttribute("role","menuitem");
      button.addEventListener("click",()=>{close();item.run?.();});menu.append(button);
    });
    document.body.append(menu);
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+"px";
    menu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+"px";
    document.addEventListener("keydown",key,true);
    window.addEventListener("pointerdown",outside,true);
    window.addEventListener("blur",close);
    rows()[0]?.focus();
  };
  window.closeMenu=close;
})();
