// 사용자 행동 페이지: 작은 비서 앱. 설정 변경과 채팅 메시지가 사용자 행동 사건이며, IndexedDB("laya-memory-app")에
// 저장되고, 의미 있는 것만 기억 엔진이 기억과 대조한다.
import { $, esc, M, initModelCard, onModelsReady, loadRecorded, brain, settings, ago, verdictChip, statusChip } from "./common.js";
import { openStore } from "./store.js";
import { LayaMemory, NeedModelsError } from "./memory.js";
import { attachTracker } from "./tracker.js";
import { renderReport, renderMemories, renderReview, renderLedger, wireActions } from "./views.js";

const store = openStore("laya-memory-app");
const mem = new LayaMemory(store, brain);
window.__lm = { mem, M };
let S = null, lastReport = null, busy = false;
const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => o[k]);
const valuesKey = "app.values";
const initialValues = () => Object.fromEntries(S.fields.map((f) => [f.id, f.initial]));

/** 첫 방문(또는 초기화 후): 비서는 처음 설정값과 다른 사실 두 개를 알고 시작한다. */
async function seed() {
  await store.clear();
  settings.set(valuesKey, initialValues());
  for (const f of S.fields) await mem.remember(fill(f.memory, { v: f.initial }), { source: "profile", kind: "preference", topic: f.id });
  for (const m of S.seedMemories) await mem.remember(m.text, { source: m.source, kind: m.kind });
  lastReport = null;
}

function renderSettings() {
  const vals = settings.get(valuesKey, initialValues());
  $("settings").innerHTML = S.fields.map((f) => `<div class="setting"><span>${esc(f.label)}</span><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map((o) =>
    `<label><input type="radio" name="f-${f.id}" value="${esc(o)}" ${vals[f.id] === o ? "checked" : ""} data-track="setting-${f.id}">${esc(o)}</label>`).join("")}</div></div>`).join("");
}

async function refresh() {
  const [mems, events, ledger] = await Promise.all([mem.memories(), mem.events(), mem.ledger()]);
  $("tab-memories").innerHTML = renderMemories(mems);
  $("tab-review").innerHTML = renderReview(mems, ledger, events);
  $("tab-ledger").innerHTML = renderLedger(ledger, mems, events);
  $("cMem").textContent = mems.filter((m) => ["active", "frozen"].includes(m.status)).length;
  const nrev = mems.filter((m) => m.status === "needs_review").length;
  $("cRev").textContent = nrev || ""; $("cRev").classList.toggle("hot", nrev > 0);
  $("cLed").textContent = ledger.length;
  if (lastReport) $("report").innerHTML = renderReport(lastReport, mem.policy);
  const mById = new Map(mems.map((m) => [m.id, m]));
  const byEvent = new Map();
  for (const l of ledger) if (l.eventId) (byEvent.get(l.eventId) || byEvent.set(l.eventId, []).get(l.eventId)).push(l);
  $("feed").innerHTML = [...events].reverse().slice(0, 80).map((e) => {
    const effects = (byEvent.get(e.id) || []).filter((l) => l.actor === "laya" || l.actor === "person");
    const shown = effects.filter((l) => l.verdict !== "unrelated");
    const eff = !e.observe ? "" : e.pending ? `<div class="eff">대기 중…</div>`
      : shown.length ? shown.map((l) => `<div class="eff">${verdictChip(l.verdict)} ${l.memoryId && mById.get(l.memoryId) ? `“${esc(mById.get(l.memoryId).text)}”${l.from !== l.to ? ` → ${statusChip(l.to)}` : ""}` : esc(l.reason)}</div>`).join("")
      : `<div class="eff">영향받은 기억 없음${effects.length ? ` (${effects.length}개 검사, 모두 무관)` : ""}</div>`;
    const what = e.text ? `“${esc(e.text)}”` : `<span class="muted">${esc(e.type)} · ${esc(e.detail?.target || e.detail?.page || "")}${e.detail?.value != null ? ` = ${esc(String(e.detail.value))}` : ""}</span>`;
    return `<li><div class="what"><span class="tag">${esc(e.source)}</span>${what}<span class="muted">${ago(e.ts)}</span></div>${eff}</li>`;
  }).join("") || `<li class="muted">아직 활동이 없습니다.</li>`;
}

async function guarded(fn) {
  if (busy) return;
  busy = true; document.body.classList.add("busy");
  try { await fn(); } catch (e) {
    console.error(e);
    $("report").innerHTML = `<p class="status warn">${esc(e instanceof NeedModelsError ? e.message + " 설정과 예시 칩은 모델 없이도 동작합니다." : e.message)}</p>`;
  } finally { busy = false; document.body.classList.remove("busy"); await refresh(); }
}

async function settingChanged(field, value) {
  const vals = settings.get(valuesKey, initialValues());
  const old = vals[field.id];
  if (old === value) return;
  vals[field.id] = value; settings.set(valuesKey, vals);
  $("report").innerHTML = `<p class="placeholder">검사 중…</p>`;
  const { report } = await mem.track({ type: "setting_change", source: "settings", text: fill(field.event, { old, new: value }), detail: { field: field.id, old, new: value }, topic: field.id, remember: true, kind: "preference" });
  lastReport = report;
}

async function send(text) {
  const m = /^(기억해|기억해줘|잊지 ?마)[:,]?\s+(.*)$/.exec(text);
  if (m) { await mem.remember(m[2], { source: "chat", kind: "fact" }); return; }
  $("report").innerHTML = `<p class="placeholder">검사 중…</p>`;
  lastReport = (await mem.track({ type: "message", source: "chat", text })).report;
}

async function ask(q) {
  const r = await mem.recall(q, { limit: 3, includeReview: true, minSim: 0.3 });
  const top = r.hits[0];
  const review = top?.m.status === "needs_review";
  $("answer").innerHTML = top
    ? `<div class="answer">${review ? "기억하고 있지만, 낡았을 수 있습니다 (검토 대기열에 있음)" : "기억하고 있는 것"}: <b>${esc(top.m.text)}</b><div class="hint">${r.hits.map((h) => `${esc(h.m.text)} (${h.score.toFixed(2)})`).join(" · ")}</div></div>`
    : `<div class="answer">그것에 대해 기억하는 것이 없습니다.</div>`;
}

function chips(el, items, onPick) {
  el.innerHTML = items.map((t, i) => `<button type="button" data-i="${i}" data-track="chip">${esc(t.text || t)}</button>`).join("");
  el.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) onPick(items[+b.dataset.i]); });
}

async function main() {
  S = (await (await fetch("./scenarios.json")).json()).app;
  initModelCard();
  await loadRecorded();
  await mem.recover();
  if (!(await mem.memories()).length) await guarded(seed);
  attachTracker(mem);
  $("appTitle").textContent = `${S.person}의 비서`;
  renderSettings();
  $("settings").addEventListener("change", (e) => {
    const inp = e.target.closest("input[type=radio]"); if (!inp) return;
    const field = S.fields.find((f) => "f-" + f.id === inp.name);
    guarded(() => settingChanged(field, inp.value)).then(renderSettings);
  });
  chips($("msgChips"), S.messages, (m) => guarded(() => send(m.text)));
  chips($("askChips"), S.queries, (q) => { $("ask").value = q; guarded(() => ask(q)); });
  $("sendBtn").addEventListener("click", () => { const t = $("msg").value.trim(); if (t) guarded(() => send(t)).then(() => { $("msg").value = ""; }); });
  $("msg").addEventListener("keydown", (e) => { if (e.key === "Enter") $("sendBtn").click(); });
  $("askBtn").addEventListener("click", () => { const q = $("ask").value.trim(); if (q) guarded(() => ask(q)); });
  $("ask").addEventListener("keydown", (e) => { if (e.key === "Enter") $("askBtn").click(); });
  $("resetBtn").addEventListener("click", () => guarded(seed).then(() => { renderSettings(); $("answer").innerHTML = ""; $("report").innerHTML = `<p class="placeholder">처음 설정으로 초기화했습니다.</p>`; }));
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => {
    for (const x of document.querySelectorAll(".tabs button")) x.setAttribute("aria-selected", String(x === b));
    for (const p of document.querySelectorAll(".tabcard .panel")) p.hidden = p.id !== "tab-" + b.dataset.tab;
  });
  wireActions($("tab-memories"), mem, refresh);
  wireActions($("tab-review"), mem, refresh);
  mem.on((type) => { if (type === "event" && !busy) refresh(); });
  onModelsReady(refresh);
  await refresh();
}
main();
