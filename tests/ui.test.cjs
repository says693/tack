const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {JSDOM, VirtualConsole} = require("jsdom");
const root=path.resolve(__dirname,"..");
const clone=x=>JSON.parse(JSON.stringify(x));
const cards=()=>[1,2].map(id=>({id,title:`卡片 ${id}`,parent:`原文 ${id}：细胞膜具有选择透过性。`,
  prompt:"有什么特点？",answer:"细胞膜具有选择透过性",line:"提示",tier:1,state:"new",due_at:0,source:"教材"}));
async function settle(dom) {
  for(let i=0;i<12;i++) await new Promise(r=>setImmediate(r));
  return dom.window.document;
}
function fixture(name="main",options={}) {
  const state={cards:cards(),calls:[],events:{},subject:"default",fail:options.fail||null};
  const bridge={
    hasTauri:true,
    async on(event,cb){state.events[event]=cb;return ()=>{};},
    async invoke(cmd,args){
      state.calls.push({cmd,args});
      if(options.invoke)return options.invoke(cmd,args,state);
      if(cmd==="anchor_seed")return {subject:"default",selected:"原文内容。",title:"标题",parent:"上下文"};
      if(cmd==="hud_status")return {due:2,mode:"offline"};
      if(cmd==="pick_files")return ["C:\\test.md"];
      return null;
    },
    async core(req){
      state.calls.push(clone(req));
      if(state.fail===req.op)throw new Error("injected failure");
      if(options.core)return options.core(req,state);
      switch(req.op){
        case "subjects":return {subjects:[{slug:"default",name:"生物"},{slug:"math",name:"数学"}],data_dir:"test",config_file:"config"};
        case "snapshot":return {cards:req.subject==="math"?[]:clone(state.cards),
          due:req.subject==="math"?0:state.cards.length,mode:"offline",suspended:[],next_due:null};
        case "review":state.cards=state.cards.filter(c=>c.id!==req.card_id);
          return {score:3,notes:["已保存"],method:"offline",due_at:2000000000};
        case "defer":state.cards=state.cards.filter(c=>c.id!==req.card_id);return {due_at:2000000000};
        case "pin":return {id:3,title:req.title};
        case "search":return {hits:[]};
        case "import":return {cards_added:1};
        default:throw new Error("Unexpected operation "+req.op);
      }
    },
  };
  const errors=[];
  const console=new VirtualConsole();console.on("jsdomError",e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync(path.join(root,"ui",name+".html"),"utf8"),
    {url:"http://localhost/",runScripts:"outside-only",virtualConsole:console});
  const w=dom.window;
  Object.defineProperty(w.crypto,"randomUUID",{value:randomUUID});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  w.__TAURI__={window:{getCurrentWindow:()=>({minimize:async()=>{}})}};
  w.tackBridge=bridge;
  for(const script of w.document.querySelectorAll("script[src]")){
    const src=script.getAttribute("src");
    if(src==="js/bridge.js")continue;
    w.eval(fs.readFileSync(path.join(root,"ui",src),"utf8"));
  }
  return {dom,w,state,errors};
}
function key(w,target,k,extra={}){
  target.dispatchEvent(new w.KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true,...extra}));
}
function answer(w,text){
  const ta=w.document.querySelector("textarea");ta.value=text;
  ta.dispatchEvent(new w.Event("input",{bubbles:true}));
}
test("real-data startup, subject switch, no cross-subject demo",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  assert.equal(d.querySelectorAll(".card").length,2);
  assert.equal(d.getElementById("subject").disabled,false);
  d.getElementById("subject").click();await settle(f.dom);
  d.getElementById("subject-select").value="math";
  d.getElementById("subject-select").dispatchEvent(new f.w.Event("change"));
  await settle(f.dom);
  assert.equal(d.querySelectorAll(".card").length,0);
  assert.match(d.getElementById("subject").textContent,/数学/);
  assert.equal(f.errors.length,0);
});
test("switching cards preserves answer draft; hint does not overwrite",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  answer(f.w,"未提交的答案");
  d.querySelectorAll(".card-title")[1].click();
  d.querySelectorAll(".card-title")[0].click();
  assert.equal(d.querySelector("textarea").value,"未提交的答案");
  d.querySelector('[data-act="hint"]').click();await settle(f.dom);
  assert.equal(d.querySelector("textarea").value,"未提交的答案");
});
test("background refresh preserves card DOM, focus, selection and expanded source",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  const card=d.querySelector(".card"), ta=d.querySelector("textarea"), source=card.querySelector("details");
  source.open=true;
  f.w.dispatchEvent(new f.w.Event("focus"));await settle(f.dom);
  assert.equal(d.querySelector(".card"),card);
  assert.equal(source.open,true);
  answer(f.w,"保留输入位置");ta.focus();ta.setSelectionRange(1,3);
  f.w.dispatchEvent(new f.w.Event("focus"));await settle(f.dom);
  assert.equal(d.activeElement,ta);
  assert.equal(ta.selectionStart,1);
  assert.equal(ta.selectionEnd,3);
  assert.equal(ta.disabled,false);
});
test("remembering last card completes the day after backend confirmation",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  d.getElementById("btn-solid").click();await settle(f.dom);
  d.getElementById("btn-solid").click();await settle(f.dom);
  assert.equal(d.getElementById("stepper").textContent,"完成");
  assert.equal(d.querySelectorAll(".card").length,0);
  assert.equal(f.state.calls.filter(c=>c.op==="review").length,2);
  assert.equal(d.getElementById("btn-solid").disabled,true);
});
test("N moves focus without inventing a review or dropping its draft",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  answer(f.w,"草稿");
  key(f.w,d.body,"n");await settle(f.dom);
  assert.equal(d.querySelector(".card.is-focus").dataset.id,"2");
  key(f.w,d.body,"n");await settle(f.dom);
  assert.equal(d.querySelector("textarea").value,"草稿");
  assert.equal(f.state.calls.filter(c=>c.op==="review").length,0);
});
test("failed review keeps draft and retry uses the same idempotency key",async t=>{
  const f=fixture("main",{fail:"review"});t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  answer(f.w,"正确的回答");
  d.querySelector('[data-act="check"]').click();await settle(f.dom);
  assert.equal(d.querySelector("textarea").value,"正确的回答");
  assert.equal(d.querySelector(".verdict"),null);
  assert.equal(d.getElementById("error").hidden,false);
  f.state.fail=null;
  d.querySelector('[data-act="check"]').click();await settle(f.dom);
  const attempts=f.state.calls.filter(c=>c.op==="review");
  assert.equal(attempts.length,2);
  assert.equal(attempts[0].request_id,attempts[1].request_id);
  assert.ok(d.querySelector(".verdict"));
});
test("help dialog blocks S shortcut and Enter does not submit background",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  d.getElementById("btn-help").click();
  assert.ok(d.querySelector("dialog[open]"));
  key(f.w,d.getElementById("btn-help"),"s");
  key(f.w,d.getElementById("btn-help"),"Enter");
  await settle(f.dom);
  assert.equal(f.state.calls.filter(c=>c.op==="defer"||c.op==="review").length,0);
});
test("menu Enter activates only the menu item",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  answer(f.w,"草稿");let invoked=0;
  f.w.openMenu(10,10,[{label:"<not-html>",run(){invoked++;}}]);
  assert.equal(d.querySelector(".ctx-row").textContent,"<not-html>");
  key(f.w,d.querySelector(".ctx-row"),"Enter");await settle(f.dom);
  assert.equal(invoked,1);
  assert.equal(f.state.calls.filter(c=>c.op==="review").length,0);
});
test("file import failure never shows a fake completion",async t=>{
  const f=fixture("main",{fail:"import"});t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  d.getElementById("btn-import").click();await settle(f.dom);
  assert.match(d.getElementById("error").textContent,/当前文件失败/);
  assert.doesNotMatch(d.getElementById("foot-hint").textContent,/已导入并保存|切片完成/);
  assert.equal(d.querySelectorAll(".card").length,2);
});
test("native drop paths are passed to the real import operation",async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  f.state.events["main:dropped"](["C:\\教材.md"]);await settle(f.dom);
  assert.equal(f.state.calls.find(c=>c.op==="import").path,"C:\\教材.md");
  assert.match(d.getElementById("foot-hint").textContent,/已导入并保存/);
});
test("double click while request is pending does not duplicate review",async t=>{
  let finish;
  const f=fixture("main");t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  const original=f.w.tackBridge.core.bind(f.w.tackBridge);
  f.w.tackBridge.core=async req=>{
    if(req.op==="review")await new Promise(resolve=>{finish=resolve;});
    return original(req);
  };
  d.getElementById("btn-solid").click();
  d.getElementById("btn-solid").click();
  await settle(f.dom);finish();await settle(f.dom);
  assert.equal(f.state.calls.filter(c=>c.op==="review").length,1);
});
test("failed anchor save stays open and can retry with same key",async t=>{
  const f=fixture("anchor",{fail:"pin"});t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  d.getElementById("btn-pin").click();await settle(f.dom);
  assert.equal(d.getElementById("shell").classList.contains("pinned"),false);
  assert.equal(d.getElementById("btn-pin").disabled,false);
  assert.equal(f.state.calls.filter(c=>c.cmd==="close_anchor").length,0);
  f.state.fail=null;d.getElementById("btn-pin").click();await settle(f.dom);
  const attempts=f.state.calls.filter(c=>c.op==="pin");
  assert.equal(attempts[0].request_id,attempts[1].request_id);
  assert.ok(d.getElementById("shell").classList.contains("pinned"));
  f.state.events["anchor:refresh"]();await settle(f.dom);
  assert.equal(d.getElementById("name").disabled,false);
});
test("HUD uses native menu instead of clipped DOM popup",async t=>{
  const f=fixture("hud");t.after(()=>f.dom.window.close());const d=await settle(f.dom);
  d.getElementById("hud-menu").click();await settle(f.dom);
  assert.ok(f.state.calls.some(c=>c.cmd==="show_hud_menu"));
  assert.equal(d.querySelector(".ctx"),null);
  assert.equal(d.getElementById("due").textContent,"2 待复习");
});
test("browser bridge explicitly refuses business operations",async t=>{
  const dom=new JSDOM("",{runScripts:"outside-only"});t.after(()=>dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root,"ui","js","bridge.js"),"utf8"));
  await assert.rejects(dom.window.tackBridge.core({op:"snapshot"}),/静态预览/);
});
