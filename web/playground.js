// 놀이터: 기억을 저장하고, 사건을 관찰하고, 회상하고, 모든 판정을 살펴본다. 상태는 IndexedDB("laya-memory-playground")에 있다.
import { $, esc, M, initModelCard, onModelsReady, loadRecorded, brain, download, settings, yieldToBrowser } from "./common.js";
import { openStore } from "./store.js";
import { LayaMemory, NeedModelsError } from "./memory.js";
import { attachTracker } from "./tracker.js";
import { renderReport, renderMemories, renderReview, renderEvents, renderLedger, renderRecall, wireActions } from "./views.js";

const store = openStore("laya-memory-playground");
const mem = new LayaMemory(store, brain, { mode: settings.get("mode", "eager") });
window.__lm = { mem, M };
let scenario = null, lastReport = null, demoStep = 0, busy = false;

async function refresh() {
  const [mems, events, ledger] = await Promise.all([mem.memories(), mem.events(), mem.ledger()]);
  $("tab-memories").innerHTML = renderMemories(mems);
  $("tab-review").innerHTML = renderReview(mems, ledger, events);
  $("tab-events").innerHTML = renderEvents(events);
  $("tab-ledger").innerHTML = renderLedger(ledger, mems, events);
  $("cMem").textContent = mems.filter((m) => m.status !== "deleted").length;
  const nrev = mems.filter((m) => m.status === "needs_review").length;
  $("cRev").textContent = nrev || ""; $("cRev").classList.toggle("hot", nrev > 0);
  $("cEv").textContent = events.length; $("cLed").textContent = ledger.length;
  $("report").innerHTML = lastReport ? renderReport(lastReport, mem.policy) : $("report").innerHTML;
  const pending = events.filter((e) => e.pending).length;
  $("storeInfo").textContent = `${(await store.persistent()) ? "IndexedDB에 저장됨" : "IndexedDB를 쓸 수 없어 이 탭 메모리에만 보관"} · 기억 ${mems.length}개, 사건 ${events.length}건 (대기 ${pending}), 원장 ${ledger.length}행 · ${brain.live() ? "Laya 호출" : "녹음 재생"} ${mem.stats.layaCalls}회, 캐시 재사용 ${mem.stats.cached}회.`;
}

async function guarded(fn) {
  if (busy) return;
  busy = true; document.body.classList.add("busy");
  try { await fn(); } catch (e) {
    console.error(e);
    $("report").innerHTML = `<p class="status warn">${esc(e instanceof NeedModelsError ? e.message + " 예시 칩을 고르거나 위에서 모델을 불러오세요." : e.message)}</p>`;
  } finally { busy = false; document.body.classList.remove("busy"); await refresh(); }
}

async function observe(text, source) {
  $("report").innerHTML = `<p class="placeholder">“${esc(text)}” 검사 중…</p>`;
  const { report } = await mem.observe(text, { source, type: "message", dryRun: $("dry").checked, rememberSuccessor: $("succ").checked });
  if (report) lastReport = report;
  else $("report").innerHTML = `<p class="placeholder">지연 모드: “${esc(text)}”을(를) 대기 상태로 기록했습니다. 회상에서 비슷한 기억을 돌려줄 때, 또는 Sweep에서 검사합니다.</p>`;
}

// ---------- 데모 ----------
const demoEvents = () => scenario.playground.events;
function demoLabel() {
  const n = demoEvents().length;
  $("demoState").textContent = demoStep === 0 ? "" : demoStep > n ? "데모 끝. 회상을 해 보거나, 검토 대기열과 원장 탭을 열어 보세요." : `다음: 사건 ${demoStep} / ${n}`;
  $("stepBtn").textContent = demoStep === 0 ? "한 단계" : demoStep > n ? "다시 시작" : `단계 ${demoStep} / ${n}`;
}
async function demoNext() {
  if (demoStep === 0 || demoStep > demoEvents().length) {
    await store.clear(); lastReport = null;
    for (const f of scenario.playground.memories) await mem.remember(f.text, { source: f.source, kind: f.kind });
    demoStep = 1;
    $("report").innerHTML = `<p class="placeholder">기억 ${scenario.playground.memories.length}개를 저장했습니다. 이제 사건이 하나씩 들어옵니다.</p>`;
    return;
  }
  const e = demoEvents()[demoStep - 1];
  $("evText").value = e.text; $("evSource").value = e.source;
  await observe(e.text, e.source);
  demoStep++;
}

function chips(el, items, onPick) {
  el.innerHTML = items.map((t, i) => `<button type="button" data-i="${i}" title="${esc(t.text || t)}" data-track="chip">${esc((t.text || t).slice(0, 44))}${(t.text || t).length > 44 ? "…" : ""}</button>`).join("");
  el.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) onPick(items[+b.dataset.i]); });
}

async function main() {
  attachTracker(mem);
  initModelCard();
  scenario = await (await fetch("./scenarios.json")).json();
  await loadRecorded();
  const fixed = await mem.recover();
  if (fixed) console.info(`반쯤 적용된 원장 행 ${fixed}개를 복구했습니다`);
  document.querySelector(`input[name=mode][value=${mem.mode}]`).checked = true;

  chips($("eventChips"), demoEvents(), (e) => { $("evText").value = e.text; $("evSource").value = e.source; });
  chips($("queryChips"), scenario.playground.queries, (q) => { $("query").value = q; });

  $("demoBtn").addEventListener("click", () => guarded(async () => {
    demoStep = 0;
    for (let i = 0; i <= demoEvents().length; i++) { await demoNext(); demoLabel(); await refresh(); await yieldToBrowser(); }
  }).then(demoLabel));
  $("stepBtn").addEventListener("click", () => guarded(demoNext).then(demoLabel));
  $("rememberBtn").addEventListener("click", () => guarded(async () => {
    const t = $("memText").value.trim(); if (!t) return;
    await mem.remember(t, { source: $("memSource").value, kind: $("memKind").value, ttl: Number($("memTtl").value) || null });
    $("memText").value = "";
  }));
  $("observeBtn").addEventListener("click", () => guarded(async () => { const t = $("evText").value.trim(); if (t) await observe(t, $("evSource").value); }));
  $("recallBtn").addEventListener("click", () => guarded(async () => {
    const q = $("query").value.trim(); if (!q) return;
    const r = await mem.recall(q, { includeReview: $("incReview").checked });
    $("recallOut").innerHTML = renderRecall(r);
    if (r.lazyReports.length) lastReport = r.lazyReports.at(-1);
  }));
  for (const r of document.querySelectorAll("input[name=mode]")) r.addEventListener("change", () => { mem.mode = r.value; settings.set("mode", r.value); refresh(); });
  $("sweepBtn").addEventListener("click", () => guarded(async () => {
    const r = await mem.sweep();
    if (r.reports.length) lastReport = r.reports.at(-1);
    $("storeInfo").textContent = `Sweep: 만료 ${r.expired}건, 대기 사건 ${r.reports.length}건 검사.`;
  }));
  $("exportBtn").addEventListener("click", async () => download(`laya-memory-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await mem.exportAll(), null, 1)));
  $("importFile").addEventListener("change", (e) => guarded(async () => {
    const f = e.target.files[0]; if (!f) return;
    await mem.importAll(JSON.parse(await f.text())); e.target.value = "";
  }));
  $("clearBtn").addEventListener("click", () => guarded(async () => {
    if (!confirm("이 브라우저의 기억, 사건, 원장을 모두 지울까요?")) return;
    await store.clear(); lastReport = null; demoStep = 0; demoLabel();
    $("report").innerHTML = `<p class="placeholder">지웠습니다.</p>`;
  }));

  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => {
    for (const x of document.querySelectorAll(".tabs button")) x.setAttribute("aria-selected", String(x === b));
    for (const p of document.querySelectorAll(".tabcard .panel")) p.hidden = p.id !== "tab-" + b.dataset.tab;
  });
  wireActions($("tab-memories"), mem, refresh);
  wireActions($("tab-review"), mem, refresh);
  mem.on((type) => { if (type === "event" && !busy) refresh(); });
  onModelsReady(refresh);
  demoLabel();
  await refresh();
}
main();
