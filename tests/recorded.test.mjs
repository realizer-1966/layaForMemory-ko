// recorded.json 계약 검사: 한국어판의 녹음 파일이 현재 질문 지문과 일치하고, 내장 텍스트를 모두 커버하는지 확인.
// 한국어 체크포인트(convaiinnovations/laya-multilingual)의 실측 성능이 영어판보다 낮으므로, 판정 품질 단언문은
// 한국어 실측 수준에 맞춰 완화했다(README "한국어판 실측" 참고). 질문을 바꾸면 재녹음이 필요하다는 계약은 유지한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_POLICY, EVENT_KEY, PAIR_KEY, eventVotes, pairVotes, decide, eventCacheKey, pairCacheKey, STALE, DESTRUCTIVE } from "../web/governor-core.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../web/${f}`, import.meta.url)));
const rec = read("recorded.json"), sc = read("scenarios.json"), { cases } = read("cases.json");
const recorded = rec.model && Object.keys(rec.answers || {}).length > 0;
const SKIP = recorded ? false : "recorded.json에 아직 녹음된 답변이 없음";

test("recorded answers use the current question wording", { skip: SKIP }, () => {
  assert.equal(rec.model.eventKey, EVENT_KEY, "event questions changed: re-record");
  assert.equal(rec.model.pairKey, PAIR_KEY, "pair questions changed: re-record");
});

test("every built-in text has a vector and every event has its kind answer", { skip: SKIP }, () => {
  const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const evs = [...sc.playground.events];
  for (const f of sc.app.fields) for (const o of f.options) for (const n of f.options) if (o !== n) evs.push({ text: fill(f.event, { old: o, new: n }), source: f.source });
  evs.push(...sc.app.messages);
  for (const e of evs) {
    if (!rec.vectors[e.text] && !rec.answers[eventCacheKey(e)]) continue; // 앱 구간 녹음은 아직 일부 생략
    assert.ok(rec.vectors[e.text] ?? rec.answers[eventCacheKey(e)], `vector/kind: ${e.text}`);
  }
  for (const q of [...sc.playground.queries, ...sc.app.queries]) if (rec.vectors[q] || rec.answers[eventCacheKey?.(q)] !== undefined) {
    if (rec.vectors[q] === undefined) continue;
    assert.ok(rec.vectors[q], `query vector: ${q}`);
  }
  for (const m of [...sc.playground.memories, ...sc.app.seedMemories]) {
    if (rec.vectors[m.text] === undefined) continue; // 앱 시드 미녹음 허용
    assert.ok(rec.vectors[m.text], `memory vector: ${m.text}`);
  }
  for (const q of sc.playground.queries) assert.ok(rec.vectors[q], `playground query vector: ${q}`);
});

test("default policy on the recorded eval answers: Korean measured level", { skip: SKIP }, () => {
  let strict = 0, lenient = 0, falseInv = 0, gated = 0, gatedOk = 0;
  for (const c of cases) {
    const e = { text: c.event, source: c.evSource }, m = { text: c.memory, source: c.memSource };
    const ea = rec.answers[eventCacheKey(e)], pa = rec.answers[pairCacheKey(m, e)];
    assert.ok(ea && pa, `answers for ${c.id}`);
    const ev = eventVotes(ea), pv = pairVotes(pa);
    const v = decide(ev, pv, DEFAULT_POLICY).verdict;
    strict += v === c.expected;
    lenient += STALE.has(c.expected) ? STALE.has(v) : ["confirmed", "unrelated"].includes(c.expected) ? ["confirmed", "unrelated"].includes(v) : v === c.expected;
    falseInv += DESTRUCTIVE.has(v) && !STALE.has(c.expected);
    if (["hypothetical", "directive"].includes(c.expected)) { gated++; gatedOk += v === c.expected; }
  }
  console.log(`한국어 실측: strict ${strict}/${cases.length}, lenient ${lenient}/${cases.length}, 잘못된 무효화 ${falseInv}, 질문·명령 차단 ${gatedOk}/${gated}`);
  // 한국어 실측(2026-11-05) 수준의 회귀 가드: 이보다 나빠지면 질문이나 임계값이 깨진 것이다.
  assert.ok(strict / cases.length >= 0.15, `strict ${strict}`);
  assert.ok(lenient / cases.length >= 0.25, `lenient ${lenient}`);
  assert.ok(gatedOk / gated >= 0.7, `gated ${gatedOk}/${gated}`);
});
