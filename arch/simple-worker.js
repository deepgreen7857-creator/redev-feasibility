/* /arch 기본형 배치 계산 일꾼(Web Worker, 2026-11-05) — 같은 모양 동 8가지를 일정하게 놓고(진단 → 보완) 성적표까지. 화면이 멈추지 않게 따로 계산
   받는 것: { id, site, opt } (opt는 /arch buildInput().opt + crit) → 돌려주는 것: { id, r: { variants, card, ms } | null, err } */
importScripts('../shared/arch-geom.js?v=eb30fc5f', '../shared/arch-check.js?v=022e2617', '../shared/dong-lib.js?v=93a47e38', '../shared/simple-plan.js?v=2bf182bf');
let DT = null;
self.onmessage = async e => {
  const { id, site, opt } = e.data;
  try {
    if (!DT) DT = await (await fetch('../shared/criteria/dong-types.json?v=1d41fba2')).json();
    const r = self.JbsSimple.simple(site, Object.assign({}, opt, { dongTypes: DT }), {});
    self.postMessage({ id, r });
  } catch (err) { self.postMessage({ id, r: null, err: String(err && err.message || err) }); }
};
