// /urban 정비계획 화면 코드 10b — 오른쪽 설명 칸 ③: 개략 배치·출입구(추천·진입)·AUTO 자동 진행·건축선·사업성·적용 기준
// 2026-11-13 10-panel-plan.js(6만 3천 자)에서 떼어 냄. 기반시설·혼합·넘겨주기 설명 칸은 10-panel-plan.js. 파일 지도: CLAUDE.md '/urban 파일 지도'
//@@HEADER-END
'use strict';
function renderArch(a) {
  const pl = plan(a);
  // 출입구가 이 탭의 첫 할 일(정비계획 순서 1) — 맨 위에. 그 아래 개략 규모·평형·배치
  side.innerHTML = `<h2>${regName()} 출입구·개략 배치</h2>
  ${D.map ? blineSection(a) + gateSection(a, pl) : ''}
  <h3 style="margin-top:18px">개략 건축계획</h3>
  <p style="margin:0 0 8px"><a class="btn" style="display:inline-block;text-decoration:none" data-tool="arch" href="${toolHref('arch')}">자세한 배치·일조·3D와 교통성 검토서로 → (/arch)</a></p>
  <p class="hint">여기 개략 배치는 규모 확인용입니다. 배치 확정과 교통성·환경성·경관 검토서는 /arch에서 이 안(${esc(S.region)}안)을 불러와 이어 합니다.</p>
  ${(() => { const inf = pl.infra; if (P.infraMode === 'manual') return `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">3탭에서 <b>비율 직접 입력(${fmt(P.infraRatio)}%)</b>을 골라 그 비율로 계산 중입니다 — 지도에 그린 공원 모양은 쓰지 않습니다. 그린 모양을 쓰려면 3탭에서 '제안값 사용'을 고르세요. 획지 ${fmt(pl.site)}㎡</p>`;
    if (!inf) return '';
    const park = num(inf.parkArea);
    return `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">3탭에서 정한 정비기반시설 반영: 구역 ${fmt(a.area)}㎡ − 기반시설 ${fmt(a.area * inf.ratio)}㎡(${(inf.ratio * 100).toFixed(1)}%${park ? `, 공원·녹지 ${fmt(park)}㎡` : ''}) = <b>획지 ${fmt(pl.site)}㎡</b></p>`; })()}
  <div class="form">
    ${field('bcr', '건폐율(계획)', P.bcr, '% · 예시 가정')}
    ${field('coreUnits', '주동 1개 층 세대수', P.coreUnits, '세대/층')}
    ${feasField('rentRatio', '% of 세대수 · 임대는 49㎡형(공급 67㎡)')}
  </div>
  ${mixSection()}
  <p class="note">세대수 = 용적률 연면적 × 주거 ${JbsFeas.get().resRatio}% ÷ 세대당 평균 공급면적(표준 평면: ${Object.keys(pl.U.supply).map(t => `${t}㎡형 ${fmt(pl.U.supply[t])}㎡`).join(' · ')} · 임대 49㎡형 ${JbsFeas.supply(49)}㎡, 개략). 평형·임대 비율은 사업성 검토 첫 화면과 같은 값을 씁니다.</p>
  <div class="form">
  </div>
  <h3>개략 규모</h3>
  <div class="kpis">
    ${kpi('총 세대수', fmt(pl.units) + '세대', `연면적 ${fmt(pl.gfa)}㎡ ÷ 세대당 ${pl.perUnit.toFixed(1)}㎡`)}
    ${kpi('주동', pl.towers + '개동', `동당 ${pl.floorsTower}층 · 높이 약 ${(pl.floorsTower * 2.9).toFixed(0)}m${pl.rects && pl.towersCalc !== pl.towers ? ` · 지도 배치 기준(땅 모양 때문에 ${pl.towersCalc}개동 ${pl.floorsCalc}층 대신)` : pl.rects ? ' · 지도 배치와 같음' : ''}`)}
    ${kpi('건축면적 한도', fmt(pl.footMax) + '㎡', `획지 × ${P.bcr}%`)}
    ${kpi('지하 연면적(주차 등)', fmt(pl.basement) + '㎡', `지상 대비 ${P.basementRatio}%`)}
  </div>
  <h3>세대 구성</h3>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">세대</th></tr></thead><tbody>
    ${Object.keys(pl.U.sale).filter(t => pl.U.sale[t] > 0).map(t => `<tr><td>${t}㎡형 분양</td><td class="r">${fmt(pl.U.sale[t])}</td></tr>`).join('')}
    <tr><td>조합원 분양(토지등소유자 추정 ${fmt(a.owners)}명)</td><td class="r">${fmt(pl.members)}</td></tr>
    <tr><td>일반분양</td><td class="r">${fmt(pl.general)}</td></tr>
    <tr><td>임대주택</td><td class="r">${fmt(pl.rental)}</td></tr>
  </tbody></table></div>
  <p class="note">도면의 <b>개략 배치</b>는 주동을 ${S.placedIn === 'lots' ? '정비기반시설(도로·공원·학교·종교용지 등)을 뺀 <b>공동주택 획지</b>' : '구역계'} 안에 격자로 놓아 봅니다(인동간격 높이×0.8 개략, 배치된 주동 ${S.placed ?? '–'}개동${S.placed != null && S.placedNeed && S.placed < S.placedNeed ? ` — 땅 모양 때문에 계산상 ${S.placedNeed}개동(${S.placedFloorsCalc}층)이 다 들어가지 않아 ${S.placed}개동 × ${S.placedFloors}층으로 세대수를 맞췄습니다. 오른쪽 개략 규모도 이 값입니다` : ''}). 일조·높이·학교예정부지·문화재 위치는 /arch 단계에서 다룹니다.</p>
  ${S.archLay && S.archLay.n ? `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">지도 개략 배치(실제 평면·정북 일조·인동간격 0.8·기반시설 이격 반영, 판상 ${S.archLay.angle}°): <b>${S.archLay.n}개동 · ${fmt(S.archLay.units)}세대 · 최고 ${S.archLay.maxF}층</b> · 용적률 ${S.archLay.far.toFixed(1)}% · 건폐율 ${S.archLay.bcr.toFixed(1)}%. 위 세대수(개략 계산)와 다를 수 있으며, 형태 비교·확정은 /arch에서 합니다.</p>` : S.archLay && S.archLay.busy ? '<p class="note">지도 개략 배치를 실제 평면으로 계산하는 중입니다… (큰 구역은 1분 안팎)</p>' : S.archLay && S.archLay.fail ? '<p class="note">실제 평면 배치를 시간 안에 끝내지 못해 지도는 간단한 네모 배치로 보여 줍니다. 자세한 배치는 6 건축계획 수립(/arch)에서 하세요.</p>' : ''}
  ${handoffSection()}`;
  bindNum(['bcr', 'coreUnits', 'parkCount']);
  side.querySelectorAll('[data-mixpreset]').forEach(b => b.onclick = () => { const pr = ((ARCHC || {})['평형구성_예시'] || {})[b.dataset.mixpreset] || {}, patch = {}; unitTypes().forEach(t => { patch['mix' + t] = num(pr[t]); }); JbsFeas.set(patch); render(); });
  side.querySelectorAll('[data-handoff]').forEach(b => b.onclick = () => handoff(a, b.dataset.handoff));
  bindBline(a);
  side.querySelectorAll('[data-feas]').forEach(e => e.addEventListener('change', () => { const v = parseFloat(e.value); JbsFeas.set({ [e.dataset.feas]: isNaN(v) ? 0 : v }); render(); }));
  side.querySelectorAll('[data-gatedel]').forEach(b => b.onclick = () => { const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.gates) return; const g = z.infra.gates.splice(+b.dataset.gatedel, 1)[0]; if (g && g.kind === 'main') delete z.infra.entryPnu; GATE.last = null; saveZ(); INFRA.memo = {}; render(); toast(`${g ? GATE.KIND[g.kind] : '출입구'}를 지웠습니다${g && g.kind === 'main' ? ' — 진입도로는 다시 자동(확폭 적은 쪽)으로' : ''}`, 3000); });
  side.querySelectorAll('[data-gatemove]').forEach(b => b.onclick = () => {
    const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.gates) return; const g = z.infra.gates[+b.dataset.gatemove]; if (!g) return;
    if (g.kind !== 'main') { z.infra.gates.splice(+b.dataset.gatemove, 1); saveZ(); }   // 주출입구는 새로 찍으면 저절로 바뀜
    S.placing = 'gate:' + g.kind; $id('lmap').classList.add('picking');
    b.style.cssText = 'background:#c92a2a;color:#fff;border-color:#c92a2a'; b.textContent = '지도에서 새 자리를 누르세요';
    toast(`지도에서 ${GATE.KIND[g.kind]}의 새 자리(구역 경계)를 누르세요`, 4000);
  });
  side.querySelectorAll('[data-gatesug]').forEach(b => b.onclick = () => {
    const [kind, idx] = b.dataset.gatesug.split(':'), z = Z.zones[S.region], pl = plan(analyze(S.region)), c = GATE.suggestFor(z, pl.infra, kind)[+idx];
    if (c) GATE.put(z, kind, { lat: c.pt[0], lng: c.pt[1] });
  });
  side.querySelectorAll('[data-gate]').forEach(b => b.onclick = () => {
    S.placing = 'gate:' + b.dataset.gate; $id('lmap').classList.add('picking');
    side.querySelectorAll('[data-gate]').forEach(x => { x.classList.remove('on'); x.style.cssText = ''; });
    b.classList.add('on'); b.style.cssText = 'background:#c92a2a;color:#fff;border-color:#c92a2a';
    b.textContent = `지도에서 구역 경계를 누르세요 — ${GATE.KIND[b.dataset.gate]}`;
    toast(`지도에서 ${GATE.KIND[b.dataset.gate]}를 둘 구역 경계를 누르세요(도로에 닿은 경계)`, 4000);
  });
  const gc = document.getElementById('gateClear'); if (gc) gc.onclick = () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.gates; saveZ(); render(); } };
}
// 단지 출입구 검토(배치 탭) — 위치는 '가정', 교통영향평가·경찰 협의 뒤 확정
// 주출입구를 정하면서 바로 판단하도록: 진입도로 기준 폭·확폭·병목, 다른 경계 도로에 두면 어떤지(개략)
// 주출입구 추천 상자 — 찍기 전에 단지 상황(경계 도로 폭·닿은 길이·병목·교차로 거리)으로 순위
function gateSugHtml(a, pl, zz, gl) {
  const inf = pl.infra, e = inf && inf.entry; if (!e || !zz.roads) return '';
  const col = { main: '#c92a2a', sub: '#e67700', park: '#1971c2' };
  const main = gl.find(g => g.kind === 'main'), mr = main ? GATE.roadAt(zz, main.pt) : null;
  const descMain = x => `${esc(x.jibun)} 도로(현황 약 ${x.w}m, 닿은 길이 약 ${fmt(x.front)}m) — ${x.lack >= 0.3 ? `제25조① ${e.W}m까지 확폭 ${fmt(x.lack, 1)}m·약 ${fmt(x.area)}㎡` : '확폭 필요 없음'}${x.partial ? ' · 병목 주의' : ''}${x.dIx < 30 ? ` · 교차로에서 ${fmt(x.dIx)}m` : ''}`;
  const descSub = x => `${esc(x.jibun)} 도로(현황 약 ${x.w}m) — 주출입구에서 약 ${fmt(x.dm)}m${x.isE2 ? ' · <b>두 번째 진입도로(제25조③)</b>' : x.same ? ' · 주출입구와 같은 도로' : ' · 주출입구와 다른 도로'}${x.dIx < 30 ? ` · 교차로에서 ${fmt(x.dIx)}m` : ''}`;
  const descPark = x => `${esc(x.jibun)} 도로(현황 약 ${x.w}m${x.w < 6 ? ', 6m 미만이라 양방향 진출입 어려움' : ''}) — 주출입구에서 약 ${fmt(x.dm)}m · 교차로에서 약 ${fmt(x.dIx)}m${x.same ? ' · 주출입구와 같은 도로' : ' · 주출입구와 다른 도로(차량·보행 동선 분리)'}`;
  const BASIS = {
    main: '병목이 아닌 도로 → 진입도로 확폭 면적이 적은 도로 → 현황이 넓은 도로, 그 도로에 닿은 경계 중 교차로·모퉁이에서 가장 먼 자리.',
    sub: '진입도로 2개(제25조③)로 계산 중이면 두 번째 진입도로 → 주출입구와 다른 도로 → 주출입구에서 먼 자리(비상·보행 동선 분산).',
    park: '폭 6m 이상(양방향) 도로 → 교차로에서 30m 이상 → 주출입구와 다른 도로, 주출입구에서 30m·부출입구에서 20m 이상 떨어진 자리(차량·보행 동선 분리). 횡단보도·학교 출입구 위치는 지도 자료가 없어 빠져 있습니다.',
  };
  const box = (kind, c, desc, moving) => {
    if (!c.length) return `<div class="note" style="margin:6px 0">추천할 ${GATE.KIND[kind]} 자리가 없습니다(조건에 맞는 경계 도로 없음). 지도를 보고 직접 찍으세요.</div>`;
    return `<div style="background:#fff;border:1.5px dashed ${col[kind]};border-radius:6px;padding:8px 10px;margin:6px 0">
    <b style="color:${col[kind]}">추천 ${GATE.KIND[kind]}</b> — ${desc(c[0])}
    ${kind === 'main' && inf.entry ? entryNeeds(inf.entry, pl.units, c[0]) : ''}
    <div style="margin:5px 0"><button type="button" class="btn sm" style="background:${col[kind]};color:#fff;border-color:${col[kind]}" data-gatesug="${kind}:0">${moving ? `추천 자리로 ${GATE.KIND[kind]} 옮기기` : `추천 자리에 ${GATE.KIND[kind]} 놓기`}</button></div>
    ${c.length > 1 ? `<div class="note">다른 후보: ${c.slice(1, 3).map((x, i) => `<button type="button" class="btn ghost sm" data-gatesug="${kind}:${i + 1}">${i + 2}순위</button> ${desc(x)}`).join('<br>')}</div>` : ''}
    <div class="u" style="margin-top:3px">추천 기준: ${BASIS[kind]} 공원·녹지·종교용지·학교 등 획지가 아닌 땅의 경계와 일방통행·4m 미만 도로는 뺐습니다. 버스·보행 동선과 주변 단지 출입구는 반영하지 않았으니 지도를 보고 판단하세요.</div>
  </div>`;
  };
  const nk = GATE.nextKind(zz, inf);
  let h = '';
  if (nk === 'main') h += box('main', GATE.suggest(zz, inf), descMain, !!main);
  else {
    // 주출입구는 적정 — 추천과 다른 도로면 한 줄로만 알림
    const c = GATE.suggest(zz, inf);
    if (c.length && mr && mr.pnu !== c[0].pnu) h += `<div class="note" style="margin:6px 0">주출입구 추천 1순위는 ${descMain(c[0])}입니다. <button type="button" class="btn ghost sm" data-gatesug="main:0">추천 자리로 옮기기</button></div>`;
    if (nk === 'sub') h += box('sub', GATE.suggestFor(zz, inf, 'sub'), descSub, false);
    else if (nk === 'park') h += box('park', GATE.suggestFor(zz, inf, 'park'), descPark, false);
    else h += '<div class="note" style="margin:6px 0">✔ 주출입구·부출입구·주차장 출입구를 모두 정했습니다. 아래 검사표를 확인하고 다음 단계(정비기반시설)로 넘어가세요.</div>';
  }
  return h;
}
// 주출입구(진입도로) 추천에 따라오는 조건과 정비기반시설 확폭량(개략) — 추천 칸과 진입도로 판단 칸이 같이 씀
//  구역 안: 닿은 길이 × 모자라는 폭(구역 쪽으로 넓힘 → 정비기반시설 도로, 획지에서 빠짐)
//  병목이면 구역 밖: 같은 도로 필지의 나머지 길이(≈필지 면적÷현황 폭 − 닿은 길이) × 모자라는 폭 — 도시계획도로 결정 또는 구역 편입 검토
function entryNeeds(e, units, x) {
  const q = (e.per || {})[x.pnu] || {}, W = e.W, lack = Math.max(0, W - x.w), front = q.front || x.front || 0, len = q.len || 0;
  const inA = Math.round(x.inArea > 0 ? x.inArea : front * lack), outL = x.partial || q.partial ? Math.max(0, Math.round(len - front)) : 0, outA = Math.round(outL * lack);
  const li = [];
  li.push(`<b>① 진입도로 폭 ${W}m 이상</b> — 계획 ${fmt(units)}세대(주택건설기준 등에 관한 규정 제25조①). ${esc(x.jibun)} 도로 현황 약 ${x.w}m${lack >= 0.3 ? ` → <b>${fmt(lack, 1)}m 모자람</b>` : ' → 충족'}`);
  if (lack >= 0.3) {
    li.push(`<b>② 구역 안 확폭(정비기반시설 도로)</b> — 구역 쪽 경계를 ${fmt(lack, 1)}m 물려 도로로 내놓음: 닿은 길이 약 ${fmt(front)}m × ${fmt(lack, 1)}m ≈ <b>${fmt(inA)}㎡</b>. 이 면적은 획지에서 빠지고 기반시설(도로)로 들어감`);
    if (outL > 0) li.push(`<b>③ 구역 밖 확폭(병목 해소)</b> — 구역에 닿은 구간만 넓히면 앞뒤가 ${x.w}m로 좁은 병목. 같은 도로의 나머지 약 ${fmt(outL)}m도 ${W}m로 넓히려면 약 <b>${fmt(outA)}㎡</b>(개략, 양쪽 어디서 넓힐지는 미정) — 도시계획도로 결정 또는 정비구역 편입 검토. 합계 약 <b>${fmt(inA + outA)}㎡</b>`);
  }
  li.push(`<b>${lack >= 0.3 ? (outL > 0 ? '④' : '③') : '②'} 넓은 도로까지 이어짐</b> — 진입도로는 ${W}m 폭으로 간선도로(기간도로)까지 이어져야 함. 그 너머 구간은 지도로 확인`);
  return `<div style="margin:6px 0 2px;padding:6px 8px;background:#f8f9fb;border-radius:5px"><div class="u" style="margin-bottom:2px">이 추천에 필요한 조건과 정비기반시설 확폭(개략)</div>${li.map(t => `<div style="margin:2px 0">${t}</div>`).join('')}</div>`;
}
function gateEntryHtml(a, pl, zz, gl) {
  const inf = pl.infra, e = inf && inf.entry; if (!e || !zz.roads) return '';
  const main = gl.find(g => g.kind === 'main'); if (!main) return '';
  const r = GATE.roadAt(zz, main.pt); if (!r) return '';
  const p = e.per[r.pnu] || {}, isE1 = e.e1 && e.e1.pnu === r.pnu;
  const std = e.mode === 3 && isE1 && e.e2 ? `제25조③ 진입도로 2개 폭 합 ${e.W2}m 이상(${esc(e.e2.jibun)} ${e.e2.w}m와 합산)` : `제25조① ${e.W}m 이상`;
  const add = p.add || 0;
  let line = `<b>진입도로 판단</b> — 계획 ${fmt(pl.units)}세대 → ${std}. ${esc(r.jibun)} 도로 현황 약 ${r.w}m → 계획 약 ${p.pw || r.w}m`;
  line += add >= 0.3 ? ` · <b>구역 쪽 확폭 ${fmt(add, 1)}m, 약 ${fmt(p.area)}㎡</b>(기반시설에 들어감)` : ' · <b>확폭 필요 없음</b>';
  if (p.front) line += ` · 구역에 닿은 길이 약 ${fmt(p.front)}m`;
  if (!isE1) line += ' <span class="warn">— 정비기반시설 탭의 진입도로와 다름(정비기반시설 탭에서 확인)</span>';
  const warns = [];
  if (p.partial) warns.push('구역에 짧게 닿은 도로라 이 구간만 넓히면 앞뒤가 좁은 병목이 됩니다. 도로 전체 확폭(도시계획도로 결정)이 함께 필요한지 교통성 검토에서 확인하세요');
  if (r.w < 4) warns.push('현황 4m 미만 — 진입도로로 쓰기 어렵습니다');
  if ((((zz.infra || {}).edgeOpt || {})[r.pnu] || {}).oneway) warns.push('일방통행으로 표시된 도로입니다');
  // 다른 경계 도로에 두면(개략): 구역에 10m 이상 닿은 도로만, 확폭 면적 ≈ 닿은 길이 × 모자라는 폭
  const others = (zz.roads.edge || []).filter(x => x.pnu !== r.pnu).map(x => { const q = e.per[x.pnu] || {}; const lack = Math.max(0, e.W - x.w); return { x, q, lack, area: (q.front || 0) * lack }; })
    .filter(o => (o.q.front || 0) >= 10).sort((m, n) => m.area - n.area).slice(0, 4);
  const cur = add >= 0.3 ? (p.area || 0) : 0;
  const oth = others.length ? `<div class="note" style="margin-top:4px">다른 경계 도로에 주출입구를 두면(제25조① ${e.W}m 기준, 개략): ${others.map(o => `${esc(o.x.jibun)}(현황 ${o.x.w}m) ${o.lack >= 0.3 ? `확폭 ${fmt(o.lack, 1)}m·약 ${fmt(o.area)}㎡` : '확폭 없음'}${o.q.partial ? '·병목 주의' : ''}${o.area < cur - 50 ? ' <b>← 지금보다 적음</b>' : ''}`).join(' / ')}. 점을 그 도로 쪽 경계로 끌어 옮기면 바로 다시 계산됩니다.</div>` : '';
  const needs = e.mode === 3 ? '' : entryNeeds(e, pl.units, { pnu: r.pnu, jibun: r.jibun, w: r.w, partial: !!p.partial, front: p.front, inArea: (p.add || 0) >= 0.3 ? p.area : 0 });
  return `<div style="background:#fff8e6;border:1px solid #f0d58c;border-radius:6px;padding:8px 10px;margin:6px 0">${line}${warns.map(w => `<div class="warn" style="margin-top:3px">⚠ ${w}</div>`).join('')}${needs}${oth}<div class="u" style="margin-top:3px">현황 폭은 필지 모양으로 추정한 값입니다. 교통성 검토에서 확정합니다.</div></div>`;
}
// ===== 추천안 자동 진행 (2026-11-04 사용자 요구) =====
// "일반인은 출입구를 어디 둘지 모른다 — 구역계만 정하면 추천안이 그냥 떠야 하고, 그 추천에 따라 기반시설 → 교통성 검토로 이어져야 한다.
//  구역계만 정하고 아무것도 없으면 돌아가지 않고 어렵게 느낀다"
//  ① 구역계·필지를 불러오면 주변 도로를 자동으로 불러옴(탭과 관계없이)
//  ② 사용자가 아직 출입구를 정하지 않았으면 추천 주출입구 → 부출입구 → 주차장 출입구를 자동으로 놓음(g.auto — 지도에 '추천' 표시)
//     주출입구 → 진입도로(entryPnu) → 3탭 정비기반시설(제안값)이 그 기준으로 다시 계산됨
//  ③ 교통성 1차(진입도로 폭·법정 주차·첨두 교통량·교통영향평가 대상)를 /traffic과 같은 계산(TrafficCalc)으로 바로 보여 줌
//  사용자가 출입구를 하나라도 직접 놓거나 옮기면 그 뒤로 자동으로 바꾸지 않음. 같은 구역계에서 추천 출입구를 지웠으면 다시 넣지 않음
//  구역계가 바뀌면(추천 출입구만 있을 때) 새 구역계로 다시 추천
const AUTO = {
  tried: {}, decTried: {},
  key(z) { try { return JSON.stringify(turf.bbox(z.geojson)); } catch (e) { return ''; } },
  // 구역계·필지를 불러왔는데 주변 도로가 없으면 불러오기(구역계마다 한 번 — 실패해도 되풀이하지 않음)
  roads(id) {
    const z = Z.zones[id], R = D.regions[id];
    if (!z || !z.geojson || !R || !R.fetched || INFRA.ready(id) || INFRA.loading[id] || !VWorld.enabled) return;
    const k = id + '|' + this.key(z); if (this.tried[k]) return;
    this.tried[k] = true; INFRA.fetchRoads(id);
  },
  place(z, kind, pt) {
    z.infra.gates = GATE.list(z).filter(g => kind !== 'main' || g.kind !== 'main');
    z.infra.gates.push({ kind, pt: pt.slice(), auto: true });
    if (kind === 'main') { const r = GATE.roadAt(z, pt); if (r) z.infra.entryPnu = r.pnu; }
  },
  // 추천 출입구 자동 배치. 바꾼 게 있으면 true
  ensure(a) {
    const z = Z.zones[a.key]; if (!z || !z.geojson || !INFRA.ready(a.key)) return false;
    // 경계 도로의 도시계획도로 결정 등급(광로·대로 → 출입구 후보에서 뒤로)을 먼저 받음 — 한 번 시도해서 안 되면 그냥 진행
    if (!z.roads.edgeDecOk && !this.decTried[a.key]) { this.decTried[a.key] = true; INFRA.fetchEdgeDec(a.key); return false; }
    if (INFRA.decLoading[a.key]) return false;
    z.infra = z.infra || {};
    const k = this.key(z), gl = GATE.list(z);
    if (gl.some(g => !g.auto)) return false;            // 사용자가 직접 정한 출입구가 있음
    if (z.infra.gateAuto === k) return false;           // 이 구역계에서 이미 추천함(지운 것도 존중)
    z.infra.gates = []; if (gl.length) delete z.infra.entryPnu;
    INFRA.memo = {};
    let pl = plan(a);
    const main = pl.infra && pl.infra.entry ? GATE.suggest(z, pl.infra)[0] : null;
    z.infra.gateAuto = k;
    if (!main) { saveZ(); return true; }
    this.place(z, 'main', main.pt);
    const mainBig = GATE.isBig(main);
    for (const kind of ['sub', 'park']) {
      INFRA.memo = {}; pl = plan(a);
      const c = pl.infra && GATE.suggestFor(z, pl.infra, kind)[0];
      // 주차장 출입구 후보가 간선도로(광로·대로)뿐이면 따로 내지 않고 주출입구와 같이 씀(간선도로 차량 직접 진출입 피함)
      if (c && kind === 'park' && GATE.isBig(c) && !mainBig) { z.infra.parkShared = true; continue; }
      if (kind === 'park') delete z.infra.parkShared;
      if (c) this.place(z, kind, c.pt);
    }
    INFRA.memo = {}; saveZ();
    toast(`추천 출입구를 놓았습니다 — 주출입구 ${main.jibun} 도로(현황 약 ${main.w}m). 정비기반시설·교통성 1차가 이 기준으로 계산됩니다`, 6000);
    return true;
  },
  reset(id) {
    const z = Z.zones[id]; if (!z || !z.infra) return;
    z.infra.gates = []; delete z.infra.entryPnu; delete z.infra.gateAuto; delete z.infra.parkShared;
    GATE.last = null; INFRA.memo = {}; saveZ();
  },
  // 교통성 1차 — /traffic 도구와 같은 계산(traffic/traffic-calc.js)·같은 기준표
  traffic(a, pl) {
    if (!window.TrafficCalc || !CRIT.raw || !CRIT.raw.traffic || !CRIT.tplTraffic) return null;
    const z = Z.zones[a.key] || {}, e = pl.infra && pl.infra.entry;
    const role = r => e && e.e1 && r.pnu === e.e1.pnu ? '진입도로' : e && e.mode === 3 && e.e2 && r.pnu === e.e2.pnu ? '두 번째 진입도로' : '주변 도로';
    const roads = ((z.roads && z.roads.edge) || []).map(r => { const q = (e && e.per[r.pnu]) || {}; return { name: `${r.jibun} 도로`, w: r.w, pw: q.pw || r.w, role: role(r) }; });
    let u60 = 0, a85 = 0, a85u = 0;
    Object.entries(pl.byType || {}).forEach(([t, c]) => { const ex = num(t), n = num(c); if (ex <= 60) u60 += n; if (ex <= 85) a85 += n * ex; else a85u += n * ex; });
    const retail = pl.gfa - num(pl.U && pl.U.resArea);
    const p = { type: 'redev', siteArea: a.area, units: pl.units, units60below: u60, area85below: a85, area85above: a85u, retailGFA: retail > 1 ? retail : 0, roads };
    try { return { p, r: TrafficCalc.run(CRIT.raw.traffic, CRIT.tplTraffic, p) }; } catch (er) { console.warn('교통성 1차 계산 실패', er); return null; }
  },
  // 각 탭 위 '추천안 흐름' 카드 — 결과·주요 숫자만(설명은 검토자 화면·검토서에)
  card(a) {
    const z = Z.zones[a.key] || {}, R = D.regions[a.key] || {};
    const box = (inner, open) => `<details class="autoflow" ${open ? 'open' : ''} style="background:#f4f8ff;border:1px solid #bcd0ee;border-radius:8px;padding:8px 12px;margin:6px 0 12px">${inner}</details>`;
    if (!R.fetched) return '';
    if (!INFRA.ready(a.key)) return box(`<summary style="cursor:pointer;font-weight:700">추천안 만드는 중…</summary><p class="note" style="margin:6px 0 0">주변 도로를 불러오고 있습니다. 끝나면 <b>추천 출입구 → 정비기반시설 → 교통성 1차</b>가 자동으로 채워집니다.</p>`, true);
    const pl = plan(a), gl = GATE.list(z), main = gl.find(g => g.kind === 'main');
    const allAuto = gl.length && gl.every(g => g.auto);
    const row = (n, t, body, btn) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px dashed #cfdcef"><b style="min-width:20px;color:#1c4f9c">${n}</b><div style="flex:1;min-width:0"><b>${t}</b> ${body}</div>${btn || ''}</div>`;
    const go = (tab, label) => S.tab === tab ? '' : `<button type="button" class="btn ghost sm" data-autogo="${tab}">${label}</button>`;
    // ① 출입구
    let g1;
    if (!main) g1 = gl.length || z.infra && z.infra.gateAuto ? '<span class="warn">주출입구가 없습니다</span> — 출입구 탭에서 정하세요' : '<span class="warn">추천할 자리가 없습니다</span>(폭 4m 이상·10m 이상 닿은 경계 도로 없음) — 지도에서 직접 찍으세요';
    else {
      const r = GATE.roadAt(z, main.pt), sub = gl.find(g => g.kind === 'sub'), pk = gl.find(g => g.kind === 'park');
      const rs = g => { const q = GATE.roadAt(z, g.pt); return q ? `${esc(q.jibun)} 도로` : '경계'; };
      g1 = `주출입구 ${r ? `<b>${esc(r.jibun)} 도로</b>(현황 약 ${r.w}m${r.dec ? ` · ${esc(r.dec)}` : ''}) → 진입도로` : '<span class="warn">도로에 닿지 않음</span>'}${sub ? ` · 부출입구 ${rs(sub)}` : ''}${pk ? ` · 주차장 출입구 ${rs(pk)}` : z.infra && z.infra.parkShared ? ' · 주차장 출입구는 주출입구와 같이 씀(간선도로 차량 진출입 피함)' : ''} <span class="pill ${allAuto ? 'warn' : 'ok'}">${allAuto ? '추천안' : '직접 정함'}</span>`;
    }
    // ② 정비기반시설
    const inf = pl.infra;
    const g2 = P.infraMode === 'manual' ? `비율 직접 입력 ${fmt(P.infraRatio)}% · 획지 ${fmt(pl.site)}㎡`
      : inf ? `기반시설 <b>${(inf.ratio * 100).toFixed(1)}%</b>(${fmt(a.area * inf.ratio)}㎡${num(inf.parkArea) ? ` · 공원·녹지 ${fmt(inf.parkArea)}㎡` : ''}${inf.entry && inf.entry.W ? ` · 진입도로 ${inf.entry.mode === 3 ? `2개 합 ${inf.entry.W2}` : inf.entry.W}m 기준` : ''}) · 획지 ${fmt(pl.site)}㎡` : '계산 대기';
    // ③ 교통성 1차
    const T = this.traffic(a, pl);
    let g3 = '기준표 불러오는 중…';
    if (T) {
      const r = T.r, ar = r.access, ok = /충족/.test(ar.result) && !/미충족/.test(ar.result);
      g3 = `진입도로 ${ar.required ?? '○○'}m 이상 — <span class="pill ${ok ? 'ok' : ar.result === '미충족' ? 'bad' : 'warn'}">${esc(ar.result)}</span>${ar.roads.some(x => x.planned) ? ' (확폭 계획 반영)' : ''} · 법정 주차 ${r.parking.legal != null ? fmt(r.parking.legal) + '대' : '○○'} · 첨두 ${r.trips.value != null ? fmt(r.trips.value) + '대/시' : '○○'} · 교통영향평가 <b>${esc(r.tia.result)}</b>`;
    }
    // ④ 사업성
    let g4 = '';
    try { const b = biz(a, pl); g4 = `${fmt(pl.units)}세대 · 용적률 ${fmt(pl.farUse)}% · 비례율 <b>${(b.ratio * 100).toFixed(1)}%</b>`; } catch (er) { g4 = `${fmt(pl.units)}세대`; }
    const ok = S.tab === 'zone' || S.tab === 'req';
    return box(`<summary style="cursor:pointer;font-weight:700">추천안 흐름 — 구역계만 정하면 아래까지 자동으로 채워집니다 ${main ? '' : '<span class="pill warn">출입구 확인</span>'}</summary>
      ${row('①', '출입구', g1, go('arch', '바꾸기'))}
      ${row('②', '정비기반시설', g2, go('plan', '바꾸기'))}
      ${row('③', '교통성 1차', g3, handoffReady() ? '<button type="button" class="btn ghost sm" data-handoff="traffic">검토서로</button>' : '')}
      ${row('④', '사업성', g4, go('biz', '보기'))}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><span class="note" style="flex:1">추천안입니다. 인허가 및 심의 과정에서 변동될 수 있습니다.</span><button type="button" class="btn ghost sm" data-autoreset="1">추천안 다시 받기</button></div>`, ok);
  },
  wire() {
    side.querySelectorAll('[data-autogo]').forEach(b => b.onclick = () => { saveZ(); const t = document.querySelector(`nav.steps button[data-tab="${b.dataset.autogo}"]`); if (t) t.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    side.querySelectorAll('.autoflow [data-handoff]').forEach(b => b.onclick = () => { const a = analyze(S.region); if (a) handoff(a, b.dataset.handoff); });
    side.querySelectorAll('[data-autoreset]').forEach(b => b.onclick = () => {
      const z = Z.zones[S.region]; if (z && GATE.list(z).some(g => !g.auto) && !confirm('직접 정한 출입구를 지우고 추천안으로 다시 놓을까요?')) return;
      AUTO.reset(S.region); render();
    });
  },
};
function gateSection(a, pl) {
  const ck = GATE.check(a, pl), cls = { ok: 'ok', ng: 'bad', warn: 'warn', info: '' }, lab = { ok: '맞음', ng: '안 맞음', warn: '확인', info: '참고' };
  const zz = Z.zones[a.key] || {}, gl = GATE.list(zz);
  const sumHtml = gl.length ? `<div style="background:#f3faf3;border:1px solid #b7dcb9;border-radius:6px;padding:8px 10px;margin:6px 0">${gl.map((g, i) => { const r = GATE.roadAt(zz, g.pt); return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:2px 0"><span style="flex:1;min-width:220px">✔ <b>${GATE.KIND[g.kind]}</b> ${r ? `— ${esc(r.jibun)} 도로(현황 약 ${r.w}m)에 닿음${g.kind === 'main' ? ' → <b>진입도로로 정함</b>' : ''}` : '— <span class="warn">도로에 닿지 않은 경계</span>'}</span><button type="button" class="btn ghost sm" data-gatemove="${i}">다시 찍기(옮기기)</button><button type="button" class="btn ghost sm" data-gatedel="${i}">지우기</button></div>`; }).join('')}<div class="note" style="margin-top:4px">잘못 찍었으면 지도 위 점을 <b>끌어서 옮기거나</b>, [다시 찍기]를 누르고 새 자리를 누르세요(놓은 자리는 구역 경계에 붙습니다). 지도 위 점을 한 번 누르면 지워집니다.</div></div>` : '<p class="note" style="margin:6px 0">아직 정한 출입구가 없습니다. 아래 [주출입구 찍기]부터 누르세요.</p>';
  return `<h3 id="gateBox">단지 출입구 (가정 — 교통 검토 후 확정)</h3>
  ${gateSugHtml(a, pl, zz, gl)}${sumHtml}${gateEntryHtml(a, pl, zz, gl)}
  <p class="hint">주출입구·부출입구·주차장 출입구를 지도에서 구역 경계에 찍으면 기준을 검사합니다. 점을 누르면 지워집니다. <b>주출입구를 찍으면 그 자리에 닿은 경계 도로가 진입도로로 정해져</b> 3탭 진입도로 확폭(주택건설기준 제25조)과 교통성 검토가 그 도로 기준으로 바뀝니다. '법정'은 공동주택(부설주차장)에 바로 적용되는 조항, '참고'는 노외주차장 기준·협의 관행입니다.</p>
  ${ck.gates.some(g => g.kind === 'main') ? '<p style="margin:4px 0"><button type="button" class="btn sm" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-stepgo="plan">출입구 정함 → 다음: 3 정비기반시설(도로 확폭·공원)</button></p>' : ''}
  <div class="zk-btns"><button type="button" class="btn ghost sm" data-gate="main">주출입구 찍기</button><button type="button" class="btn ghost sm" data-gate="sub">부출입구 찍기</button><button type="button" class="btn ghost sm" data-gate="park">주차장 출입구 찍기</button>${ck.gates.length ? '<button type="button" class="btn ghost sm" id="gateClear">모두 지우기</button>' : ''}</div>
  <div class="form" style="margin-top:6px">${field('parkCount', '주차대수(계획)', P.parkCount || '', `대 · 0이면 ${legalPark(pl) ? `법정 하한 ${fmt(legalPark(pl).legal)}대` : `세대당 1대(${fmt(pl.units)}대)`}로 가정`)}</div>
  <div class="tscroll"><table class="gi-tbl"><thead><tr><th>항목</th><th>판정</th><th>내용</th><th>근거</th></tr></thead><tbody>
  ${ck.rows.map(r => `<tr><td>${r.item}</td><td><span class="pill ${cls[r.st]}">${lab[r.st]}</span></td><td class="wrap">${r.text}</td><td class="wrap u">${r.law ? '<b>법정</b> ' : '참고 '}${r.basis}</td></tr>`).join('')}
  </tbody></table></div>`;
}
// ===== 건축선·출입 계획(출입구보다 먼저 — 정비계획 건축선에 관한 계획, 도정법 시행령 제8조제3항제7호) — 계산·그림은 06-gate.js BLINE =====
function blineSection(a) {
  const z = Z.zones[a.key] || {}, rs = BLINE.roads(z), s = BLINE.get(z);
  const head = '<h3 id="blBox">건축선·출입 계획 <span class="u" style="font-weight:400">(정비계획 결정 사항 — 출입구보다 먼저)</span></h3>';
  if (!rs.length) return head + '<p class="hint">구역 경계에 닿은 도로를 불러오면 도로마다 건축한계선·전면공지·차량출입 구간을 정할 수 있습니다.</p>';
  const P0 = BLINE.proj(z), sel = (attr, pnu, cur, opts) => `<select data-${attr}="${esc(pnu)}">${Object.entries(opts).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  let aFront = 0, lNo = 0; if (P0) P0.E.forEach((e, i) => { const q = P0.edges[i]; if (!q.r) return; aFront += e.len * q.sb; q.noCar.forEach(([t0, t1]) => { lNo += (t1 - t0) * e.len; }); });
  const walks = P0 ? P0.walks : [], open = P0 ? P0.open : [], aWalk = walks.reduce((m, w) => m + Math.hypot(w.pb[0] - w.pa[0], w.pb[1] - w.pa[1]) * (num(w.w) || BLINE.walkW(z)), 0), aOpen = open.reduce((m, o) => m + num(o.area), 0);
  return `${head}
  <p class="hint">도로마다 <b>건축한계선</b>(이 선 안쪽으로만 건물), 그 사이 <b>전면공지</b> 성격, <b>차량출입 불허구간</b>을 정합니다. 아래 출입구 추천은 불허구간을 피해서 나오고, 공공보행통로·공개공지 자리에는 동을 놓지 않습니다. 숫자는 지구단위계획 결정 전 <b>가정값</b>입니다.</p>
  <div class="tscroll"><table class="gi-tbl"><thead><tr><th>경계 도로</th><th>건축한계선</th><th>전면공지</th><th>차량출입</th></tr></thead><tbody>
  ${rs.map(r => `<tr><td>${esc(r.jibun)} 도로<br><span class="u">현황 약 ${r.w}m${GATE.isBig(r) ? ' · 대로급' : ''}</span></td>
    <td><input type="number" step="0.5" min="0" style="width:64px" data-blsb="${esc(r.pnu)}" value="${BLINE.sbOf(z, r)}"> m</td>
    <td>${sel('blfront', r.pnu, BLINE.frontOf(z, r), { walk: '보도형', green: '조경형' })}</td>
    <td>${sel('blcar', r.pnu, BLINE.carOf(z, r), BLINE.CAR)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="form">${'<div class="field"><label for="blIxD">교차로 부근 불허 거리</label><input id="blIxD" type="number" step="1" value="' + BLINE.ixD(z) + '"><span class="u">m · 교차로(경계 도로가 만나는 곳)에서 이 거리 안은 차량 출입 안 함(가정, 도로교통법 제32조 모퉁이 5m보다 넉넉히)</span></div>'}</div>
  <p class="note">전면공지 약 ${fmt(aFront)}㎡ · 차량출입 불허 경계 약 ${fmt(lNo)}m${aWalk ? ` · 공공보행통로 약 ${fmt(aWalk)}㎡` : ''}${aOpen ? ` · 공개공지 약 ${fmt(aOpen)}㎡` : ''} — 건축한계선 기본값 ${BLINE.sbDef()}m(기준표 가정값). 간선도로변은 배치에서 소음 이격과 큰 쪽을 씀.</p>
  <h4 style="margin:10px 0 4px">공공보행통로</h4>
  ${walks.length ? walks.map((w, i) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:2px 0"><span style="flex:1;min-width:200px">${w.auto ? '추천 ' : '✔ '}공공보행통로 ${i + 1} — 길이 약 ${fmt(Math.hypot(w.pb[0] - w.pa[0], w.pb[1] - w.pa[1]))}m · 폭 ${num(w.w) || BLINE.walkW(z)}m</span><button type="button" class="btn ghost sm" data-blwalkdel="${i}">지우기</button></div>`).join('') : `<p class="hint" style="margin:2px 0">${s.walkOff ? '두지 않음으로 정함.' : `없음 — 서로 다른 도로를 잇는 ${BLINE.DEF.walkMin}m 이상 직선이 구역 안을 지날 때만 자동 추천(큰 가구 관통 보행로, 가정).`}</p>`}
  <div class="form"><div class="field"><label for="blWalkW">통로 폭</label><input id="blWalkW" type="number" step="0.5" value="${BLINE.walkW(z)}"><span class="u">m(가정)</span></div></div>
  <div class="zk-btns"><button type="button" class="btn ghost sm" id="blWalkPut">${S.placing === 'bl:walk' ? (S.blFirst ? '다른 쪽 끝을 누르세요…' : '첫 끝(구역 경계)을 누르세요…') : '지도에서 두 점 찍기'}</button>${Array.isArray(s.walks) || s.walkOff ? '<button type="button" class="btn ghost sm" id="blWalkAuto">추천으로 되돌리기</button>' : ''}${walks.length ? '' : ''}</div>
  <h4 style="margin:10px 0 4px">공개공지</h4>
  <p class="hint" style="margin:2px 0">공동주택은 의무 대상이 아닙니다(건축법 시행령 제27조의2① — 판매·업무·숙박 등 바닥면적 5천㎡ 이상). 상가를 크게 넣거나 지구단위계획에서 정할 때만 둡니다. 면적은 대지 10% 이하 범위에서 조례.</p>
  ${open.map((o, i) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:2px 0"><span style="flex:1">✔ 공개공지 ${i + 1}</span><input type="number" step="10" style="width:90px" data-blopen="${i}" value="${num(o.area)}"> ㎡ <button type="button" class="btn ghost sm" data-blopendel="${i}">지우기</button></div>`).join('')}
  <div class="zk-btns"><button type="button" class="btn ghost sm" id="blOpenPut">${S.placing === 'bl:open' ? '구역 경계를 누르세요…' : '공개공지 찍기'}</button></div>`;
}
function bindBline(a) {
  const z = Z.zones[a.key]; if (!z) return;
  const st = () => BLINE.st(z), map = k => (st()[k] = st()[k] || {});
  side.querySelectorAll('[data-blsb]').forEach(e => e.onchange = () => { const v = parseFloat(e.value); if (isNaN(v) || v < 0) delete map('sb')[e.dataset.blsb]; else map('sb')[e.dataset.blsb] = v; BLINE.changed(); });
  side.querySelectorAll('[data-blfront]').forEach(e => e.onchange = () => { map('front')[e.dataset.blfront] = e.value; BLINE.changed(); });
  side.querySelectorAll('[data-blcar]').forEach(e => e.onchange = () => { map('car')[e.dataset.blcar] = e.value; BLINE.changed(); });
  const ix = $id('blIxD'); if (ix) ix.onchange = () => { const v = parseFloat(ix.value); if (isNaN(v) || v < 0) delete st().ixD; else st().ixD = v; BLINE.changed(); };
  const ww = $id('blWalkW'); if (ww) ww.onchange = () => { const v = parseFloat(ww.value); if (v > 0) { st().walkW = v; if (Array.isArray(st().walks)) st().walks.forEach(w => { w.w = v; }); } BLINE.changed(); };
  side.querySelectorAll('[data-blwalkdel]').forEach(b => b.onclick = () => { const s = st(), cur = BLINE.walks(z).map(w => ({ a: w.a, b: w.b, w: w.w })); cur.splice(+b.dataset.blwalkdel, 1); s.walks = cur; if (!cur.length) { delete s.walks; s.walkOff = true; } BLINE.changed(); });
  const wa = $id('blWalkAuto'); if (wa) wa.onclick = () => { delete st().walks; delete st().walkOff; BLINE.changed(); };
  const wp = $id('blWalkPut'); if (wp) wp.onclick = () => { S.placing = 'bl:walk'; S.blFirst = null; $id('lmap').classList.add('picking'); toast('지도에서 공공보행통로 첫 끝(구역 경계)을 누르세요', 4000); render(); };
  const op = $id('blOpenPut'); if (op) op.onclick = () => { S.placing = 'bl:open'; $id('lmap').classList.add('picking'); toast('지도에서 공개공지를 둘 구역 경계를 누르세요', 4000); render(); };
  side.querySelectorAll('[data-blopen]').forEach(e => e.onchange = () => { const o = (st().open || [])[+e.dataset.blopen]; if (o) { o.area = Math.max(10, num(e.value)); BLINE.changed(); } });
  side.querySelectorAll('[data-blopendel]').forEach(b => b.onclick = () => { (st().open || []).splice(+b.dataset.blopendel, 1); BLINE.changed(); });
}
function renderBiz(a) {
  const pl = plan(a), b = biz(a, pl), rp = b.ratio * 100;
  const tone = rp >= 100 ? 'ok' : rp >= 80 ? 'warn' : 'bad';
  const A = b.A, ff = (k, unit, attrs = 'step="any"') => `<div class="field"><label for="feas_${k}">${JbsFeas.LABEL[k]}</label><input id="feas_${k}" data-feas="${k}" type="number" value="${A[k] || ''}" ${attrs}><span class="u">${unit}</span></div>`;
  const priorFields = (D.real && a.priorLand > 0)
    ? `<div class="field"><label>종전 토지 평가</label><span class="u">조서 공시지가 합 ${won(a.priorLand)} × 배율</span></div>${ff('priorMul', '배 (감정평가 추정)', 'step="0.05"')}`
    : `${ff('avgLand', `만원/㎡ — 비우면 예시 ${P.landPrice}만원/㎡`)}${ff('priorMul', '배 (감정평가 추정)', 'step="0.05"')}`;
  side.innerHTML = `<h2>${regName()} 개략 사업성</h2>
  <div class="flow">
    <div class="kpi"><div class="l">추정 비례율</div><div class="big" style="color:var(--${tone})">${rp.toFixed(1)}%</div><div class="f">(총수입 − 총사업비) ÷ 종전자산</div></div>
    <div class="kpi"><div class="l">조합원 평균 분담금 (84㎡형)</div><div class="big">${won(b.contrib)}</div><div class="f">84㎡형 조합원분양가 ${won(b.price84)} − 평균 권리가액 ${won(b.right)}</div></div>
  </div>
  <h3>가정값 <span class="badge a">가정값 — 사업성 검토 첫 화면(★빠른 사업성)과 같은 값을 씁니다</span></h3>
  <div class="form">
    ${priorFields}
    ${ff('generalPrice', '만원/평(공급)')}
    ${ff('memberRatio', `% → 조합원분양가 ${fmt(b.m.memberPrice)}만원/평`)}
    ${ff('buildCost', '만원/㎡ — 2026.9.15. 고시 232.8', 'step="0.1"')}
    ${ff('rentBuildPct', `% → 임대 건축물 ${fmt(b.A.rentPrice)}만원/평 + 부속토지 감정가`)}
    ${ff('conPrice', '만원/평(계획연면적)')}
    ${ff('gfaFactor', '배 — 지하주차장·공용 포함', 'step="0.01"')}
    ${ff('etcPct', '% of 공사비 (설계·감리·이주·금융·보상 등)')}
  </div>
  <h3>수입·지출 집계</h3>
  <div class="tscroll"><table class="ledger"><tbody>
    <tr><td>조합원 분양 ${fmt(b.m.memTotal)}세대 (평형별 공급면적 × 조합원분양가)</td><td class="r">${won(b.incMember)}</td></tr>
    <tr><td>일반 분양 ${fmt(b.m.types.reduce((n, t) => n + b.m.sale[t] - b.m.mem[t], 0))}세대</td><td class="r">${won(b.incGeneral)}</td></tr>
    <tr><td>임대주택 인수 ${fmt(pl.rental)}세대 (건축물 기본형건축비 ${b.A.rentBuildPct}% + 부속토지 감정가)</td><td class="r">${won(b.incRental)}</td></tr>
    <tr class="sum"><td>총수입</td><td class="r">${won(b.income)}</td></tr>
    <tr><td>공사비 (계획연면적 ${fmt(b.planGfa)}㎡ = 지상 ${fmt(pl.gfa)}㎡ × ${b.A.gfaFactor})</td><td class="r">${won(b.cost)}</td></tr>
    <tr><td>기타 사업비</td><td class="r">${won(b.etc)}</td></tr>
    <tr class="sum"><td>총사업비</td><td class="r">${won(b.expense)}</td></tr>
    <tr><td>종전자산 총액 (토지 ${b.useJiga ? '공시지가 합 × ' + b.A.priorMul : fmt(a.landArea) + '㎡ × ' + b.landUnit + '만원/㎡ × ' + b.A.priorMul})</td><td class="r">${won(b.prior)}</td></tr>
    <tr class="sum"><td>개발이익 (총수입 − 총사업비)</td><td class="r">${won(b.income - b.expense)}</td></tr>
  </tbody></table></div>
  <p class="note">조합원 1인당 평균 종전자산 ${won(b.avgPrior)} × 비례율 ${rp.toFixed(1)}% = 평균 권리가액 ${won(b.right)}. 임대는 작은 평형부터, 조합원은 분양 세대 비율대로 나눴습니다. 건물 평가액·상가 수입·국공유지 처리·세입자 손실보상 세부는 넣지 않은 개략 산정입니다(첫 화면 ★빠른 사업성과 같은 계산). 세부 사업성은 사업성 검토 화면의 5~7단계에서 다룹니다.</p>`;
  side.querySelectorAll('[data-feas]').forEach(e => e.addEventListener('change', () => { const v = parseFloat(e.value); JbsFeas.set({ [e.dataset.feas]: isNaN(v) ? 0 : v }); render(); }));
}
function renderRules() {
  const v = '<span class="badge v">조례 원문 대조</span>', p = '<span class="badge p">고시문 대조 필요</span>';
  const r = RULES.redevelopment, im = RULES.improvement, o = RULES.obsolete;
  side.innerHTML = `<h2>적용 기준 ${J ? '<span class="badge v">rules/incheon.json</span>' : '<span class="badge p">기본값(기준 파일 읽기 실패)</span>'}</h2>
  <dl class="rules">
    <dt>재개발 입안대상지역 ${v}</dt><dd>면적 ${fmt(r.minArea)}㎡ 이상 + 노후·불량건축물 수 ${r.obsoleteCount * 100}% 이상 + (주택접도율 ${r.road * 100}% 이하 / 과소필지 ${r.small * 100}% 이상 / 호수밀도 ${r.density} 이상 / 노후 연면적 ${r.obsoleteFloor * 100}% 이상) 중 하나 — 인천 정비조례 제5조①2</dd>
    <dt>주거환경개선 입안대상지역 ${v}</dt><dd>노후 ${im.obsoleteCount * 100}% 이상 + (접도율 ${im.road * 100}% 이하 / 과소·부정형·세장형 ${im.small * 100}% 이상 / 호수밀도 ${im.density} 이상) 중 하나 — 제5조①1</dd>
    <dt>노후·불량건축물 연한 ${v}</dt><dd>RC·강구조 공동주택 ${o.rcApt}년(주거용 지하층 있으면 ${o.otherApt}년), 그 밖의 공동주택 ${o.otherApt}년, RC 건축물 ${o.rcNonApt}년(단독주택 제외), 그 밖의 건축물 ${o.other}년 — 제3조②</dd>
    <dt>과소필지 ${v}</dt><dd>건축조례 제28조① 분할제한면적 미만. 주거지역 ${RULES.smallParcel['주거지역']}㎡(2024.3.28. 개정, 종전 90㎡), 상업·공업 150㎡, 녹지 200㎡ — 정비조례 제2조5호</dd>
    <dt>호수밀도 ${v}</dt><dd>1만㎡당 동수. 공동주택은 세대수가 가장 많은 층의 세대수, 단독·다가구→다세대 전환은 전환 전 동수, 비주거는 건축면적 ${RULES.nonResM2PerUnit}㎡당 1동(절사), 신발생무허가 제외 — 제2조6호</dd>
    <dt>주택접도율 ${v}</dt><dd>폭 ${RULES.roadAccess.width}m 이상 도로에 길이 ${RULES.roadAccess.frontage}m 이상 접한 대지의 건축물 수 ÷ 건축물 총수. 연장 35m 이상 막다른 도로는 폭 6m — 제2조7호</dd>
    <dt>구역 확장 ${v}</dt><dd>도시계획위원회 심의로 입안대상지역 면적의 ${Math.round(RULES.expansion * 100)}% 이하 — 제5조③</dd>
    <dt>입안 요청·제안 동의 ${v}</dt><dd>입안 요청 토지등소유자 30% 이상(제8조의2), 입안 제안 50% 이상 및 토지면적 1/2 이상(제9조)</dd>
    <dt>구청장 직접 입안 동의 ${p}</dt><dd>토지등소유자 1/2 이상 및 토지면적 1/2 이상(종전 2/3) — 2030 정비기본계획 변경(2026.4.27.)</dd>
    <dt>용적률 체계 ${RULES.status.far === 'press' ? p : v}</dt><dd>2종 기준 ${RULES.far['제2종일반주거지역'].base} / 허용 ${RULES.far['제2종일반주거지역'].allowed} / 상한 ${RULES.far['제2종일반주거지역'].max}, 3종 기준 ${RULES.far['제3종일반주거지역'].base} / 허용 ${RULES.far['제3종일반주거지역'].allowed} / 상한 ${RULES.far['제3종일반주거지역'].max}</dd>
    <dt>국민주택규모 건설비율 ${v}</dt><dd>법적상한까지 완화 시 증가 용적률의 재개발 ${RULES.natHousing.redevelopment * 100}%, 재건축 30% — 제27조</dd>
  </dl>
  <p class="note">근거: 인천광역시 도시 및 주거환경정비 조례(2025.12.31. 시행, 제7686호), 인천광역시 건축 조례(2026.7.13. 시행, 제7764호). 국가법령정보센터 원문과 2026.10.30. 대조.</p>`;
}

