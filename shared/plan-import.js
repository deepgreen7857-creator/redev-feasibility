'use strict';
// 배치도 올려서 검토(JbsImport, 2026-11-05): 용역사·건축사 배치도(DXF)를 읽어 동을 알아보고 → 사람이 확인 → 검사 부품(JbsCheck)으로 검증
//  ① 읽기: 닫힌 폴리선(LWPOLYLINE·POLYLINE)과 글자(TEXT·MTEXT)를 레이어째
//  ② 동 알아보기: 대지 안에 가운데가 있고 면적 120~4,000㎡인 닫힌 도형. 레이어 이름(동·건물·주동·APT·BLDG…)이 맞으면 우선
//     층수 = 도형 안 글자의 'nnF'·'nn층'·'nnFL', 동 번호 = 'nnn동'. 형태 = 직사각형에 가까우면 판상(긴 변이 창), 아니면 창 위치를 모르는 동(모든 벽을 창으로 — 보수적)
//     믿음 정도: 높음(레이어·층수 글자 둘 다) / 보통(하나) / 낮음(없음 — 층수는 가정값)
//  ③ 검증은 화면에서 JbsCheck.verify·dims·proviso로(사람이 확인한 뒤)
//  좌표: 읽은 도면 좌표 → (화면에서) 측량 좌표계 → 경위도 → 대지 미터 좌표. 이 파일은 미터 좌표로 받은 뒤의 계산만
(function (g) {
  const NODE = typeof module !== 'undefined' && module.exports;
  const G = NODE ? require('./arch-geom.js') : g.ArchGeom;
  const BLD_LAYER = /동|건물|주동|아파트|APT|BLDG|BUILD|A-?WALL|외벽|MASS|매스/i, NOT_LAYER = /구역|경계|BOUND|ZONE|도로|ROAD|공원|PARK|녹지|GREEN|주차|PARK(ING)?|단지|LOT|획지|학교|SCHOOL|지하|UG|B\d/i;

  // DXF 글자 읽기(TEXT·MTEXT 삽입점·내용·레이어). MTEXT 서식 코드(\P, {\f…;} 등)는 걷어냄
  function dxfTexts(text) {
    const L = text.split(/\r?\n/), out = [];
    let cur = null;
    const push = () => { if (cur && cur.s && isFinite(cur.x) && isFinite(cur.y)) out.push(cur); cur = null; };
    let inBlocks = false, sec = false;
    for (let i = 0; i + 1 < L.length; i += 2) {
      const c = L[i].trim(), v = L[i + 1].replace(/\r$/, '');
      if (c === '0' && v.trim() === 'SECTION') { sec = true; push(); continue; }
      if (sec && c === '2') { inBlocks = v.trim() === 'BLOCKS'; sec = false; continue; }
      if (c === '0') { push(); if (!inBlocks && (v.trim() === 'TEXT' || v.trim() === 'MTEXT')) cur = { layer: '', x: NaN, y: NaN, s: '' }; continue; }
      if (!cur) continue;
      if (c === '8') cur.layer = v.trim();
      else if (c === '10') cur.x = parseFloat(v);
      else if (c === '20') cur.y = parseFloat(v);
      else if (c === '1' || c === '3') cur.s += v;
    }
    push();
    out.forEach(t => { t.s = t.s.replace(/\\[PpNn]/g, ' ').replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, '').trim(); });
    return out;
  }
  // 블록(INSERT)으로 넣은 동(2026-11-05): BLOCKS 구역의 블록 정의(닫힌 폴리선·글자) × ENTITIES의 INSERT(삽입점·배율·회전) → 도면 좌표 도형·글자
  //  중첩 블록은 한 단계만. 블록 안 레이어가 '0'이면 INSERT 레이어를 씀(CAD 관례)
  function dxfInserts(text) {
    const L = text.split(/\r?\n/), pr = []; for (let i = 0; i + 1 < L.length; i += 2) pr.push([L[i].trim(), L[i + 1].replace(/\r$/, '').trim()]);
    const blocks = {}, inserts = []; let sec = '', blk = null, ent = null;
    const endEnt = () => {
      if (!ent) return;
      if (ent.type === 'LWPOLYLINE' && blk && ent.pts.length >= 3 && ent.closed) blk.polys.push({ layer: ent.layer, pts: ent.pts });
      if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && blk && ent.s) blk.texts.push({ layer: ent.layer, x: ent.x, y: ent.y, s: ent.s });
      if (ent.type === 'INSERT' && sec === 'ENTITIES' && ent.name) inserts.push(ent);
      ent = null;
    };
    for (const [c, v] of pr) {
      if (c === '0') {
        endEnt();
        if (v === 'SECTION') { sec = ''; continue; }
        if (v === 'ENDSEC') { sec = ''; blk = null; continue; }
        if (v === 'BLOCK') { blk = { name: '', bx: 0, by: 0, polys: [], texts: [] }; ent = { type: 'BLOCK' }; continue; }
        if (v === 'ENDBLK') { if (blk && blk.name) blocks[blk.name] = blk; blk = null; continue; }
        if (['LWPOLYLINE', 'TEXT', 'MTEXT', 'INSERT'].includes(v)) ent = { type: v, layer: '0', pts: [], closed: false, x: NaN, y: NaN, s: '', name: '', sx: 1, sy: 1, rot: 0 };
        continue;
      }
      if (c === '2' && !sec) { sec = v; continue; }
      if (!ent) continue;
      if (ent.type === 'BLOCK') { if (c === '2' && blk) blk.name = v; else if (c === '10' && blk) blk.bx = +v; else if (c === '20' && blk) blk.by = +v; continue; }
      if (c === '8') ent.layer = v;
      else if (ent.type === 'LWPOLYLINE') { if (c === '70') ent.closed = (parseInt(v, 10) & 1) === 1; else if (c === '10') ent.pts.push([+v, NaN]); else if (c === '20' && ent.pts.length) ent.pts[ent.pts.length - 1][1] = +v; }
      else if (ent.type === 'INSERT') { if (c === '2') ent.name = v; else if (c === '10') ent.x = +v; else if (c === '20') ent.y = +v; else if (c === '41') ent.sx = +v; else if (c === '42') ent.sy = +v; else if (c === '50') ent.rot = +v; }
      else { if (c === '10') ent.x = +v; else if (c === '20') ent.y = +v; else if (c === '1' || c === '3') ent.s += v; }
    }
    endEnt();
    const polys = [], texts = [];
    inserts.forEach(I => { const B = blocks[I.name]; if (!B) return; const r = (I.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
      const T = ([x, y]) => { const u = (x - B.bx) * (I.sx || 1), w = (y - B.by) * (I.sy || 1); return [I.x + u * c - w * sn, I.y + u * sn + w * c]; };
      B.polys.forEach(p => polys.push({ layer: p.layer === '0' ? I.layer : p.layer, pts: p.pts.map(T), block: I.name }));
      B.texts.forEach(t => { const q = T([t.x, t.y]); texts.push({ layer: t.layer === '0' ? I.layer : t.layer, x: q[0], y: q[1], s: t.s.replace(/\\[PpNn]/g, ' ').replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, '').trim(), block: I.name }); });
    });
    return { polys, texts, blocks: Object.keys(blocks).length, inserts: inserts.length };
  }
  const areaOf = q => Math.abs(G.area(q));
  // 가장 작은 둘레 직사각형(볼록껍질 변 방향마다) → 긴 변 방향(도), 직사각형다움(면적 ÷ 직사각형 면적)
  function minRect(q) {
    const h = G.hull(q); let best = null;
    h.forEach((p, i) => { const r = h[(i + 1) % h.length], th = Math.atan2(r[1] - p[1], r[0] - p[0]), c = Math.cos(-th), s = Math.sin(-th);
      const loc = h.map(([x, y]) => [x * c - y * s, x * s + y * c]), xs = loc.map(a => a[0]), ys = loc.map(a => a[1]), w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
      if (!best || w * d < best.a) best = { a: w * d, th: w >= d ? th : th + Math.PI / 2, L: Math.max(w, d), D: Math.min(w, d) }; });
    let deg = best.th * 180 / Math.PI; deg = ((deg % 180) + 180) % 180; if (deg > 90) deg -= 180;
    return { angle: deg, L: best.L, D: best.D, fill: areaOf(q) / (best.a || 1) };
  }
  // 동 알아보기. polys: [{layer, pts(미터)}], texts: [{layer, x, y, s}], site: {pts}, opt: {assume, units?}
  function recognize(polys, texts, site, opt) {
    const A = (opt && opt.assume) || {}, Fdef = Math.round(((A.minFloors || 5) + (A.maxFloors || 35)) / 2);
    let cand = polys.map(p => ({ p, a: areaOf(p.pts) })).filter(x => x.a >= 120 && x.a <= 4000);
    cand = cand.filter(x => { const c = cen(x.p.pts); return G.inside(c[0], c[1], site.pts); }).filter(x => !NOT_LAYER.test(x.p.layer) || BLD_LAYER.test(x.p.layer));
    const named = cand.filter(x => BLD_LAYER.test(x.p.layer)), pool = named.length >= 2 ? named : cand;
    // 겹친 도형(같은 동을 여러 레이어로 그린 것)은 큰 것 하나만
    const keep = [];
    pool.sort((a, b) => b.a - a.a).forEach(x => { const c = cen(x.p.pts); if (!keep.some(k => G.inside(c[0], c[1], k.p.pts))) keep.push(x); });
    return keep.map((x, i) => {
      const q = x.p.pts, mr = minRect(q), inT = texts.filter(t => G.inside(t.x, t.y, q)).map(t => t.s);
      const fT = inT.map(s => /(\d{1,2})\s*(?:F|FL|층)\b/i.exec(s) || /(\d{1,2})\s*층/.exec(s)).find(Boolean), nT = inT.map(s => /(\d{3,4})\s*동/.exec(s)).find(Boolean);
      const lay = BLD_LAYER.test(x.p.layer), slab = mr.fill > 0.85 && mr.L / mr.D > 1.8;
      const floors = fT ? +fT[1] : Fdef, conf = (lay ? 1 : 0) + (fT ? 1 : 0);
      // 층당 세대(모르면 바닥 면적 × 0.75 ÷ 평균 공급면적 110㎡로 어림 — 사람이 고침)
      const per = Math.max(1, Math.round(x.a * 0.75 / 110));
      return { key: i, use: true, id: nT ? +nT[1] : 101 + i, name: nT ? nT[0] : '', layer: x.p.layer, poly: G.ccw(q.slice()), area: x.a, floors, floorsFrom: fT ? '도면 글자' : '가정',
        form: slab ? 'slab' : 'free', angle: Math.round(mr.angle * 10) / 10, L: mr.L, D: mr.D, perFloor: per, conf: conf === 2 ? '높음' : conf === 1 ? '보통' : '낮음', texts: inT };
    }).sort((a, b) => a.id - b.id);
  }
  const cen = q => q.reduce((s, p) => [s[0] + p[0] / q.length, s[1] + p[1] / q.length], [0, 0]);
  // 확인한 동 → 검사 부품이 쓰는 동(판상은 긴 변이 창, 그 밖은 모든 바깥 벽을 창으로 보수적으로)
  function toBuildings(rows, opt) {
    const A = opt.assume;
    return rows.filter(r => r.use).map(r => {
      const b = { id: r.id, poly: r.poly, parts: [r.poly], floors: +r.floors, form: r.form === 'slab' ? 'slab' : 'tower', angle: r.angle, n: +r.perFloor, t: r.t || '84', mixT: { [r.t || '84']: +r.perFloor }, imported: true, conf: r.conf };
      b.walls = G.wallsOf({ form: r.form === 'slab' ? 'slab' : 'tower', parts: [r.poly], units: null, uw0: r.form === 'slab' ? r.angle : null });
      return b;
    });
  }
  const api = { dxfTexts, dxfInserts, recognize, toBuildings, minRect };
  if (NODE) module.exports = api; else g.JbsImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
