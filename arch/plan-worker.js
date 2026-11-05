/* /arch 심화 배치 계산 일꾼(Web Worker, 2026-11-05) — shared/site-plan.js(JbsPlan): 바깥 반복 탐색(골격·구획·방향·높이 장·동 형태) + 지금 엔진·기본형 후보 → 세대수·일조·균형 세 가지 안
   받는 것: { id, site, opt, o } → 돌려주는 것: { id, r: { variants, decodes, ms } | null, err } */
importScripts('../shared/arch-geom.js?v=25', '../shared/arch-check.js?v=4', '../shared/dong-lib.js?v=2', '../shared/simple-plan.js?v=2', '../shared/site-plan.js?v=2');
let DT = null;
self.onmessage = async e => {
  const { id, site, opt, o } = e.data;
  try {
    if (!DT) DT = await (await fetch('../shared/criteria/dong-types.json?v=3')).json();
    const r = self.JbsPlan.plan(site, Object.assign({ withBase: false }, opt, { dongTypes: DT }), o || { seed: 7, pop: 8, gens: 4, kids: 6, elite: 3, budget: 90000 });
    self.postMessage({ id, r: JSON.parse(JSON.stringify({ variants: r.variants.map(v => Object.assign({}, v, { skel: null })), decodes: r.decodes, ms: r.ms })) });   // 함수(골격 판정 등)는 못 보내므로 걸러 냄
  } catch (err) { self.postMessage({ id, r: null, err: String(err && err.message || err) }); }
};
