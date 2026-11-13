// 검증사례 A구역 대조 + 공원(의무 아님) 넣기 시험(2026-11-13, JBSLAB_작업기준서 4장·오류기록 4번)
//   node tools/ui-test/case-a-ui.js [결과.json]
// 구역은 검증사례/A구역_정비구역경계.geojson(고시 구역계). 브이월드는 작업 공간에서 막혀 있어 토지조서·주변 도로 없이 돈다
//  → 토지조서가 있어야 나오는 값(기존 도로 비율·종전자산·비례율)은 '조서 없음'으로 적고, 홈페이지에서 따로 확인
// 확인하는 것(공원):
//  1. 5만㎡ 미만 구역 — 기본 '법정 의무만'이면 공원 0㎡
//  2. '의무 없어도 공원 넣기' 5% → 공원 면적이 '최소' 기반시설에 더해지고 획지·세대수·사업비가 바뀜(사업성 반영)
//  3. 비율을 7.94%로 바꾸면 공원 면적 = 구역 × 7.94%
//  4. /urban으로 가져가면 같은 공원 설정(의무 없어도 넣기·비율)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = __dirname + '/node_modules', PORT = 8775;
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const LIB = [[/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/[Tt]urf/, '@turf/turf/turf.min.js']];
const ok = [], bad = [];
const check = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { ok.push(what); console.log('  ✔', what); } else { bad.push(`${what} — 기대 '${JSON.stringify(want)}', 실제 '${JSON.stringify(got)}'`); console.log('  ✘', what, '기대', want, '실제', got); } };
const near = (what, got, want, tol) => check(`${what} (${got} ≈ ${want})`, Math.abs(got - want) <= tol, true);
const ZONE = JSON.parse(fs.readFileSync(path.join(ROOT, '검증사례/A구역_정비구역경계.geojson'), 'utf8'));
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => { const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (u.startsWith(U('/'))) return r.continue();
    for (const [re, to] of LIB) if (re.test(u) && fs.existsSync(NM + '/' + to)) return r.fulfill({ contentType: to.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(NM + '/' + to) });
    return r.fulfill({ status: 204, body: '' }); });
  const errs = []; const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(pg.url().replace(U(''), '') + ' ' + e.message));
  await pg.goto(U('/robots.txt'));
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('jbs.project.v1', JSON.stringify({ name: 'A구역 재건축(검증사례)' })); });
  await pg.goto(U('/')); await pg.waitForTimeout(3000);
  await pg.evaluate(() => { App.go('area'); }); await pg.waitForTimeout(600);
  await pg.evaluate(Z => { S.meta.type = 'reconstruction'; MapView.setZoneGeo(Z, 'A구역 구역계', '파일', true); }, ZONE); await pg.waitForTimeout(500);
  const out = {};
  out.area = await pg.evaluate(() => ({ drawn: S.area.drawnArea, site: Calc.siteArea(S) }));
  console.log('구역 면적(사이트 계산)', out.area);
  near('구역 면적 = 고시 CAD 40,448㎡(EPSG:5186, ±1㎡ — 오류기록 6번)', Math.round(out.area.site), 40448, 1);

  const val = () => pg.evaluate(() => {
    const q0 = Quick.ensure(), site = Calc.siteArea(S), lv = q0.infraLevel || 'avg';
    const q = { ...q0, infraLevel: 'custom', infraPct: Quick.levelPct(q0, lv) }, e = Quick.evaluate(q), mi = Quick.minInfra(q0), pk = Quick.parkAdd(q0, site);
    const cost = e.r.cost, tot = cost.total;
    return { lv, infraPct: q.infraPct, min: mi.v, avg: Quick.INFRA.avg, cons: Quick.INFRA.cons, park: pk.on ? pk.area : 0, lot: e.f.lot, far: e.f.v, units: e.p.total, gen: e.p.total - e.p.rentU - e.p.memTotal,
      costTot: tot, revTot: e.r.rev.total, ratio: e.r.ratio, prior: e.r.prior, parts: cost.items.filter(it => it.amount > 0).map(it => [it.name, Math.round(it.amount / tot * 1000) / 10]),
      revShop: (e.r.rev.byCat['상가'] || 0) / (e.r.rev.total || 1) * 100, zone: q0.zone, gfa: Calc.gfa(e.t) };
  });
  console.log('1. 기본(법정 의무만)');
  await pg.evaluate(() => { Quick.ensure(); S.quick.infraLevel = 'min'; App.update(true); }); await pg.waitForTimeout(300);
  const v0 = await val(); out.legal = v0;
  check('5만㎡ 미만 기본은 공원 0㎡', v0.park, 0);
  console.log('2. 의무 없어도 공원 넣기(기본 5%)');
  await pg.evaluate(() => { App.go('quick'); }); await pg.waitForTimeout(800);
  const radio = await pg.$('input[name="qkPark"][value="add"]');
  check('공원 넣기 선택지가 화면에 있음', !!radio, true);
  if (radio) { await radio.click(); await pg.waitForTimeout(500); }
  const v1 = await val(); out.add5 = v1;
  near('공원 = 구역 × 5%', Math.round(v1.park), Math.round(out.area.site * 0.05), 2);
  check('공원을 넣으면 \'최소\' 단계로', v1.lv, 'min');
  near('최소 비율 = 15%(조서 없음 가정) + 5%', v1.min, 20, 0.01);
  check('공원 넣으면 획지가 줄어듦', v1.lot < v0.lot, true);
  check('공원 넣으면 세대수가 줄어듦(사업성 반영)', v1.units < v0.units, true);
  check('공원 넣으면 총수입이 바뀜(사업성 반영)', v1.revTot !== v0.revTot, true);
  check('화면 구역 면적 줄에 공원 면적 표시', await pg.evaluate(() => /공원 [\d,]+㎡ 포함/.test(document.getElementById('qkOut').textContent)), true);
  console.log('3. 비율 7.94%(A구역 실제 소공원 비율)');
  await pg.fill('#qkParkPct', '7.94'); await pg.dispatchEvent('#qkParkPct', 'change'); await pg.waitForTimeout(500);
  const v2 = await val(); out.add794 = v2;
  near('공원 = 구역 × 7.94%', Math.round(v2.park), Math.round(out.area.site * 0.0794), 2);
  console.log('5. 같은 입력으로 비례율(고시값과 대조) — 파라미터 파일 값 + 나머지는 사이트 기본 가정값');
  //  넣은 값: 준공업 300%, 기반시설 14.22%, 조합원 630명, 공사비 620만원/평, 조합원분양가 90%, 임대 0, 종전자산 1,789억(구역지정 고시, shared/feas.js houseMul 근거 주석)
  //  평형은 사이트가 59·84·114만 세므로 55·74→59(49%), 84(35%→36%), 104→114(15%)로 어림. 일반분양가는 파라미터 파일에 없어 사이트 기본값
  const same = await pg.evaluate(() => {
    JbsFeas.set({ conPrice: 620, memberRatio: 90, rentRatio: 0, mix59: 49, mix84: 36, mix114: 15, mix39: 0, mix49: 0, mix74: 0, mix101: 0 });
    Object.assign(S.quick, { zone: '준공업지역_공동주택', zoneManual: true, farStep: 'base', infraLevel: 'custom', infraPct: 14.22, members: 630, membersManual: true, park: 'legal' });
    S.prior.mode = 'manual'; S.prior.manual = 17890000;   // 만원
    const q0 = Quick.ensure(), q = { ...q0 };
    const ev = qq => { const e = Quick.evaluate(qq); return { ratio: e.r.ratio, units: e.p.total, gen: e.p.total - e.p.rentU - e.p.memTotal, far: e.f.v, cost: e.r.cost.total, rev: e.r.rev.total, gfa: Calc.gfa(e.t), shop: (e.r.rev.byCat['상가'] || 0) / e.r.rev.total * 100, con: (e.r.cost.items.find(it => /신축 공사비/.test(it.name)) || {}).amount / e.r.cost.total * 100, generalPrice: q0.generalPrice, gfaFactor: q0.gfaFactor, etcPct: q0.etcPct }; };
    const b = ev(q), e0 = Quick.evaluate(q), R = mm => Calc.result(e0.t, mm).ratio - b.ratio;   // 사이트 민감도 표와 같은 방식(배율)
    // 같은 입력에서 A구역 비례율 81.91%가 나오려면 일반분양가가 얼마여야 하는지(이분법) — 일반분양가가 파라미터에 없어서
    let lo = 500, hi = 5000; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; JbsFeas.set({ generalPrice: mid }); const rr = Quick.evaluate({ ...Quick.ensure() }).r.ratio; if (rr > 81.91) hi = mid; else lo = mid; }
    const gpFit = (lo + hi) / 2; JbsFeas.set({ generalPrice: b.generalPrice });
    return { base: b, conUp: R({ construction: 1.05 }), conDown: R({ construction: 0.95 }), memUp: R({ member: 1.05 }), memDown: R({ member: 0.95 }), gpFit,
      split: JbsFeas.etcSplit(e0.r.cost.items.filter(it => it.basis === 'pctConstruction').reduce((a, it) => a + it.amount, 0)).map(([n, v]) => [n, Math.round(v / e0.r.cost.total * 1000) / 10]) };
  });
  out.same = same; console.log(same);
  check('같은 입력 비례율 계산됨', isFinite(same.base.ratio), true);
  near('민감도: 공사비 +5% → A구역 고시 −8%p와 ±1.5%p 안', Math.round(same.conUp * 10) / 10, -8, 1.5);
  near('민감도: 조합원분양가 +5% → A구역 고시 +9%p와 ±2.5%p 안', Math.round(same.memUp * 10) / 10, 9, 2.5);
  await pg.evaluate(() => { JbsFeas.reset && JbsFeas.reset(); S.prior = defaultState().prior; S.quick.park = 'add'; S.quick.parkPct = 7.94; S.quick.infraLevel = 'min'; saveState(); });
  console.log('4. /urban으로 가져가기');
  await pg.evaluate(() => saveState());
  await pg.goto(U('/urban/')); await pg.waitForTimeout(2500);
  await pg.evaluate(() => importProject('A')); await pg.waitForTimeout(1500);
  // 브이월드가 막혀 필지가 없으므로 구역 전체를 대지 한 필지로 넣고 계산(한 필지 재건축과 같은 꼴, 기존 도로 없음)
  await pg.evaluate(G => { const A = turf.area(G); CACHE.parcels.T1 = { jibun: '1', jimok: '대', jiga: 0, geom: G.geometry, cadArea: A, ledgerArea: A, zoning: '제3종일반주거지역', roadSide: '', lc: true }; CACHE.blds.T1 = []; Z.zones.A.inArea = { T1: 1 }; Z.zones.A.fetchedAt = '2026-11-13 00:00'; D = buildMap(); INFRA.memo = {}; }, ZONE);
  const u = await pg.evaluate(() => { const a = analyze('A'); let inf = null; try { inf = INFRA.compute(a, plan(a).units); } catch (e) { inf = { err: e.message }; } return { parkMode: P.parkMode, parkPct: P.parkPct, area: a.area, park: inf && inf.parkArea, parkLegal: inf && inf.parkLegal, total: inf && inf.total, ratio: inf && inf.ratio, err: inf && inf.err }; });
  out.urban = u; console.log('/urban', u);
  check('/urban 공원 설정 이어받음', [u.parkMode, u.parkPct], ['always', 7.94]);
  if (u.parkLegal != null) near('/urban 공원 제안 = 구역 × 7.94%', Math.round(u.parkLegal), Math.round(u.area * 0.0794), 3);
  await pg.evaluate(() => { P.parkMode = 'legal'; saveP(); INFRA.memo = {}; });
  const u0 = await pg.evaluate(() => { const a = analyze('A'); const inf = INFRA.compute(a, plan(a).units); return inf ? inf.parkLegal : null; });
  out.urbanLegal = u0;
  check('/urban 법정 의무만이면 공원 0㎡', u0, 0);
  check('콘솔 오류 0', errs, []);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`); bad.forEach(b => console.log(' -', b));
  await br.close(); srv.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
