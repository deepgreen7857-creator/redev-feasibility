/* /arch 일조 연계 다듬기 일꾼(Web Worker, 2026-11-07) — 지금 대안에서 출발해 옮기기·돌리기·층수·빼기·끼워 넣기로 순세대(동지 2시간 미달 세대 뺀 값)를 올림
   받는 것: { id, site, blds, opt(units·lib 포함), budget, mix(false면 V자·2호 판상 섞기 안 함) } → 진행 { id, prog } 여러 번, 끝 { id, r: { blds, start, best, steps, tries, ms } | null, err } */
importScripts('../shared/arch-geom.js?v=96670f7f', '../shared/arch-check.js?v=022e2617', '../shared/sun-verify.js?v=3ab0c3f2', '../shared/sun-refine.js?v=dd948ffc', '../shared/dong-lib.js?v=93a47e38', '../shared/dong-shapes.js?v=15dc8d1f');
let SHAPES = null;
self.onmessage = async e => {
  const { id, site, blds, opt, budget, mix } = e.data;
  try {
    // 섞을 동 틀(V자 꼭짓점형·일자 2·4·6호) — dong-types.json을 한 번 받아 JbsDong으로 만듦
    if (mix !== false && !SHAPES) { const DT = await (await fetch('../shared/criteria/dong-types.json?v=1d41fba2')).json(); self.JbsDong.init({ units: opt.units, lib: opt.lib, types: DT }); SHAPES = self.JbsShapes.templates(self.JbsDong); }
    const r = await self.JbsRefine.refine(site, blds, opt, { budget: budget || 90000, seed: 7, shapes: mix === false ? [] : SHAPES, onProgress: s => self.postMessage({ id, prog: s }) });
    delete r.us;
    self.postMessage({ id, r: JSON.parse(JSON.stringify(r)) });
  } catch (err) { self.postMessage({ id, r: null, err: String(err && err.message || err) }); }
};
