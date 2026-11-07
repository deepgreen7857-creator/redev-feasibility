/* /arch 일조 연계 다듬기 일꾼(Web Worker, 2026-11-07) — 지금 대안에서 출발해 옮기기·돌리기·층수·빼기·끼워 넣기로 순세대(동지 2시간 미달 세대 뺀 값)를 올림
   받는 것: { id, site, blds, opt, budget } → 진행 { id, prog } 여러 번, 끝 { id, r: { blds, start, best, steps, tries, ms } | null, err } */
importScripts('../shared/arch-geom.js?v=29', '../shared/arch-check.js?v=11', '../shared/sun-verify.js?v=1', '../shared/sun-refine.js?v=1');
self.onmessage = async e => {
  const { id, site, blds, opt, budget } = e.data;
  try {
    const r = await self.JbsRefine.refine(site, blds, opt, { budget: budget || 90000, seed: 7, onProgress: s => self.postMessage({ id, prog: s }) });
    delete r.us;
    self.postMessage({ id, r: JSON.parse(JSON.stringify(r)) });
  } catch (err) { self.postMessage({ id, r: null, err: String(err && err.message || err) }); }
};
