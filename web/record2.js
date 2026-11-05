// 녹음 2세대: 이미 로드된 lab.laya / lab.emb를 그대로 써서 recorded.json을 만든다.
// 런타임과 같은 후보 규칙(주제 없음, 상위 topK)으로 쌍을 고르고, 이전 답변(prev)은 재사용한다.
import { encodeVec, compactAnswers, yieldToBrowser } from "./common.js";
import { QUESTIONS, DEFAULT_POLICY, cosine, eventState, pairState, eventCacheKey, pairCacheKey, EVENT_KEY, PAIR_KEY } from "./governor-core.js";

export async function recordAll({ prev = {}, scope = "all", onStatus = () => {} } = {}) {
  const lab = window.__lab;
  const t0 = performance.now();
  const sc = await (await fetch("./scenarios.json")).json();
  const cases = (await (await fetch("./cases.json")).json()).cases;
  const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const pairs = [], events = new Map(), texts = new Set();
  const has = (n) => scope === "all" || (Array.isArray(scope) ? scope.includes(n) : scope === n);
  const addEv = (e) => { events.set(eventCacheKey(e), e); texts.add(e.text); };

  if (has("eval")) {
    for (const c of cases) {
      addEv({ text: c.event, source: c.evSource });
      pairs.push([{ text: c.memory, source: c.memSource }, { text: c.event, source: c.evSource }]);
      texts.add(c.memory);
    }
  }
  const worlds = [];
  if (has("playground")) {
    const p = sc.playground;
    const evs = p.events.map((e) => ({ text: e.text, source: e.source }));
    worlds.push({ mems: [...p.memories.map((m) => ({ text: m.text, source: m.source })), ...evs], evs, queries: p.queries });
  }
  if (has("app")) {
    const a = sc.app, evs = [];
    for (const f of a.fields) for (const o of f.options) for (const n of f.options) if (o !== n) evs.push({ text: fill(f.event, { old: o, new: n }), source: "설정" });
    for (const m of a.messages) evs.push({ text: m.text, source: m.source });
    const seeds = [...a.fields.map((f) => ({ text: fill(f.memory, { v: f.initial }), source: "프로필" })), ...a.seedMemories.map((m) => ({ text: m.text, source: m.source }))];
    worlds.push({ mems: [...seeds, ...evs], evs, queries: a.queries });
  }
  for (const w of worlds) { w.mems.forEach((m) => texts.add(m.text)); w.evs.forEach(addEv); w.queries.forEach((q) => texts.add(q)); }

  onStatus(`임베딩 ${texts.size}`);
  const list = [...texts], vecs = await lab.emb.embed(list);
  const V = new Map(list.map((t, i) => [t, vecs[i]]));
  let pairCount = 0;
  for (const w of worlds) for (const e of w.evs) {
    const cand = w.mems.filter((m) => m.text !== e.text)
      .map((m) => ({ m, sim: cosine(V.get(m.text), V.get(e.text)) }))
      .filter((x) => x.sim >= DEFAULT_POLICY.minSim)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, DEFAULT_POLICY.topK);
    pairCount += cand.length;
    for (const c of cand) pairs.push([c.m, e]);
  }

  const answers = { ...(prev.answers || {}) };
  let since = 0;
  const save = async (force) => {
    try { localStorage.setItem("lm.rec2", JSON.stringify(answers)); } catch {}
    if (force || since >= 25) {
      since = 0;
      try { await fetch("http://127.0.0.1:8770/", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ answers }) }); } catch {}
    }
  };
  const evList = [...events.values()];
  let i = 0, reused = 0;
  for (const e of evList) {
    const k = eventCacheKey(e);
    if (answers[k]) reused++;
    else { answers[k] = compactAnswers((await lab.laya.systemOne(eventState(e), QUESTIONS.event)).answers); since++; }
    onStatus(`사건 ${++i}/${evList.length} (재사용 ${reused})`);
    await save(false);
    await yieldToBrowser();
  }
  i = 0; reused = 0;
  for (const [m, e] of pairs) {
    const k = pairCacheKey(m, e);
    if (answers[k]) reused++;
    else { answers[k] = compactAnswers((await lab.laya.systemOne(pairState(m, e), QUESTIONS.pair)).answers); since++; }
    onStatus(`쌍 ${++i}/${pairs.length} (재사용 ${reused})`);
    await save(false);
    await yieldToBrowser();
  }
  await save(true);
  return {
    version: 1,
    note: "Laya 답변과 다국어 MiniLM 벡터를 브라우저에서 녹음한 파일. 키는 질문 지문 | 출처 | 텍스트.",
    model: { variant: lab.info.variant, backend: lab.info.backend, source: lab.info.source, recordedAt: new Date().toISOString(), seconds: Math.round((performance.now() - t0) / 1000), eventKey: EVENT_KEY, pairKey: PAIR_KEY },
    vectors: Object.fromEntries(list.map((t) => [t, encodeVec(V.get(t))])),
    answers,
    stats: { pairs: pairs.length, events: evList.length },
  };
}
