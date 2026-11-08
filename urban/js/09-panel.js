// /urban 정비계획 화면 코드 9/12 — 오른쪽 설명 칸 ①: 단계 이동·구역 현황·요건판정·계획·작성 안내·도면
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 우측 패널 ===== */
const side = document.getElementById('side');
// /arch·검토서 바로가기: 지금 보고 있는 안(S.region)을 ?urban= 으로 넘김(그린 구역계가 없으면 그냥 도구 첫 화면)
const toolHref = t => { const z = Z.zones[S.region]; return `../${t}/` + (z && z.geojson ? `?urban=${encodeURIComponent(S.region)}` : ''); };
function syncToolLinks() { document.querySelectorAll('a[data-tool]').forEach(a => { a.href = toolHref(a.dataset.tool); }); }
let toolBusy = false;
// 이동 전에 지금 안을 저장하고, 주변 도로(경계 도로 폭·소유구분)를 아직 안 불러왔으면 불러온 뒤 이동 — /arch가 도로 변을 정할 때 씀
document.addEventListener('click', async e => {
  const a = e.target.closest && e.target.closest('a[data-tool]'); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  const id = S.region, z = Z.zones[id], url = toolHref(a.dataset.tool);
  saveZ();
  if (!z || !z.geojson || INFRA.ready(id) || !VWorld.enabled) { a.href = url; return; }
  e.preventDefault();
  if (toolBusy) return; toolBusy = true;
  toast(`${id}안 주변 도로를 불러오는 중… 끝나면 이동합니다`, 60000);
  try {
    if (!INFRA.loading[id]) await INFRA.fetchRoads(id);
    for (let k = 0; k < 120 && INFRA.loading[id]; k++) await new Promise(r => setTimeout(r, 500));
  } finally { toolBusy = false; }
  if (!INFRA.ready(id)) toast('주변 도로를 다 불러오지 못했습니다 — 도로 자료 없이 이동합니다', 2500);
  saveZ(); location.href = url;
});
function render() {
  syncToolLinks();
  drawMap();
  if (S.tab === 'rules') { renderRules(); return; }
  const a = analyze(S.region);
  if (!a) {
    const R = D.regions[S.region];
    if (!D.map) side.innerHTML = `<h2>${regName()}</h2><p>아직 그린 구역계가 없습니다. 도면 위 <b>구역계 그리기</b>를 눌러 꼭짓점을 찍어 보세요.</p>`;
    else if (R.geojson) side.innerHTML = `<h2>${regName()}</h2>${jobHtml()}${JOB.active && JOB.zone === S.region ? '' : '<p class="empty-guide">아직 필지·건축물을 불러오지 않았습니다. <b>필지·건축물 다시 불러오기</b>를 눌러 주세요.</p>'}`;
    else side.innerHTML = `<h2>${regName()} · 구역계가 없습니다</h2><div class="empty-guide"><ol>
      <li>지도 위 검색 칸에 주소나 지번을 넣어 대상지로 이동합니다. 예: 용현동 340</li>
      <li><b>구역계 그리기</b>를 누르고 지도에서 꼭짓점을 찍습니다. 첫 점을 다시 누르면 완성됩니다.</li>
      <li>완성하면 그 안의 필지·건축물·토지특성을 자동으로 불러와 요건판정부터 사업성까지 보여 줍니다.</li></ol>
      <p>안을 여러 개(A·B·C…) 그려 같은 기준으로 비교할 수 있습니다. 사업성 검토 화면에 그린 구역이 있으면 위의 <b>사업성 검토 구역 가져오기</b>로, 경위도(WGS84) GeoJSON 파일은 <b>GeoJSON 불러오기</b>로 넣을 수 있습니다.</p></div>`;
    return;
  }
  if (D.map && AUTO.ensure(a)) drawMap();   // 구역계·도로가 들어오면 추천 출입구 자동 배치 → 지도 다시
  ({ zone: renderZone, req: renderReq, plan: renderPlan, arch: renderArch, biz: renderBiz })[S.tab](a);
  if (D.map && S.tab !== 'biz') { const h2 = side.querySelector('h2'), h = AUTO.card(a); if (h2 && h) { h2.insertAdjacentHTML('afterend', h); AUTO.wire(); } }
  if (JOB.active && JOB.zone === S.region) side.insertAdjacentHTML('afterbegin', jobHtml());
  stepNav();
}
// 각 탭 맨 아래 '다음 단계' 버튼(2026-11-04 사용자 요구: 기반시설을 정한 뒤 다음으로 넘어가는 버튼). 지금 정한 값은 저장된 상태로 넘어감
function stepNav() {
  // 화면 탭 순서 = 위 '정비계획 순서'(주출입구 → 정비기반시설 → 교통성 …)와 같게: 출입구·개략 배치가 정비기반시설보다 앞
  const ORDER = [['zone', '구역계·현황'], ['req', '요건판정'], ['arch', '출입구·개략 배치'], ['plan', '정비기반시설'], ['biz', '사업성']];
  const i = ORDER.findIndex(([k]) => k === S.tab); if (i < 0) return;
  const prev = ORDER[i - 1], next = ORDER[i + 1];
  const nextLabel = S.tab === 'arch' ? '출입구 정함 → 다음: 정비기반시설(도로 확폭·공원)' : next ? `다음: ${next[1]} →` : '';
  side.insertAdjacentHTML('beforeend', `<div class="stepnav" style="display:flex;justify-content:space-between;gap:8px;margin:18px 0 6px;padding-top:12px;border-top:1px solid var(--line)">
    ${prev ? `<button type="button" class="btn ghost" data-stepgo="${prev[0]}">← ${prev[1]}</button>` : '<span></span>'}
    ${S.tab === 'plan' ? `<button type="button" class="btn" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-handoffnav="traffic" ${handoffReady() ? '' : 'disabled'}>기반시설 확정 → 다음: 3 교통성 검토(계획값을 넘김)</button>` : next ? `<button type="button" class="btn" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-stepgo="${next[0]}">${nextLabel}</button>` : S.tab === 'biz' ? `<a class="btn" style="background:var(--ink);color:var(--paper);text-decoration:none" data-tool="arch" href="${toolHref('arch')}">다음: 자세한 배치(/arch) →</a>` : ''}</div>`);
  side.querySelectorAll('[data-handoffnav]').forEach(b => b.onclick = () => { const a = analyze(S.region); if (a) handoff(a, b.dataset.handoffnav); });
  side.querySelectorAll('[data-stepgo]').forEach(b => b.onclick = () => {
    saveZ(); try { saveP(); } catch (e) { /* 무시 */ }
    const t = document.querySelector(`nav.steps button[data-tab="${b.dataset.stepgo}"]`); if (t) t.click();
    if (b.dataset.stepgo === 'arch' && S.region) setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo({ top: 0, behavior: 'smooth' }); }, 300);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
const kpi = (l, v, f) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="f">${f || ''}</div></div>`;
const kpiNA = l => `<div class="kpi na"><div class="l">${l}</div><div class="v" style="color:#8a8f98">해당없음</div><div class="f">재개발사업 적용요건</div></div>`;
// 지금 안이 재건축인지: 사업성 검토 화면에서 가져온 구역이고 그 화면 사업 유형이 재건축
function isReconZone(key) {
  const z = Z.zones[key], p = loadProject(), st = p && (p.state || p);
  if (!z || !z.geojson || !st || !st.meta || st.meta.type !== 'reconstruction' || !st.area || !st.area.geojson) return false;
  if (z.from === 'project') return true;
  // 직접 다시 불러온 구역이어도 사업성 검토(재건축) 구역과 절반 이상 겹치면 재건축으로 봄
  try { const a = st.area.geojson, g = a.type === 'Feature' ? a : turf.feature(a), x = turf.intersect(g, z.geojson); return !!x && turf.area(x) >= 0.5 * Math.min(turf.area(g), turf.area(z.geojson)); } catch (e) { return false; }
}
// 화면 제목·내보내기에 구역명(있으면)을 붙임: "용현1구역 · A안"
const regName = () => esc((Z.title ? Z.title + ' · ' : '') + D.regions[S.region].name);
function syncTitle() { document.title = (Z.title ? Z.title + ' — ' : '') + 'jbslab 정비계획 검토'; }
function renderZone(a) {
  const rows = a.bs.slice().sort((x, y) => (x.year || 9999) - (y.year || 9999)).map(b => {
    const p = b.pid != null ? D.parcels[b.pid] : null;
    return `<tr><td>${esc(p ? p.jibun : '(필지 연결 안 됨)')}</td><td>${esc(b.use)}${b.src ? ` <span class="u">${esc(b.src)}</span>` : ''}</td><td>${esc(b.struct)}</td><td class="r">${b.year || '–'}</td><td class="r">${fmt(b.floor)}</td><td>${b.unknown ? '<span class="pill warn">확인</span>' : b.old ? '<span class="pill bad">노후</span>' : '<span class="pill ok">비노후</span>'}</td><td>${esc(b.why)}</td><td>${p ? `<button class="acc ${p.access === true ? 'ok' : p.access === false ? 'bad' : ''} ${p.manual ? 'man' : ''}" data-pid="${p.id}" title="${esc(p.accSrc)} · 누르면 충족 → 미충족 → 자동">${p.access == null ? '미확인' : p.access ? '충족' : '미충족'}${p.manual ? ' · 지정' : ''}</button>` : '–'}</td><td>${b.lic}</td></tr>`;
  }).join('');
  const recon = D.map && isReconZone(S.region);
  if (D.map && a.needUnits) setTimeout(() => autoLedger(S.region), 0);   // 공동주택 세대수가 비었으면 대장으로 한 번 채움
  side.innerHTML = `<h2>${regName()} 현황분석 ${D.map ? `<span class="badge v">공부 조회 ${esc(D.regions[S.region].at)}</span>` : '<span class="badge a">예시 데이터</span>'}</h2>
  <div class="kpis">
    ${kpi('구역 면적', fmt(a.area) + '㎡', D.map ? '그린 구역계 면적(도로 포함)' : '구역계 폴리곤 면적(도로 포함)')}
    ${kpi('편입 필지', a.ps.length + '필지', `${D.map ? '대장 면적×편입비율' : '조서 면적'} 합 ${fmt(a.landArea)}㎡`)}
    ${kpi('건축물', a.N + '동', `연면적 ${fmt(a.fa)}㎡` + (a.ghostN ? `<br>공부 정보 없는 GIS 건물 ${a.ghostN}동 ${({ out: '제외', unknown: '포함(연도 미확인)', old: '포함(기존무허가·노후)' })[ghostMode()]}` : ''))}
    ${kpi('노후도(동수)', oldText(a), `${a.oldN} / ${a.N}동${a.unknownN ? ` · 사용승인 연도 미확인 ${a.unknownN}동` : ''}${a.estN ? ` · ${a.estN}동은 같은 단지 주동 연도로 추정` : ''}`)}
    ${kpi('노후도(연면적)', pct(a.oldFaRatio), `${fmt(a.oldFa)} / ${fmt(a.fa)}㎡`)}
    ${recon ? kpiNA('과소필지') : kpi('과소필지', pct(a.smallRatio), `분할제한면적 미만 ${a.smallN} / ${a.ps.length}필지`)}
    ${recon ? kpiNA('주택접도율') : kpi('주택접도율', accText(a), `폭4m·4m 이상 접도 ${a.accN} / ${a.N}동${a.accU ? ` · 미확인 ${a.accU}동` : ''}`)}
    ${recon ? kpiNA('호수밀도') : kpi('호수밀도', a.density.toFixed(1) + '동/ha', `${a.du}동 ÷ ${(a.area / 10000).toFixed(2)}ha`)}
    ${kpi('토지등소유자(추정)', fmt(a.owners) + '명', D.map ? '소유자 정보 없음: 사유지 1필지 1인, 공동주택은 세대별' + (a.needUnits ? ` · 세대수 미확인 ${a.needUnits}동` : '') : '1필지 1인, 다세대는 호수별')}
  </div>
  ${a.ghostN ? `<div class="ghost-note"><b>공부 정보 없는 GIS 건물 ${a.ghostN}동</b> — 무허가건축물일 수 있음
    <div class="seg" role="group" aria-label="공부 없는 건물 처리" style="margin-top:6px">
      <button type="button" data-gm="out" aria-pressed="${ghostMode() === 'out'}">빼기</button><button type="button" data-gm="unknown" aria-pressed="${ghostMode() === 'unknown'}">넣기(연도 미확인)</button><button type="button" data-gm="old" aria-pressed="${ghostMode() === 'old'}">기존무허가로 넣기(노후)</button></div>
    <div class="u">GIS건물통합정보에 용도·면적·사용승인일이 모두 비어 있고 건축물대장에도 없는 건물입니다. 무허가건물·부속건물·가설건축물이거나 GIS 오류일 수 있습니다. 기존무허가건축물(1989.1.24. 당시 있던 무허가건물)은 건축물로 보아 노후도에 넣고 노후로 셉니다. 그 뒤 생긴 신발생 무허가건물은 넣지 않습니다. 오래된 주거지면 대부분 기존무허가일 가능성이 높지만, 부속 창고·화장실 등이 섞이므로 무허가건축물관리대장(구청)·항공사진(1989년 전후)·재산세 과세대장으로 확인해 고르세요. 연면적 정보가 없어 연면적 노후도에는 영향이 없습니다.</div></div>` : ''}
  <h3>건축물 현황 (준공 오래된 순)</h3>
  <div class="tscroll"><table><thead><tr><th>지번</th><th>용도</th><th>구조</th><th class="r">사용승인</th><th class="r">연면적㎡</th><th>판정</th><th>근거</th><th>접도</th><th>허가</th></tr></thead><tbody>${rows || '<tr><td colspan="9">건축물이 없습니다.</td></tr>'}</tbody></table></div>
  <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="copyTbl">표 복사(엑셀 붙여넣기용)</button></div>
  <p class="note">접도는 ${D.real ? "토지특성 <b>도로접면</b>으로 추정합니다. 광대로·중로·소로·세로(가)는 폭 4m 이상 도로에 접한 것으로, 세로(불)·맹지는 미충족으로 봅니다. 세로(가)는 '폭 8m 미만·자동차 통행 가능' 도로라 4m가 안 될 수 있으니, 현장과 다르면 접도 칸이나 도면(색 구분 '접도')의 필지를 눌러 직접 지정하세요." : '예시 구역의 도로 폭으로 판정합니다. 접도 칸을 눌러 직접 지정해 볼 수 있습니다.'}</p>
  ${D.map ? '<p class="note">자료: 필지는 브이월드 연속지적도와 토지특성(대장 면적·지목·공시지가·용도지역·도로접면), 건축물은 GIS건물통합정보이고, 공동주택은 건축물대장 표제부로 바꿔 세대수를 넣습니다(용도 옆 \'대장\' 표시).</p>' : ''}
  <p class="note">노후·불량 판정은 인천 정비조례 제3조②를 사용승인 연도에 적용한 값입니다.${D.real ? ' 공동주택의 지하층이 주거용인지는 대장만으로 알 수 없어 RC 30년으로 보고, 지하층이 있으면 근거에 표시합니다. 호수밀도의 "세대수가 가장 많은 층"은 세대수 ÷ 지상층수로 어림합니다.' : ''}</p>`;
  side.querySelectorAll('button.acc').forEach(bt => bt.onclick = () => cycleAccess(+bt.dataset.pid));
  side.querySelectorAll('[data-gm]').forEach(b => b.onclick = () => { P.ghostMode = b.dataset.gm; P.ghostIn = P.ghostMode !== 'out'; saveP(); render(); });
  document.getElementById('copyTbl').onclick = async () => {
    const head = '지번\t용도\t구조\t사용승인\t연면적\t판정\t근거\t접도\t허가';
    const body = a.bs.map(b => { const p = b.pid != null ? D.parcels[b.pid] : null; return [p ? p.jibun : '', b.use, b.struct, b.year || '', b.floor, b.unknown ? '확인' : b.old ? '노후' : '비노후', b.why, !p || p.access == null ? '미확인' : p.access ? '충족' : '미충족', b.lic].join('\t'); }).join('\n');
    try { await navigator.clipboard.writeText(head + '\n' + body); toast('표를 복사했습니다'); } catch (e) { toast('복사가 막혀 있습니다. 표를 직접 선택해 복사해 주세요'); }
  };
}
const PILL = { ok: ['ok', '충족'], bad: ['bad', '미충족'], unk: ['warn', '확인 필요'] };
// 관련 평가 대상(개략) — 교통영향평가·환경영향평가·소규모 환경영향평가·전략환경영향평가. 기준값은 shared/criteria(검토서 도구와 같은 표)
function evalSection(a) {
  const T = CRIT.traffic || {}, E = CRIT.environment || {};
  if (!CRIT.traffic && !CRIT.environment) return '<h3>관련 평가 대상 (개략)</h3><p class="hint">기준표(shared/criteria)를 불러오는 중…</p>';
  const green = Object.entries(a.zoneArea || {}).some(([z, v]) => /녹지/.test(z) && v > 0);
  const row = (name, it, hit, how, link) => {
    if (!it) return `<tr><td>${name}</td><td><span class="pill warn">기준 없음</span></td><td class="wrap u">기준표에 항목이 없습니다</td><td></td></tr>`;
    const chk = /확인필요/.test(it['상태'] || '') || it['값'] == null;
    const st = it['값'] == null ? '<span class="pill warn">확인 필요</span>' : hit ? '<span class="pill info">대상</span>' : '<span class="pill ok">대상 아님</span>';
    return `<tr><td>${name}${link ? `<br><a class="u" href="${link}">검토서 도구 →</a>` : ''}</td><td>${st}</td><td class="wrap">${how}${chk ? ' <b class="warn">※ 기준 확인 필요</b>' : ''}</td><td class="wrap u">${esc(it['근거'] || '')}${it['상태'] ? `<br>${esc(it['상태'])}` : ''}</td></tr>`;
  };
  const tia = T.tia_redev_site_area, eia = E.eia_redev_area, sm = E.small_eia_urban, se = E.strategic_eia;
  const smV = sm ? (green ? (sm['녹지지역_값'] || sm['값']) : sm['값']) : 0;
  return `<h3>관련 평가 대상 (개략)</h3>
  <p class="hint">구역 면적 ${fmt(a.area)}㎡ 기준의 1차 판정입니다. 기준값은 교통성·환경성 검토서 도구와 같은 표(shared/criteria)를 씁니다. 실제 대상 여부는 사업계획 면적·조례·협의로 확정합니다.</p>
  <div class="tscroll"><table class="gi-tbl"><thead><tr><th>평가</th><th>판정</th><th>내용</th><th>근거</th></tr></thead><tbody>
  ${row('교통영향평가', tia, tia && a.area >= tia['값'], tia ? `정비사업 부지면적 ${fmt(tia['값'])}㎡ 이상 → 이 안 ${fmt(a.area)}㎡${tia['제출시기'] ? `. 제출: ${esc(tia['제출시기'])}` : ''}` : '', '../traffic/')}
  ${row('환경영향평가', eia, eia && a.area >= eia['값'], eia ? `도시정비사업 ${fmt(eia['값'])}㎡ 이상 → 이 안 ${fmt(a.area)}㎡` : '', '../env/')}
  ${row('소규모 환경영향평가', sm, sm && a.area >= smV && !(eia && a.area >= eia['값']), sm ? `도시지역 ${fmt(sm['값'])}㎡ 이상(녹지지역 ${fmt(sm['녹지지역_값'] || 0)}㎡) — 환경영향평가 대상이면 제외${green ? '. 구역에 녹지지역이 있어 녹지 기준 적용' : ''}${sm['협의시기'] ? `. 협의: ${esc(sm['협의시기'])}` : ''}` : '', '../env/')}
  ${row('전략환경영향평가', se, se && se['값'] != null && a.area >= se['값'], se && se['값'] != null ? `정비구역 지정 — 환경영향평가 대상 규모(${fmt(se['값'])}㎡) 이상일 때만 → 이 안 ${fmt(a.area)}㎡${se['협의시기'] ? `. 협의: ${esc(se['협의시기'])}` : ''}` : '정비계획이 별표 2 대상인지 원문 확인 전', '../env/')}
  </tbody></table></div>`;
}
function renderReq(a) {
  const j = judge(a, P.type);
  const item = o => `<div class="chk ${o.req ? 'req' : ''}"><span class="pill ${PILL[o.st][0]}">${PILL[o.st][1]}</span><div><div class="t">${o.t}</div><div class="s">${o.basis || ''}${o.s ? ' · ' + o.s : ''}</div></div><div class="num">${o.v}</div></div>`;
  const list = j.items.map(o => o.group ? `<div class="chk"><span class="pill ${PILL[o.st][0]}">${PILL[o.st][1]}</span><div style="grid-column:2/4"><div class="t">${o.t}</div><div class="checks" style="margin-top:6px">${o.items.map(item).join('')}</div></div></div>` : item(o)).join('');
  const keys = D.keys.filter(k => analyze(k));
  const cmp = keys.map(k => { const x = analyze(k), jj = judge(x, P.type); return `<tr class="${k === S.region ? 'hl' : ''}"><td>${esc(D.regions[k].name)}</td><td class="r">${fmt(x.area)}</td><td class="r">${oldText(x)}</td><td class="r">${pct(x.oldFaRatio)}</td><td class="r">${pct(x.smallRatio)}</td><td class="r">${accText(x)}</td><td class="r">${x.density.toFixed(1)}</td><td>${jj.pass === true ? '<span class="pill ok">입안 가능</span>' : jj.pass === false ? '<span class="pill bad">요건 미달</span>' : '<span class="pill warn">확인 필요</span>'}</td></tr>`; }).join('');
  const temp = JOB.active && JOB.zone === S.region;
  const vtxt = temp ? '자료를 채우는 중이라 아래 판정은 임시입니다 — 끝나면 확정됩니다' : j.pass === true ? '인천 정비조례 제5조 요건을 충족합니다' : j.pass === false ? '요건을 충족하지 못합니다 — 아래 미충족 항목을 보세요' : '확인이 필요한 항목이 있어 판정을 끝내지 못했습니다';
  side.innerHTML = `<h2>${regName()} 입안대상지역 요건판정</h2>
  <div class="field" style="max-width:260px;margin-bottom:10px"><label for="ptype">사업 유형</label><select id="ptype"><option value="redev">재개발사업</option><option value="improve">주거환경개선사업</option></select></div>
  <div class="verdict ${temp ? 'warn' : j.pass === true ? 'ok' : j.pass === false ? 'bad' : 'warn'}">${vtxt}</div>
  <div class="checks">${list}</div>
  <h3>구역 확장 한도 (영 별표1 제5호, 정비조례 제5조③)</h3>
  <p style="margin:0">도시계획위원회 심의로 입안대상지역 면적의 ${Math.round(RULES.expansion * 100)}%까지 확장할 수 있습니다. 이 안 기준 상한은 <b style="font-family:var(--f-mono)">${fmt(a.area * RULES.expansion)}㎡</b> (추가 ${fmt(a.area * (RULES.expansion - 1))}㎡)입니다.</p>
  <h3>구역계 안별 비교</h3>
  <div class="tscroll"><table><thead><tr><th>안</th><th class="r">면적㎡</th><th class="r">노후(동)</th><th class="r">노후(연면적)</th><th class="r">과소필지</th><th class="r">접도율</th><th class="r">호수밀도</th><th>판정</th></tr></thead><tbody>${cmp}</tbody></table></div>
  <p class="note">정비구역 지정은 조례 요건 외에 2030 정비기본계획(구역 경계설정 기준 등)도 따릅니다(제5조④). 기본계획 변경 고시문 대조 전입니다.</p>
  ${evalSection(a)}`;
  const sel = document.getElementById('ptype'); sel.value = P.type; sel.onchange = () => { P.type = sel.value; saveP(); render(); };
}
// 공통 가정값(shared/feas.js) 입력칸 — 사업성 검토 첫 화면과 같은 값
const feasField = (k, unit, attrs = 'step="any"') => `<div class="field"><label for="feas_${k}">${JbsFeas.LABEL[k] || k}</label><input id="feas_${k}" data-feas="${k}" type="number" value="${JbsFeas.get()[k] ?? ''}" ${attrs}><span class="u">${unit}</span></div>`;
const field = (id, label, val, unit, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}" ${attrs}><span class="u">${unit}</span></div>`;
function bindNum(ids) { ids.forEach(id => { const e = document.getElementById(id); if (!e) return; e.addEventListener('change', () => { const v = parseFloat(e.value); if (!isNaN(v)) { P[id] = v; saveP(); render(); } }); }); }
// 토지이용계획표의 정비기반시설·종교용지 행
//  정비기반시설 계 = 도로 + 공원 + 녹지 + 그 밖의 정비기반시설(공용주차장·공공공지·광장 등) — 도정법 제2조제4호·영 제3조
//  학교용지·공공청사·종교용지는 정비기반시설이 아니라 따로 줄을 둠(무상귀속 대상 아님)
//  도로 = 계 − 공원 − 녹지 − 그 밖의 정비기반시설 → 경계 도로 확폭·직접 지정한 도로·존치하는 기존 도로를 모두 담아 하위 합이 계와 같게 함
// 본 화면(사업성)이 '정비계획(/urban) 계획값'으로 대지면적을 잡을 수 있게 계획값을 저장
function saveUrbanOut(a, pl) {
  const inf = pl.infra; if (!inf || !a.area) return;
  const other = inf.schoolArea + (inf.pubB || 0) + (inf.relArea || 0), infraA = inf.total - other;
  // /arch(개략 건축계획)가 건축 불가 영역으로 쓰도록 기반시설 도형 저장: 도로(확폭·지정·존치), 공원·녹지, 학교용지, 종교용지(존치·대체), 공동주택 획지
  try {
    const r7 = g => g && g.geometry ? { type: g.geometry.type, coordinates: JSON.parse(JSON.stringify(g.geometry.coordinates, (k, v) => typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v)) } : null;
    const keep = (P.keepInnerRoads && inf.inner) ? inf.inner.filter(q => q.geom).map(q => r7({ geometry: q.geom })) : [];
    const all = JSON.parse(localStorage.getItem('jbs-urban-infra-v1') || '{}');
    all[a.key] = { at: new Date().toLocaleString('sv-SE').slice(0, 16), road: r7(inf.roadGeom), park: r7(inf.parkGeom), school: r7(inf.schoolGeom), rel: r7(inf.relGeom), green: inf.drawing ? r7(inf.drawing.green) : null, other: inf.drawing ? r7(inf.drawing.other) : null, pub: inf.drawing ? r7(inf.drawing.pub) : null, fromDrawing: inf.drawing ? inf.drawing.name : null, relKeep: !inf.relC, keepRoads: keep, lots: (inf.lots || []).map(l => ({ no: l.no, area: Math.round(l.area), geom: r7(l.geom) })) };
    localStorage.setItem('jbs-urban-infra-v1', JSON.stringify(all));
  } catch (e) { /* 무시 */ }
  try { localStorage.setItem('jbs-urban-out', JSON.stringify({ title: Z.title || '', region: a.key, at: new Date().toLocaleString('sv-SE').slice(0, 16), area: a.area, infra: infraA, other, site: pl.site, units: pl.units, short: inf.short, keepArea: inf.keepArea })); } catch (e) { /* 무시 */ }
}
function luRows(a, pl) {
  const inf = pl.infra, A = a.area || 1, pc = v => (v / A * 100).toFixed(1) + '%';
  const tr = (t, v, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${t}</td><td class="r">${fmt(v)}</td><td class="r">${pc(v)}</td></tr>`;
  if (!inf) return tr('정비기반시설 계', A * pl.infraPct / 100);
  const infraA = inf.total - (inf.relArea || 0) - inf.schoolArea - (inf.pubB || 0);
  const roadT = Math.max(0, infraA - inf.parkArea - (inf.green || 0) - inf.other);
  const manual = inf.items.filter(it => it.kind === 'manual').reduce((t, it) => t + it.area, 0), widen = inf.roadArea - manual;
  const kept = P.keepInnerRoads ? inf.innerFull : 0;
  const parts = inf.drawing ? [`정비기반시설도(${esc(inf.drawing.name)}) 도로 ${fmt(inf.roadArea)}`] : [widen > 0.5 ? `경계 도로 확폭 ${fmt(widen)}` : '', manual > 0.5 ? `직접 지정 ${fmt(manual)}` : '', kept > 0.5 ? `기존 도로 존치 ${fmt(kept)}` : ''].filter(Boolean);
  const notInfra = '<br><span class="u">정비기반시설 아님(무상귀속 대상 아님) — 공동주택 획지에서 뺌</span>';
  let h = (inf.schoolArea ? tr('학교용지' + notInfra, inf.schoolArea) : '')
    + ((inf.pubB || 0) ? tr('공공청사 등' + notInfra, inf.pubB) : '')
    + (inf.relArea ? tr('종교용지(존치·대체)' + notInfra, inf.relArea) : '')
    + tr(inf.drawing ? '정비기반시설 계 (정비기반시설도)' : '정비기반시설 계 (제안)', infraA)
    + tr(`&nbsp;└ 도로(신설·존치)<br><span class="u">${parts.join(' · ') || '도로로 잡은 면적 없음'}</span>`, roadT)
    + tr('&nbsp;└ 공원', inf.parkArea)
    + tr('&nbsp;└ 녹지<br><span class="u">완충·경관·연결녹지 등 — 아래 \'녹지 면적\'에 입력</span>', inf.green || 0)
    + (inf.other ? tr('&nbsp;└ 그 밖의 정비기반시설<br><span class="u">공용주차장·공공공지·광장 등</span>', inf.other) : '');
  // 확보 목표와 맞춰 보기: 모자라면 그만큼은 구역 안 도로로 더 잡아야 하므로 참고 줄로 보여 줌(면적 계산에는 넣지 않음)
  if (inf.short > 1) {
    const inf2 = infraA + inf.short, site2 = Math.max(0, pl.site - inf.short);
    h += `<tr class="note-row"><td colspan="3" class="wrap"><b class="warn">확보 목표 ${fmt(inf.keepArea)}㎡보다 신설 ${fmt(inf.newArea)}㎡가 ${fmt(inf.short)}㎡ 모자람</b> — 이만큼은 구역 안 도로(✂ 구역계 자르기로 '도로로 지정')나 경계 도로 넓히기로 더 잡아야 합니다. 부족분까지 도로로 잡으면 정비기반시설 ${fmt(inf2)}㎡(${pc(inf2)}) · 도로 ${fmt(roadT + inf.short)}㎡ · 공동주택 획지 ${fmt(site2)}㎡(${pc(site2)})가 됩니다.</td></tr>`;
  }
  return h;
}
// 용도지역 상향 입지요건(2030 기본계획 변경 고시 제2026-96호 [기준2]) — 계획 용도지역이 현황보다 높을 때 경계 도로 폭(개발 후)으로 1차 확인
function zoneUpCheck(a, pl) {
  const Zu = RULES.zoneUp; if (!Zu) return '';
  const rank = z => /준주거/.test(z) ? 4 : /제3종/.test(z) ? 3 : /제2종/.test(z) ? 2 : /제1종/.test(z) ? 1 : 0;
  const cur = Object.entries(a.zoneArea || {}).sort((x, y) => y[1] - x[1]).map(([z]) => z)[0] || '';
  if (!(rank(P.zone) > rank(cur) && rank(cur) > 0)) return '';
  const need = (Zu.min_road_m || {})[P.zone], inf = pl.infra, z = Z.zones[a.key] || {};
  const ws = ((z.roads && z.roads.edge) || []).map(r => ({ j: r.jibun, w: Math.max(r.w, num(((inf && inf.entry && inf.entry.per) || {})[r.pnu] && inf.entry.per[r.pnu].pw)) }));
  const best = ws.sort((x, y) => y.w - x.w)[0];
  const ok = need && best && best.w >= need;
  const pc = (Zu.public_contribution || {})[`${cur.replace('일반주거지역', '')}→${P.zone.replace('일반주거지역', '')}`];
  return `<div class="field" style="grid-column:1/-1"><span class="u"><b>용도지역 상향 입지요건</b>(${esc(cur)} → ${esc(P.zone)}): ${esc(Zu[P.zone] || '')}. ${need ? `경계 도로 계획 폭 최대 ${best ? `${esc(best.j)} ${fmt(best.w, 1)}m` : '–'} → ${ok ? `<b class="good">${need}m 이상 충족</b>` : `<b class="warn">${need}m 이상 도로 없음</b>`}` : ''}. 연접 용도지역은 지도로 직접 확인하세요.${pc ? ` 공공기여 ${Math.round(pc * 100)}% 이상(법정의무시설·부가차로 포함).` : ''}</span></div>`;
}
// 교통성 검토서 결과(site.constraints.traffic.확폭_검토_도로 [{도로:'○○ 도로', 현재_m, 필요_m}]) → 경계 도로 계획 폭에 한 번에 적용
//  도로 이름은 site-store가 '(지번) 도로'로 만든 것 → z.roads.edge의 jibun으로 찾아 edgeOpt[pnu].pw
function trafficWidenInfo() {
  if (!window.JbsSite) return null;
  const site = JbsSite.list().find(x => x.source === 'urban:' + S.region), tr = site && site.constraints && site.constraints.traffic;
  if (!tr) return null;
  const z = Z.zones[S.region], edges = (z && z.roads && z.roads.edge) || [];
  const rows = (tr.확폭_검토_도로 || []).map(r => { const jb = String(r.도로 || '').replace(/\s*도로$/, '').trim(); const e = edges.find(x => String(x.jibun) === jb); return { name: r.도로, now: r.현재_m, need: r.필요_m, pnu: e && e.pnu }; });
  return { at: tr.at || site.updated || '', rows, entry: tr.진입_가능_도로 || [] };
}
function trafficWidenBox() {
  const t = trafficWidenInfo(); if (!t) return '';
  if (!t.rows.length) return `<p class="note" style="background:#f3f8f3;border:1px solid #cfe3cf;border-radius:6px;padding:6px 8px">교통성 검토서(${esc(t.at)}): 확폭이 필요한 진입도로 없음${t.entry.length ? ` · 진입 가능 도로 ${esc(t.entry.join(', '))}` : ''}.</p>`;
  const inf = (Z.zones[S.region] || {}).infra || {}, eo = inf.edgeOpt || {};
  const applied = t.rows.every(r => r.pnu && eo[r.pnu] && num(eo[r.pnu].pw) >= num(r.need));
  return `<div style="background:#fff7e6;border:1px solid #f0c36d;border-radius:6px;padding:8px 10px;margin:6px 0">
    <b>교통성 검토서 결과(${esc(t.at)})</b> — 확폭 검토 도로: ${t.rows.map(r => `${esc(r.name)} 현재 ${r.now}m → 필요 ${r.need}m${r.pnu ? '' : ' <span class="warn">(경계 도로 목록에서 못 찾음)</span>'}`).join(' · ')}
    <div style="margin-top:6px"><button type="button" class="btn sm" data-trwiden="1" ${applied ? 'disabled' : ''}>${applied ? '적용됨 — 계획 폭에 반영되어 있습니다' : '추천 폭 적용(이 도로들 계획 폭을 필요 폭으로)'}</button> <span class="u">적용 뒤 아래 표에서 도로별로 다시 고칠 수 있습니다. /arch는 [정비계획 기반시설 불러오기]로 새 획지를 받습니다.</span></div></div>`;
}
function renderPlan(a) {
  const pl = plan(a), far = pl.far;
  saveUrbanOut(a, pl);
  const pressBadge = RULES.status.far === 'press' ? '<span class="badge p">고시문 대조 필요</span>' : '<span class="badge v">원문 대조</span>';
  const inf = pl.infra, prop = !!inf;
  const ip = pl.infraPct;
  side.innerHTML = `<h2>${regName()} 정비계획 (토지이용·밀도)</h2>
  ${D.map ? infraSection(a, pl) : ''}
  <div class="form">
    <div class="field"><label for="zone">용도지역(계획)</label><select id="zone">${Object.keys(RULES.far).map(k => `<option>${k}</option>`).join('')}</select><span class="u">현황: ${Object.entries(a.zoneArea).map(([z, v]) => esc(z.replace('일반주거지역', '')) + ' ' + fmt(v) + '㎡').join(', ')}</span>${Object.keys(a.zoneTouch || {}).length ? ` <span class="note">(경계에 ${Object.entries(a.zoneTouch).map(([z, n]) => esc(z) + ' ' + n + '필지').join(', ')} 일부 걸침 — 토지특성 용도지역2)</span>` : ''}${industrialNote(a)}</div>
    ${prop ? '' : field('infraRatio', '정비기반시설 비율(도로·공원·학교 등)', P.infraRatio, D.map ? '구역 면적 대비 % · 직접 입력' : '구역 면적 대비 %, 예시 가정', 'min=0 max=60 step=1')}
    <div class="field"><label for="farMode">적용 용적률</label><select id="farMode"><option value="base">기준용적률 ${far.base}%</option><option value="allowed">허용용적률 ${far.allowed}%</option><option value="max">상한용적률 ${far.max}%</option>${pl.farCalc ? `<option value="calc">산식(공공시설 제공) ${pl.farCalc.v}%</option>` : ''}<option value="custom">직접 입력</option></select><span class="u">2030 기본계획 · ${pressBadge}</span></div>
    ${P.farMode === 'custom' ? field('farCustom', '계획 용적률', P.farCustom, `% (상한 ${far.max}% 이내로 제한)`) : ''}
    ${zoneUpCheck(a, pl)}
  </div>
  <h3>토지이용계획표 (개략)</h3>
  <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">면적㎡</th><th class="r">비율</th></tr></thead><tbody>
    <tr><td>정비구역</td><td class="r">${fmt(a.area)}</td><td class="r">100.0%</td></tr>
    <tr><td>공동주택 획지(대지)</td><td class="r">${fmt(pl.site)}</td><td class="r">${(pl.site / a.area * 100).toFixed(1)}%</td></tr>
    ${luRows(a, pl)}
  </tbody></table></div>
  <h3>건축물 밀도계획</h3>
  <div class="kpis">
    ${kpi('계획 용적률', pl.farUse + '%', `${P.zone.replace('일반주거지역', '')} · 기준 ${far.base} / 허용 ${far.allowed} / 상한 ${far.max}`)}
    ${kpi('지상 연면적(용적률 산정)', fmt(pl.gfa) + '㎡', `획지 ${fmt(pl.site)}㎡ × ${pl.farUse}%`)}
    ${kpi('국민주택규모 의무(참고)', '증가분의 ' + RULES.natHousing.redevelopment * 100 + '%', '법적상한까지 완화 시 · 정비조례 제27조')}
  </div>
  ${pl.farCalc ? (() => { const c = pl.farCalc, f2 = RULES.far[P.zone]; return `<p class="note"><b>상한용적률 산식</b>(2030 기본계획 변경 고시 제2026-96호): 허용 ${f2.allowed}% + [1.5 × 공공시설 제공 ${fmt(c.pa)}㎡${c.pb ? ` + 1.0 × 학교·공공청사 부지 ${fmt(c.pb)}㎡` : ''} ÷ 획지 ${fmt(c.site)}㎡ × 기준 ${f2.base}%] = <b>${c.raw.toFixed(1)}%</b>${c.capped ? ` → 상한 ${f2.max}%로 제한` : ''}. 공공시설 제공 면적 = 새로 설치하는 공공시설 ${fmt(c.newPub)}㎡ − 용도폐지되는 설치된 기존 공공시설 ${fmt(c.fac)}㎡(사용 중 면적). 존치 시설과 미집행 결정선은 빼지 않습니다(기본계획 원문은 '기정 도시계획시설 차감' — 인천시 산정 사례로 확인 필요). ${c.pa < 1 ? '<b class="warn">새 공공시설이 용도폐지되는 기존 시설보다 작아 산식 인센티브가 없음</b>' : ''}${!c.capped ? (() => { const needPa = Math.max(0, (f2.max - f2.allowed) / (1.5 * f2.base) * c.site - (c.pb / 1.5)); return ` 상한 ${f2.max}%까지 받으려면 공공시설 제공 약 ${fmt(needPa)}㎡(새 공공시설 약 ${fmt(needPa + c.fac)}㎡, 지금보다 ${fmt(Math.max(0, needPa + c.fac - c.newPub))}㎡ 더) 필요 — 획지가 줄어드는 만큼은 반영 안 한 개략값.`; })() : ''} 허용용적률 인센티브(9개 항목, 최대 20%·지역업체 참여 시 40%)를 다 받는다고 가정한 값입니다.</p>`; })() : ''}
  ${D.map ? todoSection(a, pl) : ''}
  <p class="note">허용용적률은 인센티브 항목을, 상한용적률은 공공시설 부지 제공 등 공공기여를 전제로 합니다. 이 화면은 인센티브 배점과 공공기여 산식을 아직 계산하지 않고 단계만 고릅니다.</p>`;
  const z = document.getElementById('zone');
  z.value = P.zone; z.onchange = () => { setPlanZone(a, z.value); render(); };
  const f = document.getElementById('farMode'); f.value = P.farMode; f.onchange = () => { P.farMode = f.value; saveP(); render(); };
  bindNum(['infraRatio', 'farCustom', 'sideRoadW', 'schoolArea', 'otherInfra', 'greenInfra', 'pubBldg', 'valMult', 'roadWork', 'parkWork']);
  bindInfra(a);
}
function sideWOf() { return num(P.sideRoadW) || 8; }
// 기존 정비기반시설(국공유) 판단표 — 담당자·정비업체가 근거를 보고 넣기/빼기로 확정
// 진입도로(가정) — 경계 도로별 역할·일방통행·건너편 녹지, 제25조 ①(진입도로 1개)과 ③(2개 폭 합) 비교
// 면적 부족분 채우기 안내 — 경계 도로 확폭은 기능(진입도로 제25조·도시계획도로 결정·교통성 검토)으로만 정하므로 여기서 쓰지 않음
//  순서: ① 공원·녹지 늘리기(법정·제안 기준 이상) ② 공공공지 ③ 구역 안 도로(✂ 남기기/신설). 자동 적용은 공원 면적만
function fillGuide(inf, need) {
  if (!(need > 1)) return '';
  const to = Math.ceil(((inf.parkNeed || 0) + need) / 10) * 10;
  return `<ol style="margin:2px 0 0 18px"><li>공원·녹지 면적 늘리기 — 지금 ${fmt(inf.parkNeed || 0)}㎡ → ${fmt(to)}㎡ <button type="button" class="btn ghost sm" data-parkto="${to}">공원 면적 ${fmt(to)}㎡로</button></li>
    <li>공공공지 — 아래 '그 밖의 정비기반시설 면적'에 넣기</li><li>구역 안 도로 — 지도에서 ✂로 구역 안 도로를 남기거나 새로 지정</li></ol>`;
}
const FILL_NOTE = '도로 확폭은 기능(진입도로 기준·도시계획도로 결정·교통성 검토)으로만 정하므로 부족분 채우기에는 쓰지 않습니다. 공원·공공공지·구역 안 도로로 채우세요.';
// 면적 목표(확보 목표 부족분·상한용적률 도달)별로 모자라는 면적과 채우는 방법 안내
function shortGuide(inf, pl) {
  const goals = [];
  if (inf.short > 1) goals.push(['확보 목표(면적) 부족분', inf.short]);
  const c = pl.farCalc, f2 = RULES.far[P.zone];
  if (c && !c.capped && f2) { const needPa = Math.max(0, (f2.max - f2.allowed) / (1.5 * f2.base) * c.site - c.pb / 1.5), more = needPa + c.fac - c.newPub; if (more > 1) goals.push([`상한용적률 ${f2.max}% 도달(지금 산식 ${c.v}%)`, more]); }
  if (!goals.length) return '';
  return `<div style="margin-top:8px"><b>면적 목표별 모자라는 면적</b><ul style="margin:4px 0 0 18px">${goals.map(([t, need]) => `<li><b>${t}</b> ${fmt(need)}㎡${fillGuide(inf, need)}</li>`).join('')}</ul>
    <p class="u" style="margin:4px 0 0">${FILL_NOTE} 획지가 줄어드는 만큼 산식이 조금 달라지니 채운 뒤 다시 확인하세요.</p></div>`;
}
function entrySection(inf, pl) {
  const e = inf.entry; if (!e || !inf.roadsReady) return '';
  const z = Z.zones[S.region] || {}, edge = (z.roads && z.roads.edge || []).slice().sort((x, y) => y.w - x.w), eo = e.opt || {};
  if (z.roads && !z.roads.edgeDecOk) setTimeout(() => INFRA.fetchEdgeDec(S.region), 0);
  const role = r => (e.e1 && r.pnu === e.e1.pnu) ? '<b>진입도로</b>' : (e.mode === 3 && e.e2 && r.pnu === e.e2.pnu) ? '<b>두 번째 진입도로</b>' : '주변 도로';
  const wide = edge.filter(r => r.w >= 20 && !(eo[r.pnu] || {}).green);
  // 도로별 고를 폭: 현황 유지 · 추천 · 같은 대분류(소로/중로/대로) 안의 표준 폭 · 다음 등급 하나 — 각각 늘어나는 도로 면적을 같이 보여 줌
  const opts = r => {
    const p = e.per[r.pnu] || {}, big = ROADCLS.big(ROADCLS.of(r.w));
    const ws = new Set([p.rec]);
    ROADCLS.std.filter(w => w > r.w + 0.2).forEach((w, i) => { if (ROADCLS.big(ROADCLS.of(w)) === big || i === 0) ws.add(w); });
    if (p.manual) ws.add(p.pw);
    const list = [...ws].filter(w => w > r.w + 0.2).sort((x, y) => x - y);
    const cur = p.keep ? 'keep' : p.manual ? String(p.pw) : 'auto';
    const lab = w => `${w}m ${ROADCLS.of(w)} · +${fmt(INFRA.widenArea(r, z, w))}㎡`;
    return `<select data-edgesel="${esc(r.pnu)}" aria-label="${esc(r.jibun)} 계획 폭" style="max-width:230px">
      <option value="auto" ${cur === 'auto' ? 'selected' : ''}>추천 ${p.rec > r.w + 0.2 ? lab(p.rec) : '현황 유지(확폭 필요 없음)'}</option>
      <option value="keep" ${cur === 'keep' ? 'selected' : ''}>현황 유지 ${r.w}m · 0㎡</option>
      ${list.map(w => `<option value="${w}" ${cur === String(w) ? 'selected' : ''}>${lab(w)}</option>`).join('')}
      <option value="custom">직접 입력…</option></select>`;
  };
  const why = r => {
    const p = e.per[r.pnu] || {}, o = eo[r.pnu] || {}, isE1 = e.e1 && r.pnu === e.e1.pnu && e.mode === 1;
    const rs = [], fr = p.front || INFRA.widenArea(r, z, r.w + 1);
    const isEntry = (e.e1 && r.pnu === e.e1.pnu) || (e.mode === 3 && e.e2 && r.pnu === e.e2.pnu);
    if (isE1 && e.W > r.w) rs.push(`진입도로 제25조 ${e.W}m`);
    if (e.e1 && r.pnu === e.e1.pnu && fr < 10) rs.push(`<b class="warn">구역에 닿은 길이 약 ${fmt(fr)}m — 모퉁이만 닿아 진입도로로 쓰기 어려움, 다른 도로를 고르세요</b>`);
    else if (isEntry && fr < 30) rs.push(`<b class="warn">구역에 닿은 길이 약 ${fmt(fr)}m — 짧게 닿음, 진입도로로 적정한지 확인하세요</b>`);
    // 짧게 닿은 도로(부분 확폭이 되는 도로): 자동으로는 현황 유지, 직접 넓히면 병목 경고
    if (p.partial && !isEntry) {
      const how = `구역에 닿은 구간 약 ${fmt(fr)}m${p.len ? `(도로 필지 길이 약 ${fmt(p.len)}m)` : ''}`;
      if (p.manual && p.pw > r.w + 0.2) return `<b class="warn">부분 확폭(병목) — ${how}뿐이라 연속 확폭이 아님. 도로 전체 확폭은 도시계획도로 결정으로 따로 검토</b>`;
      return `${how} — 짧게 닿아 넓히면 병목이 되므로 현황 유지${p.dec ? ` · 도시계획도로 ${esc(p.dec)} 결정 — 도로 전체 확폭은 결정 사항으로 따로 검토` : ''}`;
    }
    if (p.dec) rs.push(`도시계획도로 ${esc(p.dec)} 결정(하한 ${ROADCLS.lower(p.dec)}m)`);
    if (o.oneway && r.w < 10) rs.push('일방통행 → 양방향 10m');
    if (e.sideW > r.w) rs.push(`최소 폭 ${e.sideW}m`);
    return rs.length ? rs.join(' · ') : `현황 ${ROADCLS.of(r.w)} — 같은 등급 안이라 확폭 필요 없음`;
  };
  return `<details class="gi" open><summary><b>경계 도로·진입도로 (가정 — 교통 검토 후 확정)</b> — ${e.mode === 3 ? `제25조③ 2개 진입도로 ${esc(e.e1.jibun)}(${e.e1.w}m) + ${esc(e.e2.jibun)}(${e.e2.w}m)` : `제25조① ${e.e1 ? `${esc(e.e1.jibun)}(현황 약 ${e.e1.w}m) → ${e.W}m 이상` : '경계 도로 없음'}`} · 경계 도로 확폭 ${fmt(inf.roadArea)}㎡</summary>
    <p class="hint">구역 경계 도로는 구역 쪽으로 넓혀 기부채납합니다. 도로마다 <b>추천 폭</b>은 기능상 필요한 폭만 채운 값입니다(진입도로 제25조·도시계획도로 결정 등급·일방통행·최소 폭 중 큰 값). <b>확폭은 면적 부족분 채우기에 쓰지 않습니다.</b> 구역에 30m 미만 또는 도로 필지 길이의 절반 미만만 닿은 도로는 넓히면 병목이 되므로 현황 유지로 추천합니다.</p>
    <p class="hint">${fmt(pl.units)}세대 기준 — ① 진입도로 1개: 폭 ${e.W}m 이상 · ③ 진입도로 2개: 각 4m 이상, 폭 합 ${e.W2}m 이상(4~6m 도로는 기간도로와 통행거리 200m 이내일 때만 — 자동으로는 6m 이상만 고름). 확폭 면적: ① ${fmt(e.A1)}㎡${e.A3 != null ? ` · ③ ${fmt(e.A3)}㎡` : ' · ③ 고를 두 번째 도로 없음'}.</p>
    ${trafficWidenBox()}
    <div class="seg" role="group" aria-label="진입도로 기준" style="margin:4px 0"><button type="button" data-entrymode="auto" aria-pressed="${e.em === 'auto'}">자동(확폭 적은 쪽)</button><button type="button" data-entrymode="1" aria-pressed="${e.em === '1'}">① 진입도로 1개</button><button type="button" data-entrymode="3" aria-pressed="${e.em === '3'}" ${e.e2 ? '' : 'disabled'}>③ 진입도로 2개</button></div>
    <div class="tscroll"><table class="gi-tbl"><thead><tr><th>지번</th><th class="r">현황 폭(m)</th><th>등급(현황)</th><th>역할</th><th>계획 폭</th><th>추천 근거</th><th class="r">확폭㎡</th><th class="r" title="계획 폭을 1m 더 넓힐 때 새로 도로가 되는 면적 ≈ 구역에 닿은 길이(m)">+1m당㎡<br><span class="u">≈닿은 길이</span></th><th>진입도로로</th><th>일방통행</th><th>건너편 녹지</th></tr></thead><tbody>
    ${edge.map(r => `<tr><td><button type="button" class="linkbtn" data-edgefocus="${esc(r.pnu)}">${esc(r.jibun)}</button></td><td class="r">${r.w}</td><td>${ROADCLS.of(r.w)}${(e.per[r.pnu] || {}).dec ? `<br><span class="u">결정 ${esc(e.per[r.pnu].dec)}</span>` : ''}</td><td>${role(r)}</td>
      <td>${opts(r)}</td><td class="wrap u">${why(r)}</td>
      <td class="r">${fmt((e.per[r.pnu] || {}).area || 0)}</td><td class="r">${fmt((e.per[r.pnu] || {}).perM || 0)}</td>
      <td><input type="radio" name="entryPick" data-entrypick="${esc(r.pnu)}" ${e.e1 && r.pnu === e.e1.pnu ? 'checked' : ''} aria-label="${esc(r.jibun)} 진입도로로"></td>
      <td><input type="checkbox" data-edgeopt="oneway" data-pnu="${esc(r.pnu)}" ${(eo[r.pnu] || {}).oneway ? 'checked' : ''} aria-label="${esc(r.jibun)} 일방통행"></td>
      <td><input type="checkbox" data-edgeopt="green" data-pnu="${esc(r.pnu)}" ${(eo[r.pnu] || {}).green ? 'checked' : ''} aria-label="${esc(r.jibun)} 건너편 녹지"></td></tr>`).join('')}
    </tbody></table></div>
    ${e.picked ? '<button type="button" class="btn ghost sm" id="entryAuto">진입도로 자동으로 되돌리기</button>' : ''}
    ${shortGuide(inf, pl)}
    <p class="u" style="margin:4px 0 0">현황 폭은 필지 모양으로 추정한 값입니다. 진입도로 자동 선택은 구역에 10m 이상 닿은 도로만 봅니다(모퉁이만 스치는 도로 제외). 진입도로는 제25조 폭 아래로 고를 수 없습니다(골라도 제25조 폭으로 계산). 일방통행 도로는 진입도로 후보에서 뺍니다. 건너편 녹지가 있는 쪽은 구역 안에 완충녹지를 따로 두지 않아도 되는 것으로 봅니다.${z.roads && !z.roads.edgeDecOk ? ' 도시계획도로 결정 여부를 확인하는 중…' : ''}${wide.length ? ` <b class="warn">폭 20m 이상 경계 도로(${wide.map(r => esc(r.jibun)).join(', ')})에 닿아 있음 — 소음·완충녹지 필요 여부를 검토하세요(건너편 녹지가 있으면 체크).</b>` : ''}</p>
  </details>`;
}
// 무상양도 금액 비교(개략): 용도폐지 시설 평가액 vs 신설 정비기반시설 설치비용(부지가액 + 공사비)
function moneyBox(inf) {
  const m = inf.money; if (!m) return '';
  const won = v => fmt(Math.round(v / 1e6)) + '백만원';
  const hasWork = num(P.roadWork) > 0 || num(P.parkWork) > 0;
  const ok = m.newCost >= m.oldVal - 1;
  const unk = (inf.giAll || []).filter(x => x.pub && x.include && !x.reply).length;
  return `<div style="margin-top:4px"><b>무상양도 금액 비교(개략 — 확정은 사업시행계획인가 때 감정평가 후)</b> — 용도폐지 시설 ${won(m.oldVal)}(사용 중 면적 × 공시지가 평균 ${fmt(m.pubPrice)}원/㎡ × ${m.vmul}) vs 신설 설치비용 ${won(m.newCost)}(부지 ${won(m.newLand)} = 신설 면적 × 사유지 공시지가 평균 ${fmt(m.privPrice)}원/㎡ × ${m.vmul}${hasWork ? ` + 공사비 ${won(m.newWork)}` : ' + 공사비 <b>단가 미입력</b>'}) → ${ok ? '<b class="good">설치비용이 커서 용도폐지 시설 전부 무상양도 가능(개략)</b>' : `<b class="warn">설치비용이 ${won(m.oldVal - m.newCost)} 모자람 — 모자라는 만큼은 유상 매입</b>`}
    <div class="u">감정평가 배율 ${m.vmul}·공사비 단가는 가정값입니다(아래 입력). 실제 무상양도 범위는 사업시행계획인가 때 용도폐지 시설 감정평가액과 신설 시설 설치비용을 비교해 정하고, 관리청 의견을 듣습니다(제97조②④). 무상양도는 <b>행정재산</b>만 대상이고 <b>일반재산은 빠집니다</b>(매수 대상, 대법원 2026다202915)${unk ? ` — 넣은 국공유 ${unk}필지는 행정재산·일반재산 회신 전이라, 일반재산이면 위 용도폐지 금액에서 빠지고 매수비로 넘어갑니다` : ''}.</div></div>`;
}
// 추후 할 일(지정 단계에서 결정하지 않고 남겨 두는 것)
function todoSection(a, pl) {
  const inf = pl.infra, z = Z.zones[a.key] || {}, items = [];
  const fac = (inf && inf.facList) || [];
  if (fac.length) items.push(`구역 안 도시계획시설 결정선 ${fac.length}건 ${fmt(fac.reduce((t, f) => t + (f.area || 0), 0))}㎡ — 정비계획 결정·사업시행계획인가 때 도시계획시설 변경(폐지·선형 조정) 검토. 미집행이면 실효(국토계획법 제48조, 결정 고시 후 20년) 시기도 확인`);
  if (inf && (inf.giAll || []).some(x => x.pub && x.grade !== '확실' && !x.reply)) items.push('국공유 필지 재산관리 부서 조회(행정재산·일반재산 구분, 점유·대부) — 일반재산은 무상양도 대상이 아님(대법원 2026. 9. 3. 선고 2026다202915). 판단표의 엑셀로 요청');
  if (inf && inf.money && inf.innerArea > 0 && !P.keepInnerRoads) items.push('무상양도 범위 확정 — 사업시행계획인가 때 용도폐지 시설(행정재산) 감정평가액과 신설 정비기반시설 설치비용 비교, 관리청 의견 청취(도정법 제97조②④). 일반재산·초과분은 매수');
  if (inf && inf.entry) items.push('진입도로·주출입구 위치 — 교통영향평가·경찰 협의 뒤 확정(지금은 가정)');
  if (inf && inf.money && !(num(P.roadWork) > 0)) items.push('정비기반시설 공사비 단가 — 설계·관리청 협의로 정해 무상양도 금액 비교에 넣기');
  if (!items.length) return '';
  return `<h3>추후 할 일</h3><ol class="todo">${items.map(t => `<li>${t}</li>`).join('')}</ol>`;
}
function giSection(inf) {
  const g = inf.giAll || [];
  if (!INFRA.ready(S.region)) return '<p class="hint">국공유 필지 소유구분·도시계획시설을 확인하는 중…</p>';
  const pubs = g.filter(x => x.pub), priv = g.filter(x => !x.pub);
  const chk = (b, t) => `<span class="ev ${b ? 'on' : ''}" title="${t}">${b ? '✓' : '·'} ${t}</span>`;
  const gradeCls = { '확실': 'ok', '확인 필요': 'bad', '가능성 높음': 'info', '아닐 가능성': '', '사유(참고)': '' };
  const inA = pubs.filter(x => x.include).reduce((t, x) => t + x.area, 0);
  const inUse = pubs.filter(x => x.include).reduce((t, x) => t + x.useA, 0), inOcc = inA - inUse;
  return `<details class="gi" ${pubs.some(x => x.grade !== '확실' && !x.dec) ? 'open' : ''}>
    <summary><b>기존 정비기반시설 판단</b> — 국공유 ${pubs.length}필지 중 ${pubs.filter(x => x.include).length}필지 ${fmt(inA)}㎡ 넣음${inOcc >= 1 ? ` (사용 중 도로 등 ${fmt(inUse)}㎡ / 건물 점유 ${fmt(inOcc)}㎡ — 점유분은 확보 목표·무상양도에서 뺌)` : ''}${pubs.filter(x => x.grade === '확인 필요' && !x.dec).length ? ` · <b class="warn">확인 필요 ${pubs.filter(x => x.grade === '확인 필요' && !x.dec).length}필지</b>(지목과 실제 쓰임이 다름)` : ''}${priv.length ? ` · 사유 도로 등 ${priv.length}필지(목표 제외, 참고)` : ''}</summary>
    <p class="hint">국가·지자체 소유이면서 실제 도로·구거·공원 등으로 쓰이는 땅만 확보 목표(무상양도 대상)에 넣습니다. 재산관리 부서 회신을 '회신' 칸에 넣으면 반영됩니다(지적 불부합 → 건물 점유를 빼지 않음, 일반재산 → 뺌). 근거를 보고 '판단'을 바꾸면 확보 목표가 바로 다시 계산됩니다. 지번을 누르면 지도에서 보여 줍니다(위성사진은 지도 오른쪽 위 층 단추).</p>
    <div class="tscroll"><table class="gi-tbl"><thead><tr><th>지번</th><th>지목</th><th>소유</th><th>토지이용상황</th><th>근거</th><th>건물·결정·취득</th><th>자동 판정</th><th>판단</th><th title="재산관리 부서 조회 회신">회신</th><th class="r">편입㎡</th><th class="r" title="필지 안쪽(가장자리 1.2m 뺌)을 건물이 덮은 넓이 — 확보 목표·무상양도에서 뺌">건물 점유㎡</th><th class="r">사용 중㎡</th></tr></thead><tbody>
    ${g.map(x => `<tr class="${x.include ? 'inc' : ''}">
      <td><button type="button" class="linkbtn" data-gifocus="${esc(x.p.pnu)}">${esc(x.p.jibun)}</button></td>
      <td>${esc(x.p.jimok)}</td><td>${esc(x.p.own || '확인 중')}${x.p.ownInst && x.p.ownInst !== '구분없음' ? `<br><span class="u">${esc(x.p.ownInst)}</span>` : ''}</td><td>${esc(x.p.landUse || '–')}</td>
      <td class="evs">${chk(x.jm, '공공 지목')}${chk(x.lu, '이용상황 도로등')}${chk(x.fc, '도시계획시설 안')}${chk(x.thin, `길쭉함(폭 약 ${x.w}m)`)}${x.bldOn ? '<span class="ev bad">✕ 건물 있음</span>' : chk(x.noBld, '건물 없음')}</td>
      <td class="u">${x.noBld ? '건물 없음' : `건물 ${x.nLedger + x.nGis}동${x.nGis ? `(대장 없음 ${x.nGis})` : ''}`}${x.cover > 0.05 ? `<br>건물 겹침 ${Math.round(x.cover * 100)}% <span title="필지 가장자리 1.2m(처마·지적 경계 어긋남)를 뺀 안쪽 기준">(안쪽 ${Math.round((x.coreC || 0) * 100)}%)</span>${x.bldOn ? ' <b class="warn">점유 의심</b>' : ' — 대부분 가장자리(처마·경계 어긋남)'}` : ''}<br>${x.facKind ? `결정: ${esc(x.facKind)}` : '도시계획시설 결정 없음'}<br>${x.p.chgDate ? `${esc(x.p.chgDate)} ${esc(x.p.chgCause || '')}` : ''}</td>
      <td><span class="pill ${gradeCls[x.grade]}">${x.grade}</span></td>
      <td>${x.pub ? `<select data-gidec="${esc(x.p.pnu)}" aria-label="${esc(x.p.jibun)} 판단"><option value="" ${!x.dec ? 'selected' : ''}>자동(${x.grade === '아닐 가능성' ? '뺌' : '넣음'})</option><option value="in" ${x.dec === 'in' ? 'selected' : ''}>넣기(무상양도 대상)</option><option value="out" ${x.dec === 'out' ? 'selected' : ''}>빼기</option></select>` : '<span class="u">사유 — 제외</span>'}</td>
      <td>${x.pub ? `<select data-gireply="${esc(x.p.pnu)}" aria-label="${esc(x.p.jibun)} 회신"><option value="">–</option>${[['use', '행정재산(공공용)'], ['occupy', '행정재산·점유(대부·무단)'], ['mismatch', '지적 불부합'], ['general', '일반재산(무상양도 제외)']].map(([v, t]) => `<option value="${v}" ${x.reply === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}</td>
      <td class="r">${fmt(x.area)}</td><td class="r">${x.occ >= 1 ? `<b class="warn">${fmt(x.occ)}</b>` : '–'}</td><td class="r">${fmt(x.useA)}</td></tr>`).join('') || '<tr><td colspan="12" class="u">구역 안 국공유·공공 지목 필지 없음</td></tr>'}
    </tbody></table></div>
    <button type="button" class="btn ghost sm" id="giCopy">표 복사(엑셀 붙여넣기용)</button>
    <button type="button" class="btn sm" id="giAsk" title="자동 판정이 '확인 필요·가능성 높음·아닐 가능성'인 국공유 필지를 재산관리 부서 조회 요청용 엑셀로 저장">재산관리 부서 조회 요청 목록(엑셀)</button>
  </details>`;
}
// 정비기반시설도(도면) — 이미 계획도가 있는 구역(구역지정·심의·사업시행인가 완료 구역 등)
//  CAD(DXF, 측량 좌표) 또는 GeoJSON을 올리면 레이어별로 종류(도로·공원·녹지 등)를 정해 그대로 계산하고, 자동 제안과 나란히 비교
//  z.infra.plan = { name, at, crs, feats:[{layer, geom}], kinds:{레이어: 종류} } — 작업 저장 파일에 함께 들어감, 서버로 보내지 않음
function drawingAuto(a) {
  // 같은 구역을 '제안값'으로 계산한 결과(비교용)
  const keep = P.infraMode; P.infraMode = 'proposal';
  let pl = null; try { pl = planRaw(a); } catch (er) { pl = null; } finally { P.infraMode = keep; }
  return pl;
}
function drawingSection(a, pl) {
  const z = Z.zones[a.key] || {}, dp = (z.infra || {}).plan, inf = pl.infra;
  const up = `<div class="row" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0"><button type="button" id="drwLoad">${dp ? '도면 다시 올리기' : '정비기반시설도 올리기 (DXF·GeoJSON)'}</button><button type="button" id="drwPdf" title="CAD에서 PDF로 내보낸 도면: 지도 왼쪽 '참고 도면 겹쳐 보기'로 올려 두 점으로 맞춘 뒤 누르면 PDF 안 폴리선을 가져옴">겹쳐 맞춘 PDF에서 가져오기</button>${dp ? '<button type="button" id="drwClear">도면 지우기</button>' : ''}</div>
    <input type="file" id="drwFile" accept=".dxf,.geojson,.json" hidden>
    <p class="hint">구역지정·심의·사업시행인가가 끝난 구역처럼 정비기반시설 계획도가 이미 있으면, CAD 도면(측량 좌표가 들어간 DXF, 닫힌 폴리선)을 올려 실제 계획 그대로 획지·세대수·사업성을 계산합니다. 자동 제안과 나란히 비교해 차이를 봅니다. CAD에서 내보낸 PDF(폴리선이 살아 있는 PDF)는 '참고 도면 겹쳐 보기'로 올려 두 점으로 맞춘 뒤 [겹쳐 맞춘 PDF에서 가져오기]를 누르세요 — PDF 레이어 이름이 없으면 색깔별로 묶어 보여 주니 종류를 골라 주세요. 스캔한 PDF·JPG는 선이 그림이라 직접 그려야 합니다.</p>`;
  if (!dp) return up;
  const K = ZoneKit.INFRA_KINDS, kinds = dp.kinds || {};
  const lay = {}; dp.feats.forEach(f => { const o = lay[f.layer] || (lay[f.layer] = { n: 0, A: 0 }); o.n++; try { o.A += turf.area({ type: 'Feature', properties: {}, geometry: f.geom }); } catch (er) { /* 무시 */ } });
  const layRows = Object.entries(lay).sort((x, y) => y[1].A - x[1].A).map(([l, o]) => {
    const k = kinds[l] || ZoneKit.infraKind(l);
    const sw = /^색 (#[0-9a-f]{6})$/i.exec(l);
    return `<tr><td>${sw ? `<span style="display:inline-block;width:12px;height:12px;border:1px solid #888;background:${sw[1]};vertical-align:-2px;margin-right:4px"></span>` : ''}${esc(l)}</td><td class="r">${o.n}</td><td class="r">${fmt(o.A)}</td><td><select data-drwk="${esc(l)}">${K.map(([v, t]) => `<option value="${v}"${v === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td></tr>`;
  }).join('');
  // 자동 제안 vs 도면(실제) — 같은 줄에 두 값을 나란히
  const au = drawingAuto(a), ai = au && au.infra, d = inf && inf.drawing;
  const pc = (v, A) => A ? (v / A * 100).toFixed(1) + '%' : '–';
  const row = (t, av, dv) => { const df = (dv ?? 0) - (av ?? 0); return `<tr><td>${t}</td><td class="r">${av == null ? '–' : fmt(av)}</td><td class="r">${dv == null ? '–' : fmt(dv)}</td><td class="r${Math.abs(df) > 0.5 ? ' warn' : ''}">${dv == null || av == null ? '' : (df >= 0 ? '+' : '') + fmt(df)}</td></tr>`; };
  const A = a.area;
  const cmp = inf && d ? `<h3>자동 제안 ↔ 정비기반시설도 비교</h3>
    <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">자동 제안 ㎡</th><th class="r">도면(실제) ㎡</th><th class="r">차이</th></tr></thead><tbody>
      ${row('도로', ai ? ai.roadArea : null, inf.roadArea)}
      ${row('공원', ai ? ai.parkArea : null, inf.parkArea)}
      ${row('녹지', ai ? ai.green : null, inf.green)}
      ${row('그 밖의 정비기반시설', ai ? ai.other : null, inf.other)}
      ${row('학교용지', ai ? ai.schoolArea : null, inf.schoolArea)}
      ${row('종교용지', ai ? ai.relArea : null, inf.relArea)}
      ${row('공공청사 등', ai ? ai.pubB : null, inf.pubB)}
      ${row('기반시설 등 합계', ai ? ai.total : null, inf.total)}
      <tr><td>기반시설 비율</td><td class="r">${ai ? pc(ai.total, A) : '–'}</td><td class="r">${pc(inf.total, A)}</td><td class="r">${ai ? ((inf.total - ai.total) / A * 100 >= 0 ? '+' : '') + ((inf.total - ai.total) / A * 100).toFixed(1) + '%p' : ''}</td></tr>
      ${row('공동주택 획지', au ? au.site : null, pl.site)}
      ${row('세대수(개략)', au ? au.units : null, pl.units)}
    </tbody></table></div>
    <div class="row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0"><button type="button" id="drwCase">실제 사례로 저장</button><span class="hint">사례 이름은 'A구역'처럼 익명으로. 사업성 화면 '실제 사례와 비교'에 함께 쌓여 자동 계산의 치우침을 봅니다.</span></div>` : '';
  return `${up}
    <p class="note">올린 도면: <b>${esc(dp.name)}</b> (${esc(dp.at)}) · ${esc(dp.crs || '')} · 닫힌 도형 ${dp.feats.length}개. 구역 밖 부분은 잘라 내고, 종류끼리 겹치면 도로 → 공원 → 녹지 → 그 밖의 시설 → 학교 → 종교 → 공공청사 순으로 셉니다. 레이어 종류가 틀리면 아래에서 고르세요.</p>
    <div class="tscroll"><table class="ledger"><thead><tr><th>레이어</th><th class="r">도형</th><th class="r">면적㎡</th><th>종류</th></tr></thead><tbody>${layRows}</tbody></table></div>
    ${cmp}`;
}
function bindDrawing(a) {
  const z = zoneOf(a.key); z.infra = z.infra || {};
  const f = $id('drwFile'), ld = $id('drwLoad'); if (!f || !ld) return;
  ld.onclick = () => { f.value = ''; f.click(); };
  // 구역에 닿는 도형만(도면 테두리처럼 구역보다 훨씬 큰 것과 아주 작은 것은 뺌), 좌표는 7자리로 줄여 저장
  const useFeats = (name, feats, crs) => {
    const zone = z.geojson, zA = turf.area(zone), r7 = g => JSON.parse(JSON.stringify(g, (k, v) => typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v));
    const hit = feats.filter(ft => { try { const F = { type: 'Feature', properties: {}, geometry: ft.geom }, A = turf.area(F); return A >= 5 && A <= zA * 3 && turf.booleanIntersects(F, zone); } catch (er) { return false; } }).map(ft => ({ layer: ft.layer, geom: r7(ft.geom) }));
    if (!hit.length) { statusMsg(`${name}: 이 구역(${regName()})에 닿는 도형이 없습니다. 좌표계·맞춘 위치·구역을 확인하세요(읽은 도형 ${feats.length}개, ${crs}).`, true); return; }
    z.infra.plan = { name, at: new Date().toLocaleString('sv-SE').slice(0, 16), crs, feats: hit, kinds: {} };
    saveZ(); INFRA.memo = {}; render();
    statusMsg(`${name}: 구역에 닿는 도형 ${hit.length}개(전체 ${feats.length}개, ${crs})를 정비기반시설도로 넣었습니다. 레이어(색) 종류를 확인하세요.`);
  };
  const pb = $id('drwPdf'); if (pb) pb.onclick = () => {
    const v = typeof RefOverlay !== 'undefined' ? RefOverlay.vectorsLL() : null;
    if (!v) { statusMsg(typeof RefOverlay !== 'undefined' && RefOverlay.img && !RefOverlay.aligned ? '겹친 도면을 먼저 [두 점으로 맞추기]로 맞춰 주세요.' : RefOverlay && RefOverlay.img && !(RefOverlay.vec || []).length ? '겹친 도면에 폴리선이 없습니다(스캔·그림 PDF). 직접 그리거나 CAD에서 DXF로 받아 주세요.' : "지도 왼쪽 '참고 도면 겹쳐 보기'로 CAD에서 내보낸 PDF를 올리고 두 점으로 맞춘 뒤 누르세요.", true); return; }
    useFeats(`PDF 도면(${RefOverlay.vec.length}개 도형)`, v, 'PDF 두 점 맞춤');
  };
  f.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    statusMsg(`${file.name} 읽는 중…`);
    try {
      let feats = [], crs = '';
      if (/\.dxf$/i.test(file.name)) {
        const c = LM ? LM.getCenter() : null, r = await ZoneKit.readDxfAll(await file.arrayBuffer(), c ? [c.lat, c.lng] : null);
        if (r.error) { statusMsg(r.error, true); return; }
        feats = r.feats.map(x => ({ layer: x.layer, geom: x.geom })); crs = r.crs;
      } else {
        const gj = JSON.parse(await file.text()), fs = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
        fs.forEach(ft => { const g = ft.geometry; if (!g) return; const pr = ft.properties || {}, layer = String(pr.layer || pr.kind || pr['용도'] || pr['시설'] || pr.name || '0');
          (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).forEach(c => feats.push({ layer, geom: { type: 'Polygon', coordinates: c } })); });
        crs = 'GeoJSON(경위도)';
      }
      useFeats(file.name, feats, crs);
    } catch (er) { statusMsg(`${file.name}을(를) 읽지 못했습니다: ${er.message}`, true); }
  };
  const cl = $id('drwClear'); if (cl) cl.onclick = () => { if (!confirm('올린 정비기반시설도를 지울까요?')) return; delete z.infra.plan; saveZ(); INFRA.memo = {}; render(); };
  document.querySelectorAll('[data-drwk]').forEach(sel => sel.onchange = () => { const dp = z.infra.plan; if (!dp) return; dp.kinds = dp.kinds || {}; dp.kinds[sel.dataset.drwk] = sel.value; saveZ(); INFRA.memo = {}; render(); });
  const cs = $id('drwCase'); if (cs) cs.onclick = () => {
    if (!window.JbsCases) { statusMsg('사례 저장 기능을 불러오지 못했습니다.', true); return; }
    const name = prompt('사례 이름(익명, 예: A구역)', 'A구역'); if (!name) return;
    const stage = prompt('단계(정비계획(구역지정) 고시 / 정비계획 변경 고시 / 사업시행계획인가 / 관리처분계획인가 / 기타)', '사업시행계획인가') || '기타';
    const pl = plan(a), au = drawingAuto(a), inf = pl.infra, ai = au && au.infra, A = a.area;
    const r = JbsCases.save({ name: name.trim(), stage: stage.trim(), memo: `/urban 정비기반시설도(${(z.infra.plan || {}).name || ''})`,
      actual: { siteArea: Math.round(A), infraPct: Math.round(inf.total / A * 1000) / 10, lotArea: Math.round(pl.site) },
      auto: ai ? { siteArea: Math.round(A), infraPct: Math.round(ai.total / A * 1000) / 10, lotArea: Math.round(au.site), units: au.units } : {},
      autoAt: new Date().toLocaleString('sv-SE').slice(0, 16), geojson: z.geojson });
    statusMsg(r ? `사례 '${name}'을(를) 저장했습니다. 세대수·용적률·사업성 실제 값은 사업성 화면 '실제 사례와 비교'에서 채우세요.` : '저장하지 못했습니다(브라우저 저장 공간). 작업 저장으로 파일을 내려받아 두세요.', !r);
  };
}
