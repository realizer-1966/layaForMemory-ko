// 기억 엔진의 상태를 HTML로 그린다. 놀이터와 사용자 행동 페이지가 함께 쓴다.
import { esc, pct, num, ago, statusChip, verdictChip, bars, voteBars } from "./common.js";

const LIVE = new Set(["active", "needs_review", "frozen"]);

/** 관찰된 사건 하나와 그 결과. */
export function renderReport(r, policy) {
  if (!r) return `<p class="placeholder">아직 검사한 사건이 없습니다.</p>`;
  const kindSel = Object.entries(r.kind.kind).sort((a, b) => b[1] - a[1])[0][0];
  const head = `<div class="evhead"><div class="evtext">“${esc(r.event.text)}”</div><div class="evmeta"><span class="tag">${esc(r.event.source)}</span>${r.dryRun ? `<span class="tag warn">드라이 런</span>` : ""}<span class="tag">${r.ms ? `모델 시간 ${(r.ms / 1000).toFixed(1)}초` : "녹음/캐시된 답변"}</span></div></div>`;
  const kind = `<div class="step"><h3>1 · 어떤 종류의 메시지인가?</h3>${bars(r.kind.kind, kindSel)}
    <p class="hint">명령 ${num(r.kind.command)} (≥ ${policy.command} → 기록만) · 질문 + 제안 ${num(r.kind.hypothetical)} (≥ ${policy.hypothetical} → 기록만)</p></div>`;
  if (r.verdict) {
    return head + kind + `<div class="outcomebox vd-bg-${r.verdict}">${verdictChip(r.verdict)} <span>${esc(r.reason)}. 기억은 검사하거나 바꾸지 않았습니다.</span></div>`;
  }
  const checks = r.checks.length
    ? r.checks.map((c) => `<div class="check-row">
        <div class="ch-mem"><div class="ch-text">${esc(c.memory.text)}</div><div class="ch-meta"><span class="tag">${esc(c.memory.source)}</span><span class="tag">유사도 ${num(c.sim)}</span>${c.cached ? `<span class="tag">캐시</span>` : ""}</div></div>
        <div class="ch-votes">${voteBars(c.votes, policy)}</div>
        <div class="ch-verdict">${verdictChip(c.verdict)}<div class="ch-reason">${esc(c.reason)}</div>${c.from !== c.to ? `<div class="ch-move">${esc(c.from)} → <b>${esc(c.to)}</b></div>` : `<div class="ch-move muted">${r.dryRun ? "드라이 런: 변경 없음" : "변경 없음"}</div>`}</div>
      </div>`).join("")
    : `<p class="hint">검사할 만큼 비슷한 기억이 없습니다 (코사인 ≥ ${policy.minSim}).</p>`;
  const succ = r.successor ? `<div class="outcomebox vd-bg-superseded">사건 원문이 새 기억(후속 기억)으로 저장되었습니다: “${esc(r.successor.text)}”</div>` : "";
  return head + kind + `<div class="step"><h3>2 · 비슷한 기억이 아직 맞는가? <span class="meta">낡음 점수: ≤ ${policy.keep} 유지 · ≥ ${policy.stale} 낡음 (${policy.agree}/4표 필요) · 그 사이: 검토</span></h3>${checks}</div>` + succ;
}

/** 기억 목록. 대체·반박된 기억도 취소선으로 남고, 후속 기억과 연결된다. */
export function renderMemories(mems, { showClosed = true } = {}) {
  if (!mems.length) return `<p class="placeholder">아직 기억이 없습니다.</p>`;
  const byId = new Map(mems.map((m) => [m.id, m]));
  const order = { active: 0, needs_review: 1, frozen: 2, superseded: 3, contradicted: 4, expired: 5, deleted: 6 };
  const list = mems.filter((m) => showClosed || LIVE.has(m.status)).sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt);
  return `<ul class="memlist">${list.map((m) => {
    const succ = m.successorId && byId.get(m.successorId);
    const pred = m.predecessorId && byId.get(m.predecessorId);
    const acts = [
      m.status === "frozen" ? ["unfreeze", "고정 해제"] : LIVE.has(m.status) ? ["freeze", "고정"] : null,
      ["superseded", "contradicted", "expired", "deleted"].includes(m.status) ? ["restore", "복원"] : null,
      m.status === "needs_review" ? ["keep", "여전히 사실"] : null,
      m.status !== "deleted" ? ["forget", "잊기"] : null,
    ].filter(Boolean);
    return `<li class="mem mem-${m.status}" id="mem-${m.id}">
      <div class="mtop">${statusChip(m.status)}<span class="mtext">${esc(m.text)}</span></div>
      <div class="mmeta"><span class="tag">${esc(m.source)}</span><span class="tag">${esc(m.kind)}</span><span class="belief" title="아직 사실일 것이라는 믿음"><span class="pbar"><i style="width:${pct(m.pTrue ?? 1)}"></i></span>${num(m.pTrue ?? 1)}</span><span class="muted">${ago(m.createdAt)}</span>${m.ttl ? `<span class="tag">임대 ${m.ttl}초</span>` : ""}
        ${succ ? `<span class="link">→ “${esc(succ.text)}”(으)로 대체됨</span>` : ""}${pred ? `<span class="link">← “${esc(pred.text)}” 대체</span>` : ""}</div>
      <div class="macts">${acts.map(([a, t]) => `<button class="mini" data-act="${a}" data-id="${m.id}" data-track="mem-${a}">${t}</button>`).join("")}</div>
    </li>`;
  }).join("")}</ul>`;
}

/** 검토 대기열: 검토 필요 상태가 된 기억과 그 원인이 된 사건, 그리고 두 가지 선택지. */
export function renderReview(mems, ledger, events) {
  const rev = mems.filter((m) => m.status === "needs_review");
  if (!rev.length) return `<p class="placeholder">검토할 것이 없습니다. Laya가 확신하지 못하면 기억을 바꾸지 않고 여기에 둡니다.</p>`;
  const evById = new Map(events.map((e) => [e.id, e]));
  return `<ul class="memlist">${rev.map((m) => {
    const why = [...ledger].reverse().find((l) => l.memoryId === m.id && l.verdict === "needs_review");
    const ev = why && evById.get(why.eventId);
    return `<li class="mem mem-needs_review">
      <div class="mtop">${statusChip(m.status)}<span class="mtext">${esc(m.text)}</span></div>
      ${ev ? `<div class="mmeta">“${esc(ev.text)}” 때문에 <span class="tag">${esc(ev.source)}</span></div><div class="hint">${esc(why.reason)}</div>` : ""}
      <div class="macts"><button class="mini" data-act="keep" data-id="${m.id}" data-track="review-keep">여전히 사실</button>${ev ? `<button class="mini" data-act="stale" data-id="${m.id}" data-event="${ev.id}" data-track="review-stale">낡음: 사건 내용으로 교체</button>` : ""}<button class="mini" data-act="forget" data-id="${m.id}" data-track="review-forget">잊기</button></div>
    </li>`;
  }).join("")}</ul>`;
}

/** IndexedDB에 저장된 모든 행동: 텍스트가 있는 관찰 사건과 그냥 기록된 UI 행동. */
export function renderEvents(events, { limit = 200 } = {}) {
  if (!events.length) return `<p class="placeholder">아직 사건이 없습니다.</p>`;
  const rows = [...events].reverse().slice(0, limit);
  return `<div class="tablewrap"><table class="grid evtable"><thead><tr><th>시각</th><th>종류</th><th>출처</th><th>사건</th><th>상태</th></tr></thead><tbody>${rows.map((e) => `<tr class="${e.observe ? "obs" : "raw"}">
    <td class="muted">${ago(e.ts)}</td><td>${esc(e.type)}</td><td>${esc(e.source)}</td>
    <td>${e.text ? `“${esc(e.text)}”` : `<code>${esc(JSON.stringify(e.detail))}</code>`}</td>
    <td>${!e.observe ? `<span class="muted">기록만</span>` : e.pending ? `<span class="tag warn">대기</span>` : `<span class="tag ok">검사됨</span>`}</td></tr>`).join("")}</tbody></table></div>
    ${events.length > limit ? `<p class="hint">최근 ${limit}건만 표시 (전체 ${events.length}건).</p>` : ""}`;
}

/** 감사 원장, 최신 순. */
export function renderLedger(ledger, mems, events) {
  if (!ledger.length) return `<p class="placeholder">원장이 비어 있습니다.</p>`;
  const mById = new Map(mems.map((m) => [m.id, m])), eById = new Map(events.map((e) => [e.id, e]));
  return `<div class="tablewrap"><table class="grid"><thead><tr><th>시각</th><th>주체</th><th>판정</th><th>기억</th><th>사건</th><th>상태</th><th>이유</th></tr></thead><tbody>${[...ledger].reverse().map((l) => {
    const m = mById.get(l.memoryId), e = eById.get(l.eventId);
    return `<tr><td class="muted">${ago(l.ts)}</td><td>${esc(l.actor)}</td><td>${verdictChip(l.verdict)}</td>
      <td>${m ? esc(m.text) : `<span class="muted">–</span>`}</td><td>${e ? `“${esc(e.text)}”` : `<span class="muted">–</span>`}</td>
      <td>${l.from && l.to && l.from !== l.to ? `${esc(l.from)} → <b>${esc(l.to)}</b>` : l.to ? esc(l.to) : "–"}${l.applied ? "" : ` <span class="tag bad">미적용</span>`}${l.recovered ? ` <span class="tag">복구됨</span>` : ""}</td>
      <td class="why">${esc(l.reason || "")}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

/** 회상 결과. */
export function renderRecall(r) {
  const lazy = r.lazyReports?.length ? `<p class="hint">지연 모드: 대기 중인 사건 ${r.lazyReports.length}건을 먼저 이 기억들과 대조했습니다.</p>` : "";
  if (!r.hits.length) return lazy + `<p class="hint">살아 있는 기억 중에 맞는 것이 없습니다.</p>`;
  return lazy + `<ol class="recall">${r.hits.map((h) => `<li>${statusChip(h.m.status)} ${esc(h.m.text)} <span class="muted">· 유사도 ${num(h.sim)} × 믿음 ${num(h.m.pTrue ?? 1)} = ${num(h.score)}</span></li>`).join("")}</ol>`;
}

/** `root` 안의 data-act 버튼이 mem.act()를 호출한다. */
export function wireActions(root, mem, after) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    b.disabled = true;
    try { await mem.act(b.dataset.id, b.dataset.act, { eventId: b.dataset.event || null }); } catch (err) { alert(err.message); }
    await after();
  });
}
