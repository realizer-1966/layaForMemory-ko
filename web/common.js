// 모든 페이지가 공유한다: 모델 카드(Laya + 임베딩 모델), 기억 엔진이 쓰는 "brain"(실제 모델 또는 같은 모델로
// 녹음한 답변), 그리고 작은 DOM 도우미.
import { loadEmbedder, embedderCached, EMBED_MODEL } from "./embedder.js";
import { NeedModelsError } from "./memory.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pct = (p, d = 0) => (p == null ? "–" : `${(p * 100).toFixed(d)}%`);
export const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));
export const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : s < 86400 ? `${Math.round(s / 3600)}시간 전` : new Date(ts).toLocaleDateString("ko-KR"); };
// setTimeout이 아니라 MessageChannel: 백그라운드 탭은 setTimeout을 1초 이상으로 늦춘다.
export const yieldToBrowser = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

export const settings = {
  get(k, d) { try { const v = localStorage.getItem("lm." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lm." + k, JSON.stringify(v)); } catch { /* 괜찮다 */ } },
};

export const M = { laya: null, embedder: null, model: null, manifest: null, loading: false, listeners: [], recorded: null, capture: null };
export const onModelsReady = (fn) => M.listeners.push(fn);
let modelMod = null;
const modelApi = () => (modelMod ||= import("./model.js"));

// ---------- 녹음된 답변 재생 ----------
/** int8 + scale, base64: 384차원 벡터가 약 520자. */
export function encodeVec(v) {
  let mx = 0; for (const x of v) mx = Math.max(mx, Math.abs(x));
  const s = mx / 127 || 1, b = new Int8Array(v.length);
  v.forEach((x, i) => { b[i] = Math.round(x / s); });
  return `${s.toPrecision(6)}:${btoa(String.fromCharCode(...new Uint8Array(b.buffer)))}`;
}
export function decodeVec(str) {
  const [s, b64] = str.split(":");
  const bytes = Int8Array.from(atob(b64), (c) => (c.charCodeAt(0) << 24) >> 24);
  const v = Float32Array.from(bytes, (x) => x * Number(s));
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}
/** 엔진이 읽는 값만 남긴다. */
export const compactAnswers = (answers) => Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.type === "noul" ? { noul: a.noul } : { probabilities: a.probabilities }]));

export async function loadRecorded() {
  if (M.recorded) return M.recorded;
  try { const r = await fetch("./recorded.json", { cache: "no-cache" }); if (r.ok) M.recorded = await r.json(); } catch { /* 선택 사항 */ }
  return (M.recorded ||= { vectors: {}, answers: {} });
}

/** 엔진의 brain: 모델이 로드되면 실제 모델, 아니면 녹음된 답변. M.capture가 있으면 실제 결과를 녹음용으로 모은다. */
export const brain = {
  async embed(texts) {
    if (M.embedder) {
      const v = await M.embedder.embed(texts);
      if (M.capture) texts.forEach((t, i) => { M.capture.vectors[t] = encodeVec(v[i]); });
      return v;
    }
    return texts.map((t) => { const r = M.recorded?.vectors?.[t]; if (!r) throw new NeedModelsError("새 텍스트의 임베딩"); return decodeVec(r); });
  },
  async answer(state, questions, key) {
    if (M.laya) {
      const r = await M.laya.systemOne(state, questions);
      if (M.capture) M.capture.answers[key] = compactAnswers(r.answers);
      return r.answers;
    }
    const a = M.recorded?.answers?.[key];
    if (!a) throw new NeedModelsError("새 텍스트의 판정");
    return a;
  },
  live: () => !!(M.laya && M.embedder),
};
export const canPlay = (text) => brain.live() || !!M.recorded?.vectors?.[text];

// ---------- 모델 카드 ----------
function setPill(kind, text) { const p = $("modelPill"); if (!p) return; p.className = "modelpill " + kind; $("modelPillText").textContent = text; }
export function setStatus(msg, warn = false) { const s = $("status"); if (!s) return; s.textContent = msg; s.classList.toggle("warn", warn); }
function setProgress(f) { const p = $("progress"); if (!p) return; p.hidden = f == null; if (f != null) $("progressBar").style.width = (f * 100).toFixed(1) + "%"; }
export function pillIdle() { if (!M.laya) setPill("replay", "녹음 재생 모드 · 직접 입력하려면 모델을 불러오세요"); }

export async function initModelCard() {
  $("loadBtn").addEventListener("click", loadModels);
  $("embedLink").href = EMBED_MODEL.page; $("embedLink").textContent = EMBED_MODEL.id;
  pillIdle();
  const m = await modelApi();
  const base = m.modelBase();
  const link = $("modelLink"); link.href = base === m.DEFAULT_MODEL_BASE ? m.MODEL_PAGE : base; link.textContent = base === m.DEFAULT_MODEL_BASE ? "convaiinnovations/laya-multilingual" : base;
  try {
    M.manifest = await m.fetchManifest(base);
    const sel = $("variant"); sel.innerHTML = "";
    const gpu = await m.hasWebGPU();
    const saved = settings.get("variant", gpu ? "q4e8" : "q8e8");
    for (const [k, v] of Object.entries(M.manifest.variants)) {
      const cached = await m.cachedParts(base, v.data);
      const tag = cached === v.data.parts.length ? ", 캐시됨" : cached ? `, ${cached}/${v.data.parts.length} 파트 캐시됨` : "";
      sel.add(new Option(`${k === "q8e8" ? "int8 (WASM)" : k === "q4e8" ? "int4 (WebGPU, 더 작음)" : v.label} · ${Math.round(v.data.size / 1048576)} MB${tag}`, k));
    }
    if (M.manifest.variants[saved]) sel.value = saved;
    $("embedState").textContent = (await embedderCached()) ? " (캐시됨)" : " (약 118 MB)";
    $("loadBtn").disabled = false;
  } catch (e) {
    setStatus(`${base} 에서 모델 매니페스트를 읽지 못했습니다 (${e.message}). 녹음 재생은 그대로 동작합니다.`, true);
  }
}

export async function loadModels() {
  if (M.loading) return;
  M.loading = true; $("loadBtn").disabled = true; $("badges").innerHTML = "";
  setPill("busy", "모델 불러오는 중…");
  settings.set("variant", $("variant").value);
  try {
    const m = await modelApi();
    if (!M.embedder) M.embedder = await loadEmbedder({ onStatus: setStatus, onProgress: setProgress });
    const { laya, backend, info } = await m.loadLaya({
      base: m.modelBase(), manifest: M.manifest, variant: $("variant").value, backend: $("backend").value,
      onStatus: setStatus, onProgress: setProgress,
    });
    M.laya = laya; M.model = { backend, ...info };
    setStatus(`준비됨. Laya: 다운로드 ${(info.downloadMs / 1000).toFixed(1)}초${info.fromCache ? ` (${info.fromCache}/${info.parts} 파트 캐시)` : ""}, 세션 ${(info.initMs / 1000).toFixed(1)}초. 임베더 ${(M.embedder.info.loadMs / 1000).toFixed(1)}초${M.embedder.info.fromCache ? " (캐시됨)" : ""}. 이제 어떤 텍스트든 쓸 수 있습니다.`);
    const badge = (t, ok) => { const b = document.createElement("span"); b.className = "badge" + (ok ? " ok" : ""); b.textContent = t; $("badges").appendChild(b); };
    badge(backend === "webgpu" ? "WebGPU" : `WASM · ${info.threads}스레드`, true);
    badge(`판정: ${info.model || info.source} · ${info.variant}`); badge(`임베딩: ${EMBED_MODEL.id} · ${EMBED_MODEL.dim}차원`);
    setPill("ready", `모델 준비됨 · ${backend === "webgpu" ? "WebGPU" : "WASM"}`);
    $("loadBtn").textContent = "모델 다시 불러오기";
    for (const fn of M.listeners) fn();
  } catch (e) {
    console.error(e);
    setStatus("모델을 불러오지 못했습니다: " + (e?.message || e), true);
    pillIdle();
  } finally { M.loading = false; $("loadBtn").disabled = false; setProgress(null); }
}

export function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 렌더링 ----------
export const STATUS_TEXT = {
  active: "유효", needs_review: "검토 필요", superseded: "대체됨", contradicted: "반박됨",
  expired: "만료됨", frozen: "고정됨", deleted: "삭제됨",
};
export const VERDICT_TEXT = {
  unrelated: "무관", confirmed: "확인됨", superseded: "대체됨", contradicted: "반박됨",
  needs_review: "검토 필요", hypothetical: "질문 / 계획", directive: "명령",
  remembered: "저장됨", freeze: "사람이 고정함", unfreeze: "고정 해제됨", restore: "복원됨", forget: "잊음",
  keep: "사람이 유지함", stale: "사람이 낡음으로 표시", expired: "만료됨",
};
const OPTION_TEXT = {
  report: "보고", question: "질문", proposal: "제안", command: "명령",
  unaffected: "무관", still_correct: "여전히 맞음", outdated: "낡음",
  unrelated: "무관", confirms: "확인", replaces: "대체", contradicts: "반박", minor_change: "작은 변경",
};
export const statusChip = (s) => `<span class="st st-${s}">${esc(STATUS_TEXT[s] || s)}</span>`;
export const verdictChip = (v) => `<span class="vd vd-${v}">${esc(VERDICT_TEXT[v] || v)}</span>`;

export function bars(probs, selected) {
  return `<div class="bars">${Object.entries(probs).map(([k, v]) => `<div class="bar${k === selected ? " sel" : ""}"><span class="n">${esc(OPTION_TEXT[k] || k.replace(/_/g, " "))}</span><span class="tr"><span class="f" style="width:${(v * 100).toFixed(1)}%"></span></span><span class="v">${v.toFixed(2)}</span></div>`).join("")}</div>`;
}

/** 네 가지 낡음 신호와 합산 점수를 막대로. */
export function voteBars(votes, policy) {
  const s = votes.signals;
  const rows = [
    ["“낡았거나 틀림”", s.outdated], ["사후 질문: 낡음", s.after_outdated], ["“여전히 맞음” 아님", s.not_still_correct], ["대체 + 반박", s.replaces_or_contradicts],
  ];
  const mark = (p) => `<i class="tick" style="left:${(p * 100).toFixed(1)}%"></i>`;
  return `<div class="votes">${rows.map(([n, v]) => `<div class="bar"><span class="n">${n}</span><span class="tr"><span class="f" style="width:${(v * 100).toFixed(1)}%"></span></span><span class="v">${v.toFixed(2)}</span></div>`).join("")}
    <div class="bar total"><span class="n"><b>낡음 점수</b></span><span class="tr">${mark(policy.keep)}${mark(policy.stale)}<span class="f" style="width:${(votes.stale * 100).toFixed(1)}%"></span></span><span class="v"><b>${votes.stale.toFixed(2)}</b></span></div>
    <div class="votemeta">4표 중 ${votes.agree}표가 낡음 · 대체 비중 ${votes.share.toFixed(2)} · 확인 ${votes.confirms.toFixed(2)}</div></div>`;
}
