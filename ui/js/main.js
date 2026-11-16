/* Real application state. Successful UI states follow committed core operations. */
(function () {
  "use strict";
  const b = window.tackBridge;
  const $ = id => document.getElementById(id);
  const stream = $("stream");
  const drafts = new Map();
  const pending = new Map();
  const state = {subject: null, subjects: [], cards: [], index: 0, due: 0,
    mode: "offline", suspended: [], nextDue: null, busy: false, ready: false, renderedSubject: null};
  const escape = value => String(value ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const keyFor = card => `${state.subject}:${card.id}`;
  const active = () => state.cards[state.index];
  const formatDate = value => new Date(value * 1000).toLocaleString("zh-CN");

  function error(err) {
    $("error").textContent = err?.message || String(err);
    $("error").hidden = false;
    const modal = document.querySelector("dialog[open]");
    if (modal) {
      let message = modal.querySelector(".dialog-error");
      if (!message) { message=document.createElement("p"); message.className="dialog-error error-banner"; message.setAttribute("role","alert"); modal.append(message); }
      message.textContent = $("error").textContent;
    }
  }
  function busy(on) {
    state.busy = on;
    $("shell").setAttribute("aria-busy", String(on));
    document.querySelectorAll(".data-control").forEach(el => { el.disabled = on; });
    $("subject").disabled = on || !state.ready;
    $("btn-solid").disabled = on || !active();
    $("btn-later").disabled = on || !active();
  }
  async function run(task) {
    if (state.busy) return;
    $("error").hidden = true;
    busy(true);
    try { await task(); } catch (err) { error(err); }
    finally { busy(false); }
  }
  async function write(op, args = {}) {
    const body = {op, subject: state.subject, ...args};
    const signature = JSON.stringify(body);
    if (!pending.has(signature)) pending.set(signature, crypto.randomUUID());
    const result = await b.core({...body, request_id: pending.get(signature)});
    pending.delete(signature);
    return result;
  }
  function chrome() {
    const name = state.subjects.find(s => s.slug === state.subject)?.name || "我的学习";
    $("subject").querySelector("span").textContent = name;
    $("subject").disabled = state.busy || !state.ready;
    document.title = `tack · ${name}`;
    $("day-date").textContent = new Date().toLocaleDateString("zh-CN", {month:"long",day:"numeric",weekday:"short"});
    $("day-tag").textContent = state.mode === "online" ? "在线模型" : "离线 · 关键词近似";
    $("stepper").textContent = state.due ? `待复习 ${state.due}` : "完成";
    $("progress").style.width = state.due ? "0%" : "100%";
    b.invoke("notify_hud", {due: state.due, mode: state.mode}).catch(error);
  }
  function cardHTML(card, index) {
    const focus = index === state.index;
    const result = card.verdict;
    return `<article class="card ${focus ? "is-focus" : ""}" data-tier="${card.tier}" data-id="${card.id}" tabindex="0"
               aria-label="复习卡：${escape(card.title)}">
      <div class="card-top"><span class="card-num">No.${card.id}</span><span class="card-tags">T${card.tier}</span></div>
      <h2 class="card-title">${escape(card.title)}</h2>
      <p class="question">${escape(card.prompt)}</p>
      <details class="source"><summary>查看原文与来源</summary><p class="card-parent">${escape(card.parent)}</p>
        <p>${escape(card.source)}</p></details>
      ${focus ? `<div class="answer-zone">${result
        ? `<div class="verdict" role="status"><b>${result.score}/3 · ${result.method === "offline" ? "离线近似评分" : result.method === "self" ? "自评" : "在线评分"}</b>
             ${result.notes.map(escape).join("<br>")}<p>下次复习：${formatDate(result.due_at)}</p></div>
             <button class="btn btn-pin data-control" data-act="next">下一张</button>`
        : `<textarea class="data-control" aria-label="你的答案" maxlength="8000" placeholder="用自己的话写下来">${escape(drafts.get(keyFor(card)) || "")}</textarea>
             <div class="answer-actions"><button class="btn" data-act="hint">查看提示</button>
             <button class="btn btn-pin data-control" data-act="check">交卷</button></div>`}</div>` : ""}
      <button class="card-pin data-control" aria-label="从原文钉新卡" title="从原文钉新卡" data-act="pin">钉</button>
    </article>`;
  }
  function render() {
    state.renderedSubject = state.subject;
    $("foot-hint").textContent = active()?.verdict
      ? "评分与复习记录已保存；按下一张继续。"
      : state.cards.length ? "原文可长按钉卡；所有学习操作在保存后反馈。"
      : state.nextDue ? "当前科目复习已完成，记录已保存。" : "导入材料开始当前科目的学习。";
    stream.innerHTML = state.cards.length ? state.cards.map(cardHTML).join("") :
      `<div class="empty"><p class="empty-title">今天没有待复习的卡</p>
       <p class="empty-hint">${state.nextDue ? `下次复习：${formatDate(state.nextDue)}` : "导入 PDF、Markdown 或文本文件，生成真正保存的学习卡。"}</p></div>`;
    chrome();
    busy(state.busy);
  }
  async function refresh(quiet = false) {
    if (!state.subject) return;
    const subject = state.subject;
    const snap = await b.core({op:"snapshot",subject});
    if (subject !== state.subject || (quiet && !canQuietRefresh())) return;
    const currentId = active()?.id;
    const changed = state.renderedSubject !== subject || JSON.stringify(state.cards) !== JSON.stringify(snap.cards);
    state.cards = snap.cards;
    state.due = snap.due; state.mode = snap.mode;
    state.suspended = snap.suspended; state.nextDue = snap.next_due;
    state.index = Math.max(0, state.cards.findIndex(c => c.id === currentId));
    if (changed) render();
    else chrome();
  }
  async function subjects() {
    const result = await b.core({op:"subjects"});
    state.subjects = result.subjects;
    if (!state.subjects.some(s => s.slug === state.subject)) state.subject = state.subjects[0]?.slug;
    $("data-location").textContent = `数据：${result.data_dir}\n配置：${result.config_file}`;
  }
  async function review(kind) {
    const card = active();
    if (!card) return;
    if (card.verdict) { await refresh(); return; }
    const answer = drafts.get(keyFor(card)) || "";
    if (kind === "answer" && !answer.trim()) throw new Error("请先填写答案。");
    const result = await write("review", {card_id:card.id,answer,kind});
    drafts.delete(keyFor(card));
    if (kind === "remembered") { await refresh(); return; }
    card.verdict = result;
    const snap = await b.core({op:"snapshot",subject:state.subject});
    state.due = snap.due;
    render();
    $("foot-hint").textContent = "评分与复习记录已保存；按下一张继续。";
  }
  async function postpone(when) {
    if (!active()) return;
    const result = await write("defer", {card_id:active().id,when});
    await refresh();
    $("foot-hint").textContent = `已安排：${formatDate(result.due_at)}`;
  }
  async function openAnchor(text) {
    const card = active();
    await b.invoke("open_anchor", {seed:{subject:state.subject,selected:text,
      title:(card?.title || "新概念").slice(0,60),parent:card?.parent || text}});
  }
  async function act(action) {
    const card = active();
    if (!card) return;
    if (action === "check") await review("answer");
    else if (action === "next") {
      if (card.verdict) await refresh();
      else { state.index=(state.index+1)%state.cards.length; render(); }
    }
    else if (action === "hint") {
      window.notify(card.line);
    } else if (action === "pin") {
      await openAnchor(card.parent);
    }
  }
  stream.addEventListener("input", e => {
    if (e.target.matches("textarea") && active()) drafts.set(keyFor(active()), e.target.value);
  });
  stream.addEventListener("click", e => {
    const cardEl = e.target.closest(".card");
    if (!cardEl || state.busy) return;
    const index = state.cards.findIndex(c => c.id === Number(cardEl.dataset.id));
    const button = e.target.closest("[data-act]");
    if (button) { state.index=index; run(() => act(button.dataset.act)); return; }
    if (e.target.closest("textarea,button,summary,details")) return;
    if (index !== state.index) { state.index=index; render(); }
  });
  stream.addEventListener("contextmenu", e => {
    if (e.target.closest("textarea,input") || state.busy) return;
    const cardEl = e.target.closest(".card");
    if (!cardEl) return;
    e.preventDefault(); e.stopPropagation();
    state.index = state.cards.findIndex(c => c.id === Number(cardEl.dataset.id));
    render();
    window.openMenu(e.clientX,e.clientY,[
      {label:"从原文钉新卡",run:() => run(() => openAnchor(active().parent))},
      {label:"今晚 20:00 再看",run:() => run(() => postpone("tonight"))},
      {label:"明天再看",run:() => run(() => postpone("tomorrow"))},
      {label:"暂停复习（可恢复）",run:() => run(async()=>{
        await write("suspend",{card_id:active().id}); await refresh();
      })},
    ]);
  });
  async function importPaths(paths) {
    if (!Array.isArray(paths) || !paths.length) return;
    let count = 0;
    try {
      for (const path of paths) {
        $("foot-hint").textContent = `正在导入 ${count + 1}/${paths.length}；完成前请勿退出`;
        await write("import", {path});
        count++;
      }
    } catch (err) {
      throw new Error(`已完成 ${count}/${paths.length} 个文件。当前文件失败：${err?.message || err}`);
    } finally { await refresh(); }
    $("foot-hint").textContent = `${count} 个文件已导入并保存，重复导入不会重复制卡`;
  }
  $("btn-import").addEventListener("click", () => run(async()=>{
    const paths = await b.invoke("pick_files");
    await importPaths(paths);
  }));
  $("btn-refresh").addEventListener("click", () => run(refresh));
  $("btn-solid").addEventListener("click", () => run(() => review("remembered")));
  $("btn-later").addEventListener("click", () => run(() => postpone("tomorrow")));
  $("btn-close").addEventListener("click", () => b.invoke("hide_main").catch(error));
  $("btn-down").addEventListener("click", () => {
    if (b.hasTauri) window.__TAURI__.window.getCurrentWindow().minimize().catch(error);
  });
  $("btn-help").addEventListener("click", () => window.toggleKeys());

  function paintSubjects() {
    $("subject-select").replaceChildren(...state.subjects.map(s => {
      const option=document.createElement("option"); option.value=s.slug; option.textContent=s.name;
      option.selected=s.slug===state.subject; return option;
    }));
    $("suspended-list").replaceChildren(...state.suspended.map(c => {
      const item=document.createElement("p"); item.textContent=c.title + " ";
      if(c.state==="needs_verification") item.append("旧版答案待核对，请从来源重新制卡。");
      else {
        const button=document.createElement("button"); button.className="btn data-control"; button.textContent="恢复";
        button.addEventListener("click",()=>run(async()=>{
          await write("restore",{card_id:c.id}); await refresh(); paintSubjects();
        }));
        item.append(button);
      }
      return item;
    }));
  }
  $("subject").addEventListener("click", () => run(async()=>{
    await subjects(); paintSubjects(); $("subject-dialog").showModal();
  }));
  $("subject-select").addEventListener("change", () => run(async()=>{
    state.subject=$("subject-select").value; state.index=0;
    await refresh(); paintSubjects();
  }));
  $("create-subject-form").addEventListener("submit", e=>{
    e.preventDefault(); run(async()=>{
      const created=await b.core({op:"create_subject",name:$("new-subject").value.trim()});
      state.subject=created.slug; state.index=0; $("new-subject").value="";
      await subjects(); await refresh(); paintSubjects();
    });
  });
  $("search-form").addEventListener("submit", e=>{
    e.preventDefault(); run(async()=>{
      const result=await b.core({op:"search",subject:state.subject,query:$("search-query").value});
      const list=$("search-results"); list.replaceChildren();
      for(const hit of result.hits) {
        const section=document.createElement("section");
        const heading=document.createElement("h3"); heading.textContent=hit.doc;
        const body=document.createElement("p"); body.textContent=hit.body;
        const button=document.createElement("button"); button.className="btn data-control"; button.textContent="从此段钉卡";
        button.addEventListener("click",()=>run(async()=>{
          await b.invoke("open_anchor",{seed:{subject:state.subject,selected:hit.body,
            title:(hit.heading||hit.doc).slice(0,60),parent:hit.body}});
          $("search-dialog").close();
        }));
        section.append(heading,body,button);list.append(section);
      }
      if(!result.hits.length) list.textContent="没有匹配的原文。";
      $("search-dialog").showModal();
    });
  });
  document.addEventListener("keydown", e=>{
    if(e.defaultPrevented || e.isComposing || document.querySelector("dialog[open],.ctx")) return;
    const typing=e.target.closest?.("input,textarea,[contenteditable=true]");
    if(e.ctrlKey && e.key==="Enter" && typing) {e.preventDefault();run(()=>review("answer"));return;}
    if(typing || e.altKey || e.metaKey || e.ctrlKey || state.busy) return;
    if(e.target.closest?.("button,select,summary") && (e.key==="Enter" || e.key===" ")) return;
    if(e.key==="?" || e.key==="F1") {e.preventDefault();window.toggleKeys();return;}
    if(!active()) return;
    const action={Enter:active().verdict?"next":"check",n:"next",N:"next"," ":"hint",p:"pin",P:"pin"}[e.key];
    if(action){e.preventDefault();run(()=>act(action));}
    else if(e.key.toLowerCase()==="s"){e.preventDefault();run(()=>postpone("tomorrow"));}
    else if(e.key.toLowerCase()==="l"){e.preventDefault();run(()=>postpone("tonight"));}
  });
  window.installLongPress(stream,text=>run(()=>openAnchor(text)),$("press-hint"));
  window.addEventListener("dragover",e=>e.preventDefault());
  window.addEventListener("drop",e=>{
    e.preventDefault();
    if(!b.hasTauri) error("静态预览不能导入文件。");
    // Native paths come only from Tauri's DragDrop event, never browser filenames.
  });
  Promise.all([
    b.on("main:dropped",paths=>run(()=>importPaths(paths))),
    b.on("data:changed",()=>run(refresh)),
    b.on("app:error",error),
  ]).catch(error);
  function canQuietRefresh() {
    return state.ready && !state.busy && !active()?.verdict
      && !document.querySelector("dialog[open],.ctx")
      && !document.activeElement?.matches("input,textarea,[contenteditable=true]");
  }
  let refreshing = false;
  async function quietRefresh() {
    if (refreshing || !canQuietRefresh()) return;
    refreshing = true;
    try { await refresh(true); } catch (err) { error(err); }
    finally { refreshing = false; }
  }
  window.addEventListener("focus", quietRefresh);
  setInterval(quietRefresh,60000);
  run(async()=>{
    await subjects(); state.ready=true; await refresh();
    $("foot-hint").textContent="原文可长按钉卡；所有学习操作在保存后反馈。";
  });
})();
