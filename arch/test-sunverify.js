// node arch/test-sunverify.js — 일조 정밀 검산(shared/sun-verify.js) 시험
const assert = require('assert');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), V = require('../shared/sun-verify.js'), C = require('../shared/criteria/arch.json');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('통과', name); };
const A = Object.assign({}, C.가정, { corner: { mode: 'off' } }), U = C.평면;
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]], box = (x, y, L, D) => [[x, y], [x + L, y], [x + L, y + D], [x, y + D]];
const site = { pts: rect(240, 200), tags: ['road', 'boundary', 'north', 'boundary'] }; site.setbacks = site.tags.map(tg => tg === 'road' ? 3 : 5);
const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: C.items.find(i => i.id === 'sunlight_north').이격, lot: G.area(site.pts) * 0.75, far: 250, angle: 0, crit: C.items, winRatio: 2, lib: C.평면_라이브러리, lat: 37.46, sunWin: 'center' };
const VO = { fh: A.floorHeight_m, groundExtra: A.groundExtra_m, lat: 37.46, lon: 126.65, year: 2026 };

(async () => {
  await t('동지 태양: 정오 고도 = 90 − 위도 − 23.44°, 해는 정남', () => {
    const T = V.sunTrack({ lat: 37.46, year: 2026, step: 1 }), noon = T.pts.find(p => p.m === 720);
    assert.ok(Math.abs(noon.alt * 180 / Math.PI - (90 - 37.46 - 23.44)) < 0.1, noon.alt * 180 / Math.PI);
    assert.ok(Math.abs(noon.u[0]) < 1e-6 && noon.u[1] < -0.999, noon.u);
    assert.ok(/2026-12-2[12]/.test(T.date), T.date);
    // 엔진 태양(진태양시)과 방위·고도가 거의 같아야 — 오전 10시
    const s = G.sun(37.46, 10), p = T.pts.find(q => q.m === 600);
    assert.ok(Math.abs(s.alt - p.alt) < 0.003, 'alt'); const uE = [-Math.sin(s.az), -Math.cos(s.az)];
    assert.ok(Math.hypot(uE[0] - p.u[0], uE[1] - p.u[1]) < 0.005, 'az ' + uE + ' / ' + p.u);
    // 표준시: 인천 경도면 진태양시보다 약 32분 이름 → 오전 9시(표준시) 고도가 진태양시 9시보다 낮음
    const K9 = V.sunTrack({ lat: 37.46, lon: 126.65, year: 2026, basis: 'kst' }).pts[0]; assert.ok(K9.alt < T.pts[0].alt);
  });
  await t('광선: 정남 벽 높이가 거리 × tan(고도)보다 높으면 그늘', () => {
    const T = V.sunTrack({ lat: 37.46, year: 2026 }), noon = T.pts.find(p => p.m === 720), d = 30, hEdge = d * noon.tan;
    const wall = h => V.prisms([{ poly: box(-200, -d - 5, 400, 5), h }], f => f);
    assert.strictEqual(V.lit([0, 0], 0, noon, wall(hEdge + 0.5)), false);
    assert.strictEqual(V.lit([0, 0], 0, noon, wall(hEdge - 0.5)), true);
    assert.strictEqual(V.lit([0, 0], 1, noon, wall(hEdge + 0.5)), true);   // 1m 올라가면 다시 해
  });
  await t('오목한(ㄱ자) 동: 꺾인 안쪽 빈 땅은 그늘로 보지 않음', () => {
    // ㄱ자 바닥(서쪽 날개 + 북쪽 몸통) — 안쪽 모서리 앞(남동쪽 빈 땅) 점은 정오에 해를 받음(낮은 동)
    const L = [[0, 0], [10, 0], [10, 30], [40, 30], [40, 40], [0, 40]], PR = V.prisms([{ parts: [L], h: 6 }], f => f);
    const noon = V.sunTrack({ lat: 37.46, year: 2026 }).pts.find(p => p.m === 720);
    assert.strictEqual(V.lit([25, 10], 0, noon, PR), true);
    assert.strictEqual(V.lit([5, 50], 0, noon, PR), false);   // 북쪽 바로 뒤는 그늘
  });
  await t('엔진 판정과 대조: 붙인 판상 두 동(저층 미달) — 일치 97% 이상', async () => {
    const two = [{ id: 1, poly: box(50, 40, 40, 12), floors: 20, form: 'slab', angle: 0, n: 4 }, { id: 2, poly: box(50, 72, 40, 12), floors: 20, form: 'slab', angle: 0, n: 4 }];
    const us = K.unitSun(site, two, opt), r = await V.check(two, us, VO);
    assert.ok(us.cols.every(c => c.pt && c.floors), '창 좌표');
    assert.ok(r.rate >= 0.97, JSON.stringify({ rate: r.rate, lost: r.lost, diffs: r.diffs }));
    assert.ok(r.per[2].ray > 0 && r.per[1].ray === 0, JSON.stringify(r.per));
  });
  await t('엔진 판정과 대조: 자동 배치(판상) — 일치 95% 이상', async () => {
    const R = G.layout(site, opt), blds = R.buildings.map(b => ({ id: b.id, poly: b.poly, parts: b.parts, units: b.units, floors: b.floors, form: b.form, angle: b.angle, t: b.t, n: b.n }));
    const us = K.unitSun(site, blds, opt), r = await V.check(blds, us, VO), rk = await V.check(blds, us, Object.assign({}, VO, { basis: 'kst' }));
    console.log(`   자동 배치 ${blds.length}개동 ${r.n}세대: 일치 ${(r.rate * 100).toFixed(1)}% · 미달 엔진 ${us.lost} / 광선 ${r.lost.ray} · 표준시 ${rk.lost.ray} · ${r.ms}ms`);
    assert.strictEqual(r.lost.engine, us.lost);
    assert.ok(r.rate >= 0.95, JSON.stringify(r.diffs.slice(0, 5)));
    assert.ok(V.html(r, rk).includes('정밀 검산'));
  });
  console.log(`\n${n}개 모두 통과`);
})().catch(e => { console.error(e); process.exit(1); });
