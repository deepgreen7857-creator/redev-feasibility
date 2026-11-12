// /urban 정비계획 화면 코드 10/12 — 오른쪽 설명 칸 ②: 기반시설·혼합·넘겨주기(개략 배치·출입구·자동 진행·건축선·사업성·기준은 10b-panel-arch.js)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
function infraSection(a, pl) {
  const inf = pl.infra, manual = P.infraMode === 'manual', drawing = P.infraMode === 'drawing';
  const head = `<div class="infra-head"><h3 style="margin:0">정비기반시설 ${drawing ? '(정비기반시설도)' : '제안'}</h3>
    <div class="seg" role="group" aria-label="기반시설 비율"><button type="button" data-im="proposal" aria-pressed="${P.infraMode === 'proposal' || !P.infraMode}">제안값 사용</button><button type="button" data-im="drawing" aria-pressed="${drawing}" title="이미 정비기반시설 계획도가 있는 구역(지정·인가된 구역 등): CAD 도면을 올려 실제 계획 그대로 계산">기반시설도 올리기</button><button type="button" data-im="manual" aria-pressed="${manual}">비율 직접 입력</button></div></div>`;
  if (manual) return head + '<p class="hint">제안값 대신 아래 "정비기반시설 비율"에 넣은 값으로 계산합니다.</p>';
  if (drawing) return head + drawingSection(a, pl);
  if (!inf) return head;
  const lo = INFRA.loading[a.key];
  const rows = [];
  inf.items.forEach(it => rows.push(it.kind === 'manual' ? ['직접 지정한 도로', it.area, '구역계 자르기로 도로(기반시설)로 지정한 조각 — 지도에서 누르면 취소'] : [`${{ entry: '진입도로', entry2: '두 번째 진입도로' }[it.kind] || '주변 도로'} 확폭 · ${esc(it.jibun)}`, it.area, (it.kind === 'entry' ? (inf.entry && inf.entry.mode === 3 ? `제25조③ 진입도로 2개 폭 합 ${inf.entry.W2}m 이상(${fmt(pl.units)}세대)` : `주택건설기준 등에 관한 규정 제25조① — ${fmt(pl.units)}세대 기준 폭 ${inf.W}m 이상`) : it.kind === 'entry2' ? `제25조③ 진입도로 2개 폭 합 ${inf.entry.W2}m 이상` : it.manual ? '직접 고른 계획 폭' : it.dec ? `도시계획도로 ${esc(it.dec)} 결정 — 등급 하한 ${ROADCLS.lower(it.dec)}m까지` : it.oneway ? '일방통행 → 양방향 소로1류 하한 10m' : `경계 도로 최소 ${sideWOf()}m(소로2류 하한)`) + ` → 약 ${it.to}m. 현황 약 ${it.from}m(필지 모양으로 추정)` + (it.extra ? ` · 확보 목표 부족분 채우려 +${fmt(it.extra, 1)}m 더 넓힘` : '')]));
  if (!inf.items.length) rows.push(['도로 확폭', 0, !inf.roadsReady ? (lo ? '경계 도로를 불러오는 중…' : '경계 도로 조회 전') : inf.edge.length ? `경계 도로가 이미 기준 폭 이상(진입도로 ${inf.W}m, 주변 ${inf.sideW}m)` : '구역 경계에 닿은 도로 필지를 찾지 못함 — 진입도로 위치 확인 필요']);
  const szTxt = sz => sz.bad ? `넣은 값이 너무 커서(${sz.mode === 'pct' ? `구역의 ${num(sz.val)}%` : `${fmt(num(sz.val))}㎡`}) 자동값 ${fmt(sz.A)}㎡로 계산` : sz.mode === 'area' ? `직접 지정 ${fmt(num(sz.val))}㎡` : sz.mode === 'pct' ? `구역의 ${num(sz.val)}%로 지정(${fmt(sz.A)}㎡)` : '';
  if (inf.szPark.mode !== 'auto') rows.push(['공원', inf.parkArea, `${szTxt(inf.szPark)}. 법정·제안 기준은 ${fmt(inf.parkLegal)}㎡` + (inf.parkLegal > inf.szPark.A ? ' — <b class="warn">기준보다 작음</b>' : '')]);
  if (inf.parkExist >= 1) rows.push(['기존 공원·녹지', inf.parkExist, `구역 안 기 조성 공원·녹지(지목 공원 또는 이용상황 공원) ${fmt(inf.parkExist)}㎡ — 2030 기본계획(고시 제2026-96호): 제척이 원칙, 부득이 포함하면 법정면적 산정에 넣되 <b>기존 면적 이상</b> 설치. 공원 자동 면적이 이 값보다 작지 않게 잡았습니다${inf.parkArea + (inf.green || 0) < inf.parkExist - 1 ? ' — <b class="warn">지금 공원·녹지가 기존 면적보다 작음</b>' : ''}`]);
  if (inf.szPark.mode === 'auto') rows.push(['공원', inf.parkArea, inf.legal ? `도시공원 및 녹지 등에 관한 법률 시행규칙 별표2 제4호 — 정비계획 5만㎡ 이상: 세대당 2㎡(${fmt(pl.units * 2)}㎡)와 부지 5%(${fmt(a.area * 0.05)}㎡) 중 큰 면적 ${fmt(inf.parkNeed)}㎡` + (inf.parkArea < inf.parkNeed * 0.95 ? ' · <b class="warn">구역 경계에 걸려 모자람 — 위치를 옮기세요</b>' : '') : (P.parkMode === 'always' ? `5만㎡ 미만이라 법정 의무는 없으나 부지 5%로 제안(${fmt(inf.parkNeed)}㎡)` : `구역 ${fmt(a.area)}㎡ < 5만㎡ — 별표2 의무 없음. 2030 인천 정비기본계획 공원·녹지 기준은 고시문 대조 필요`)]);
  if (inf.paired) rows.push(['한 띠로 묶음', 0, `공원·녹지와 종교용지가 맞닿아 구역 경계를 따라 한 띠로 묶였습니다. 둘 중 하나를 끌면 같이 움직이고, 가운데 ⇆로 면적을 나눕니다. <button type="button" class="btn ghost sm" id="unpair">따로 놓기</button>`]);
  else if (((Z.zones[a.key] || {}).infra || {}).noPair) rows.push(['따로 놓음', 0, `공원·녹지와 종교용지를 각자 따로 놓았습니다. <button type="button" class="btn ghost sm" id="repair">맞닿으면 한 띠로 묶기</button>`]);
  if (inf.paired && inf.paired.custom) rows.push(['나눔선 조정', 0, `맞닿은 ${{ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[inf.paired.kinds[0]]} ${fmt(inf.paired.a1)}㎡ · ${{ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[inf.paired.kinds[1]]} ${fmt(inf.paired.a2)}㎡ (합 ${fmt(inf.paired.total)}㎡ 그대로, 위 면적에 반영) <button type="button" class="btn ghost sm" id="resetSplit">처음 나눔으로</button>`]);
  if (inf.absorbed >= 1) rows.push(['자투리 편입', 0, `큰 공동주택 획지와 떨어져 갇힌 1,000㎡ 미만 조각 ${fmt(inf.absorbed)}㎡를 가장 많이 맞닿은 공원·학교·대체부지에 붙였습니다(위 면적에 포함).`]);
  if (inf.szSchool.A > 0) rows.push(['학교용지', inf.schoolArea, `${szTxt(inf.szSchool) || '입력값'} — 교육청 협의로 정함. 정비기반시설이 아니어서 신설(무상귀속) 면적에는 넣지 않음`]);
  if (inf.green) rows.push(['녹지', inf.green, '완충녹지·경관녹지·연결녹지 등(입력값) — 지도에는 그리지 않음']);
  if (inf.other) rows.push(['그 밖의 정비기반시설', inf.other, '공용주차장·공공공지·광장·소방용수시설 등(입력값) — 도정법 제2조제4호·영 제3조']);
  if (inf.pubB) rows.push(['공공청사 등', inf.pubB, '정비기반시설이 아님(입력값). 기부채납·공공기여로 다루며 신설(무상귀속) 면적에는 넣지 않음']);
  if (inf.relAll.length || inf.relManual) {
    const chips = inf.relAll.map(p => `<label class="rel-chip"><input type="checkbox" data-rel="${esc(p.pnu)}" ${inf.rel.includes(p) ? 'checked' : ''}> ${esc(p.jibun)} (${fmt((p.base ?? p.area))}㎡)</label>`).join(' ');
    rows.push([`종교용지(존치·대체) ${inf.rel.length}필지`, inf.relArea, `구역 안 종교시설(교회 등) 부지. 법정 의무는 없으나 실무상 정비계획에서 존치하거나 구역 안 대체부지로 잡아 공동주택 획지에서 뺍니다. 근생 건물의 한 층을 쓰는 교회는 상가 분양·보상 대상이라 넣지 않습니다.<br>${chips || '자동으로 찾은 필지 없음'}${inf.relManual ? ` · <b>${szTxt(inf.szRel)}</b>` : ''}
      <div class="seg" role="group" aria-label="종교용지 위치" style="margin-top:6px"><button type="button" data-relmode="keep" aria-pressed="${!inf.relC}">현 위치 존치</button><button type="button" data-relmode="move" aria-pressed="${!!inf.relC}">대체부지로 옮기기</button></div>
      <span class="u">${inf.relC ? '지도에서 보라색 사각형을 끌어 원하는 자리에 두세요(면적은 종교용지 면적).' : '현재 교회 필지 그대로 둡니다. 보라색을 끌면 대체부지로 바뀝니다.'}</span>`]);
  }
  rows.push([`구역 안 기존 정비기반시설 ${inf.inner.length}필지<br><span class="u">도로·구거 등 국공유</span>`, P.keepInnerRoads ? inf.innerFull : inf.innerArea, (inf.innerOcc >= 1 ? `사용 중 ${fmt(inf.innerArea)}㎡ / 건물 점유 ${fmt(inf.innerOcc)}㎡(필지 ${fmt(inf.innerFull)}㎡). ` : '') + (P.keepInnerRoads
    ? '존치하여 기반시설로 셈(필지 전체)'
    : (inf.innerOcc >= 1 ? '건물 점유 부분은 무상양도 면적에서 뺌. ' : '') + '용도폐지하고 획지에 넣음 — 국가·지자체 소유분은 새로 설치하는 정비기반시설의 설치비용 범위에서 사업시행자에게 무상양도(도정법 제97조②). 존치하려면 아래에서 선택')]);
  return head + `
  ${(() => {
    const ok = inf.short <= 1, tgt = inf.keepArea, nw = inf.newArea, okAll = ok || (inf.money && inf.money.newCost >= inf.money.oldVal - 1);
    return `<div class="target-box ${okAll ? 'ok' : 'ng'}"><div><b>확보 목표(면적, 개략)</b> ${fmt(tgt)}㎡ = ${P.keepInnerRoads ? '기존 도로를 존치해 용도폐지 없음' : `용도폐지되는 설치된 국공유 기반시설 ${inf.inner.length}필지 중 사용 중인 면적`}${inf.innerOcc >= 1 ? ` — <b>건물 점유 ${fmt(inf.innerOcc)}㎡ 뺌</b>(국공유 공공시설 필지 안쪽을 건물이 덮은 부분, 보수적으로 제외)` : ''}</div>
      <div><b>신설 정비기반시설</b> ${fmt(nw)}㎡ → ${ok ? '<b class="good">면적으로도 충족</b>' : `면적으로는 ${fmt(inf.short)}㎡ 적음 <span class="u">(참고 — 무상양도는 아래 금액 기준으로 판단)</span>`}</div>
      ${(() => { const mOk = inf.money && inf.money.newCost >= inf.money.oldVal - 1; return !ok && !mOk ? `<div><b>확보 목표가 ${fmt(inf.short)}㎡ 모자랍니다.</b> ${FILL_NOTE}${fillGuide(inf, inf.short)}</div>` : ''; })()}
      ${moneyBox(inf)}
      <div class="u">용도폐지 대상은 결정되어 <b>설치된</b> 국공유 정비기반시설(제97조③). 위 면적 목표는 개략 확인용입니다.${(inf.facList || []).length ? ` 구역 안 도시계획시설 결정선 ${inf.facList.length}건 ${fmt(inf.facArea)}㎡는 상쇄하지 않고 '추후 할 일'에 남깁니다.` : ''}</div></div>`;
  })()}
  ${entrySection(inf, pl)}
  ${giSection(inf)}
  <p class="hint">지도의 색 구분 <b>기반시설</b>에 위치를 그렸습니다. <b>공원(초록)·학교(파랑)·종교용지(보라)는 지도에서 도형을 끌어 옮기면 됩니다.</b> 아래 버튼을 누른 뒤 지도에서 자리를 눌러도 옮겨집니다.</p>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">면적㎡</th><th>근거·설명</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td class="r">${fmt(r[1])}</td><td class="wrap">${r[2]}</td></tr>`).join('')}
  ${(() => { const newA = inf.newArea, oldA = P.keepInnerRoads ? 0 : inf.innerArea;
      return `<tr><td>신설 정비기반시설<br><span class="u">준공 시 국가·지자체에 무상귀속</span></td><td class="r">${fmt(newA)}</td><td class="wrap">도로 확폭·직접 지정한 도로·공원·녹지·그 밖의 정비기반시설(학교·공공청사 제외). 사업시행자가 설치해 국가·지자체에 무상귀속(도정법 제97조②). 구역 안 새 도로는 ✂ 구역계 자르기로 그어 '도로로 지정'하세요.</td></tr>
      <tr><td>용도폐지 기존 기반시설<br><span class="u">무상양도 대상</span></td><td class="r">${fmt(oldA)}</td><td class="wrap">${oldA ? `신설 ${fmt(newA)}㎡ 대비 ${newA ? (oldA / newA * 100).toFixed(0) : '–'}%(면적 기준). 실제 양도 범위는 용도폐지 시설의 평가금액과 신설 시설 설치비용을 비교해 정함` : '없음'}</td></tr>`; })()}
  ${(inf.skipped || []).length ? `<tr><td>획지 붙이기<br><span class="u">적용 안 함</span></td><td class="r">0</td><td class="wrap">${inf.skipped.map(m => `주된 공동주택 획지 ${fmt(m.area)}㎡ 전체를 ${{ park: '공원·녹지', school: '학교용지', rel: '종교용지' }[m.kind]}에 붙인 것 <button type="button" class="btn ghost sm" data-unmerge="${m.idx}">지우기</button>`).join(' · ')} — 실수로 보여 적용하지 않았습니다. 필요하면 획지를 눌러 붙일 면적을 넣어 다시 붙이세요.</td></tr>` : ''}
  ${Object.keys(inf.merged || {}).length ? `<tr><td>획지 붙이기</td><td class="r">${fmt(Object.values(inf.merged).reduce((a2, b2) => a2 + b2, 0))}</td><td class="wrap">${inf.mergeList.map(m => `${{ park: '공원·녹지', school: '학교용지', rel: '종교용지' }[m.kind]}에 ${fmt(m.area)}㎡ <button type="button" class="btn ghost sm" data-unmerge="${m.idx}" aria-label="이 붙이기 되돌리기">✕</button>`).join(' · ')} (위 면적에 포함) <button type="button" class="btn ghost sm" id="undoMerge">모두 되돌리기</button></td></tr>` : ''}
  ${(inf.lots || []).length ? `<tr><td>공동주택 획지 ${inf.lots.length}개<br><span class="u">남는 땅</span></td><td class="r">${fmt(inf.lots.reduce((s2, l) => s2 + l.area, 0))}</td><td class="wrap">${inf.lots.map(l => `획지${l.no} ${fmt(l.area)}㎡${l.small ? '(<b class="warn">작음</b>)' : ''}`).join(' · ')}${inf.lots.some(l => l.small) ? '<br>1,000㎡ 미만 획지는 공동주택 단독 개발이 어려우니, 지도에서 그 획지를 눌러 옆 종교용지·공원·학교에 붙이거나 시설 위치를 옮기세요.' : ''}</td></tr>` : ''}
  <tr class="sum"><td><b>제안 계${inf.relArea ? '<br><span class="u">(기반시설 + 종교용지)</span>' : ''}</b></td><td class="r"><b>${fmt(inf.total)}</b></td><td>구역의 ${(inf.ratio * 100).toFixed(1)}%</td></tr></tbody></table></div>
  <div class="zk-btns" style="margin-top:8px">
    <button type="button" class="btn ghost sm" id="placePark">공원 위치 지도에서 정하기</button>
    ${inf.szSchool.A > 0 ? '<button type="button" class="btn ghost sm" id="placeSchool">학교 위치 지도에서 정하기</button>' : ''}
    <button type="button" class="btn ghost sm" id="refetchRoads">경계 도로 다시 조회</button>
  </div>
  ${FITUI.panel(a.key, inf)}
  <h4 style="margin:12px 0 4px">공원·학교·종교용지 면적 정하기</h4>
  <div class="tscroll"><table class="sz-tbl"><thead><tr><th>시설</th><th>정하는 방식</th><th>값</th><th>가로:세로</th><th title="나눔선을 끌 때 이 면적 아래로는 줄지 않음">최소㎡</th><th class="r">적용 면적㎡</th></tr></thead><tbody>
  ${[['park', '공원·녹지', inf.szPark, `자동: ${inf.legal ? '법정' : P.parkMode === 'always' ? '부지 5%' : '법정 의무만'} ${fmt(inf.parkLegal)}㎡`, inf.parkArea],
     ['school', '학교용지', inf.szSchool, num(P.schoolArea) ? `자동: 입력값 ${fmt(num(P.schoolArea))}㎡` : '자동: 없음(0)', inf.schoolArea],
     ['rel', '종교용지', inf.szRel, `자동: 교회 필지 대지 ${fmt(inf.relLand)}㎡`, inf.relArea]].map(([k, n, sz, autoTxt, cur]) => `<tr>
     <td>${n}</td>
     <td><select data-szmode="${k}" aria-label="${n} 면적 정하는 방식"><option value="auto" ${sz.mode === 'auto' ? 'selected' : ''}>자동</option><option value="area" ${sz.mode === 'area' ? 'selected' : ''}>면적 직접(㎡)</option><option value="pct" ${sz.mode === 'pct' ? 'selected' : ''}>구역 대비 %</option></select></td>
     <td>${sz.mode === 'auto' ? `<span class="u">${autoTxt}</span>` : `<input data-szval="${k}" inputmode="decimal" value="${esc(String(sz.val))}" placeholder="${sz.mode === 'pct' ? '예: 5' : '예: 2000'}" aria-label="${n} ${sz.mode === 'pct' ? '구역 대비 %' : '면적 ㎡'}" style="width:90px"> ${sz.mode === 'pct' ? '%' : '㎡'}${sz.bad ? ' <b class="warn" title="구역 대비 100% 또는 구역의 80%를 넘는 값은 쓰지 않습니다">너무 큼 → 자동값</b>' : ''}`}</td>
     <td><select data-szasp="${k}" aria-label="${n} 가로세로 비율">${[1, 1.5, 2, 3].map(r => `<option value="${r}" ${sz.asp === r ? 'selected' : ''}>1:${r}</option>`).join('')}</select></td>
     <td><input data-szmin="${k}" inputmode="decimal" value="${esc(String(((Z.zones[a.key].infra || {}).sz || {})[k] && Z.zones[a.key].infra.sz[k].min || ''))}" placeholder="${k === 'park' ? '법정 ' + fmt(inf.parkLegal) : '없음'}" aria-label="${n} 최소 면적" style="width:80px"></td>
     <td class="r">${fmt(cur)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="hint" style="margin-top:4px">최소㎡: 맞닿은 시설 사이 나눔선을 끌 때 이 면적 아래로는 줄지 않습니다(공원은 비우면 법정·제안 기준). 구역 대비 %는 구역 면적 ${fmt(a.area)}㎡ 기준입니다. 가로:세로는 경계선 방향으로 긴 쪽입니다. 들어갈 자리가 없으면 다른 비율로 바꿔 봅니다.${inf.relC ? '' : ' 종교용지는 \'대체부지로 옮기기\'일 때만 비율이 모양에 반영됩니다(존치는 필지 그대로).'}</p>
  <div class="form" style="margin-top:8px">
    ${field('sideRoadW', '경계 도로 최소 폭', P.sideRoadW, 'm · 기본 8m(소로2류 하한). 진입도로는 세대수 기준 자동', 'step=0.5')}
    ${field('greenInfra', '녹지 면적', P.greenInfra, '㎡ · 완충·경관·연결녹지 등(공원과 따로)', 'step=100')}
    ${field('otherInfra', '그 밖의 정비기반시설 면적', P.otherInfra, '㎡ · 공용주차장·공공공지·광장 등', 'step=100')}
    ${field('pubBldg', '공공청사 등 면적', P.pubBldg, '㎡ · 정비기반시설 아님(무상귀속 제외)', 'step=100')}
    ${field('valMult', '감정평가 배율(공시지가 대비)', P.valMult || 1.4, '배 · 무상양도 금액 비교용 가정값', 'step=0.05')}
    ${field('roadWork', '도로 공사비 단가', P.roadWork || 0, '원/㎡ · 0이면 공사비 빼고 비교', 'step=10000')}
    ${field('parkWork', '공원·녹지 조성비 단가', P.parkWork || 0, '원/㎡', 'step=10000')}
    <div class="field"><label for="parkMode">5만㎡ 미만일 때 공원·녹지</label><select id="parkMode"><option value="legal">법정 의무만(없으면 0)</option><option value="always">부지 5% 제안</option></select></div>
  </div>
 <label class="zk-opts"><input type="checkbox" id="autoAbsorb" ${P.autoAbsorb !== false ? 'checked' : ''}> 큰 획지와 떨어져 갇힌 1,000㎡ 미만 조각을 맞닿은 시설에 자동으로 붙이기 — 끄면 그 조각은 주황 획지로 남음(눌러서 면적을 정해 붙일 수 있음)</label>
  <label class="zk-opts"><input type="checkbox" id="keepInner" ${P.keepInnerRoads ? 'checked' : ''}> 구역 안 기존 도로를 존치(기반시설로 셈)</label>
  <p class="note">도로 폭은 연속지적도 필지 모양으로 어림한 값이라 실제 측량 폭과 다를 수 있습니다. 확폭 부분은 구역 안쪽으로만 잡았습니다. 위치·형태는 정비계획 입안 때 교통·공원 담당 부서 협의와 도시계획위원회 심의로 정합니다.</p>`;
}
function bindInfra(a) {
  side.querySelectorAll('[data-im]').forEach(b => b.onclick = () => { P.infraMode = b.dataset.im; saveP(); render(); });
  if (P.infraMode === 'drawing' && a) bindDrawing(a);
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  FITUI.bind(side);
  on('placePark', () => { S.placing = 'park'; $id('lmap').classList.add('picking'); toast('지도에서 공원을 둘 자리를 누르세요'); });
  on('placeSchool', () => { S.placing = 'school'; $id('lmap').classList.add('picking'); toast('지도에서 학교용지를 둘 자리를 누르세요'); });
  on('refetchRoads', () => { const z = Z.zones[S.region]; if (z) { delete z.roads; saveZ(); INFRA.memo = {}; INFRA.fetchRoads(S.region); render(); } });
  const pm = document.getElementById('parkMode'); if (pm) { pm.value = P.parkMode; pm.onchange = () => { P.parkMode = pm.value; saveP(); INFRA.memo = {}; render(); }; }
  const zi = () => { const z = Z.zones[S.region]; if (!z) return null; z.infra = z.infra || {}; return z.infra; };
  side.querySelectorAll('[data-unmerge]').forEach(b => b.onclick = () => { const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.addTo) return; z.infra.addTo.splice(+b.dataset.unmerge, 1); saveZ(); INFRA.memo = {}; render(); toast('붙인 땅 하나를 되돌렸습니다'); });
  on('unpair', () => { const z = Z.zones[S.region]; if (z) { z.infra = z.infra || {}; z.infra.noPair = true; delete z.infra.pairEdge; saveZ(); INFRA.memo = {}; render(); toast('두 시설을 따로 놓았습니다'); } });
  on('repair', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.noPair; saveZ(); INFRA.memo = {}; render(); } });
  on('resetSplit', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.pairSplit; saveZ(); INFRA.memo = {}; render(); toast('나눔선을 처음 자리로 되돌렸습니다'); } });
  on('undoMerge', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.addTo; saveZ(); INFRA.memo = {}; render(); toast('붙인 획지를 되돌렸습니다'); } });
  side.querySelectorAll('[data-relmode]').forEach(b => b.onclick = () => {
    const inf = zi(); if (!inf) return;
    if (b.dataset.relmode === 'keep') delete inf.relC;
    else if (!inf.relC) { const r = plan(analyze(S.region)).infra; inf.relC = (r && r.relCenter) || INFRA.defaultCenter(Z.zones[S.region].geojson); }
    saveZ(); INFRA.memo = {}; render();
  });
  side.querySelectorAll('[data-rel]').forEach(cb => cb.onchange = () => { const inf = zi(); if (!inf) return; inf.relOff = inf.relOff || {}; if (cb.checked) delete inf.relOff[cb.dataset.rel]; else inf.relOff[cb.dataset.rel] = true; saveZ(); INFRA.memo = {}; render(); });
  const szSet = (k, f) => { const inf = zi(); if (!inf) return; inf.sz = inf.sz || {}; inf.sz[k] = inf.sz[k] || {}; f(inf.sz[k]); saveZ(); INFRA.memo = {}; render(); };
  side.querySelectorAll('[data-szmode]').forEach(el => el.onchange = () => szSet(el.dataset.szmode, o => { o.mode = el.value; o.val = ''; }));
  side.querySelectorAll('[data-szval]').forEach(el => el.onchange = () => szSet(el.dataset.szval, o => { o.val = num(el.value); }));
  side.querySelectorAll('[data-szmin]').forEach(el => el.onchange = () => szSet(el.dataset.szmin, o => { const v = num(el.value); if (v > 0) o.min = v; else delete o.min; }));
  side.querySelectorAll('[data-szasp]').forEach(el => el.onchange = () => szSet(el.dataset.szasp, o => { o.asp = num(el.value); }));
  const aa = document.getElementById('autoAbsorb'); if (aa) aa.onchange = () => { P.autoAbsorb = aa.checked; saveP(); INFRA.memo = {}; render(); };
  side.querySelectorAll('[data-gidec]').forEach(el => el.onchange = () => { const z = Z.zones[S.region]; if (!z) return; z.infra = z.infra || {}; z.infra.giDec = z.infra.giDec || {}; if (el.value) z.infra.giDec[el.dataset.gidec] = el.value; else delete z.infra.giDec[el.dataset.gidec]; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-gifocus]').forEach(el => { el.onmouseenter = () => { const k = el.dataset.gifocus; const put = l => { el.title = (el.textContent + MOVES.text(l)).trim(); }; put(MOVES.get(k)); if (!MOVES.get(k)) MOVES.load(k).then(l => put(l || [])); }; });
  side.querySelectorAll('[data-gifocus]').forEach(el => el.onclick = () => { const p = D.byPnu.get(el.dataset.gifocus); if (p && p.geom && LM) { LM.fitBounds(L.geoJSON(p.geom).getBounds(), { padding: [80, 80], maxZoom: 20 }); const m = L.geoJSON(p.geom, { style: { color: '#c92a2a', weight: 3, dashArray: '6 4', fillOpacity: 0.12 }, interactive: false }).addTo(LM); setTimeout(() => m.remove(), 6000); document.getElementById('lmap').scrollIntoView({ block: 'center' }); } });
  on('giAsk', () => {
    const inf = plan(analyze(S.region)).infra, z = Z.zones[S.region];
    const rows = (inf.giAll || []).filter(x => x.pub && x.grade !== '확실').map((x, i) => ({
      '연번': i + 1, '구역명': Z.title || '', '안': D.regions[S.region].name, '지번': x.p.jibun, '지목': x.p.jimok, '대장면적(㎡)': Math.round((x.p.base ?? x.p.area) * 10) / 10, '편입면적(㎡)': Math.round(x.area * 10) / 10,
      '소유구분': x.p.own || '', '관리기관 구분': x.p.ownInst || '', '토지이용상황': x.p.landUse || '', '도시계획시설 결정': x.facKind || '없음',
      '필지 위 건물': x.noBld ? '없음' : `${x.nLedger + x.nGis}동(대장 없음 ${x.nGis})`, '소유권 변동': `${x.p.chgDate || ''} ${x.p.chgCause || ''}`.trim(), '자동 판정': x.grade, '현재 판단': x.include ? '넣음' : '뺌',
      '조회 요청 사항': '① 행정재산/일반재산 구분 ② 대부(사용허가) 계약 유무·대상 ③ 현재 공공용(도로·공원 등) 사용 여부 ④ 관리 부서', '회신': '',
    }));
    if (!rows.length) { toast('조회할 필지가 없습니다(국공유 필지가 모두 \'확실\'이거나 없음)'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [4, 16, 6, 10, 6, 10, 10, 10, 10, 12, 16, 16, 18, 10, 8, 50, 20].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '국공유지 조회요청');
    XLSX.writeFile(wb, `${(Z.title || '정비구역').replace(/[\\/:*?"<>|]+/g, '_')}_국공유지_조회요청.xlsx`);
  });
  on('giCopy', async () => { const inf = plan(analyze(S.region)).infra; const rows = (inf.giAll || []).map(x => [x.p.jibun, x.p.jimok, x.p.own || '', x.p.landUse || '', x.jm ? 'O' : '', x.lu ? 'O' : '', x.fc ? 'O' : '', x.w, x.noBld ? 'O' : '', x.grade, x.include ? '넣음' : '뺌', Math.round(x.area * 10) / 10, Math.round((x.occ || 0) * 10) / 10, Math.round(x.useA * 10) / 10].join('\t')); try { await navigator.clipboard.writeText(['지번\t지목\t소유\t토지이용상황\t공공지목\t이용상황도로등\t도시계획시설\t평균폭(m)\t건물없음\t자동판정\t판단\t편입면적(㎡)\t건물점유(㎡)\t사용중(㎡)', ...rows].join('\n')); toast('표를 복사했습니다. 엑셀에 붙여 넣으세요'); } catch (er) { toast('복사하지 못했습니다'); } });
  side.querySelectorAll('[data-entrymode]').forEach(b => b.onclick = () => { const inf = zi(); if (!inf || b.disabled) return; if (b.dataset.entrymode === 'auto') delete inf.entryMode; else inf.entryMode = b.dataset.entrymode; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-entrypick]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.entryPnu = el.dataset.entrypick; saveZ(); INFRA.memo = {}; render(); });
  on('entryAuto', () => { const inf = zi(); if (!inf) return; delete inf.entryPnu; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-edgeopt]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.edgeOpt = inf.edgeOpt || {}; const o = inf.edgeOpt[el.dataset.pnu] = inf.edgeOpt[el.dataset.pnu] || {}; if (el.checked) o[el.dataset.edgeopt] = true; else delete o[el.dataset.edgeopt]; if (!Object.keys(o).length) delete inf.edgeOpt[el.dataset.pnu]; if (el.dataset.edgeopt === 'oneway' && el.checked && inf.entryPnu === el.dataset.pnu) delete inf.entryPnu; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-parkto]').forEach(btn => btn.onclick = () => szSet('park', o => { o.mode = 'area'; o.val = num(btn.dataset.parkto); }));
  side.querySelectorAll('[data-trwiden]').forEach(b => b.onclick = () => {
    const t = trafficWidenInfo(); const inf = zi(); if (!t || !inf) return; inf.edgeOpt = inf.edgeOpt || {};
    let n = 0; t.rows.forEach(r => { if (!r.pnu || !(num(r.need) > 0)) return; const o = inf.edgeOpt[r.pnu] = inf.edgeOpt[r.pnu] || {}; delete o.keep; o.pw = num(r.need); n++; });
    saveZ(); INFRA.memo = {}; render(); toast(n ? `교통성 검토 결과로 경계 도로 ${n}곳의 계획 폭을 넓혔습니다` : '적용할 도로를 찾지 못했습니다', 3000);
  });
  side.querySelectorAll('[data-edgesel]').forEach(el => el.onchange = () => {
    const inf = zi(); if (!inf) return; inf.edgeOpt = inf.edgeOpt || {}; const k = el.dataset.edgesel, o = inf.edgeOpt[k] = inf.edgeOpt[k] || {};
    let v = el.value;
    if (v === 'custom') { const t = prompt('계획 폭(m)을 넣으세요', ''); if (t == null) { render(); return; } v = String(num(t)); if (!(num(v) > 0)) { render(); return; } }
    delete o.pw; delete o.keep;
    if (v === 'keep') o.keep = true; else if (v !== 'auto') o.pw = num(v);
    if (!Object.keys(o).length) delete inf.edgeOpt[k];
    saveZ(); INFRA.memo = {}; render();
  });
  side.querySelectorAll('[data-edgefocus]').forEach(el => el.onclick = () => { const z = Z.zones[S.region], r = z && z.roads && z.roads.edge.find(x => x.pnu === el.dataset.edgefocus); if (r && LM) { LM.fitBounds(L.geoJSON(r.geom).getBounds(), { padding: [80, 80], maxZoom: 19 }); const m = L.geoJSON(r.geom, { style: { color: '#1971c2', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(LM); setTimeout(() => m.remove(), 6000); } });
  side.querySelectorAll('[data-gireply]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.giReply = inf.giReply || {}; if (el.value) inf.giReply[el.dataset.gireply] = el.value; else delete inf.giReply[el.dataset.gireply]; saveZ(); INFRA.memo = {}; render(); });
  const ki = document.getElementById('keepInner'); if (ki) ki.onchange = () => { P.keepInnerRoads = ki.checked; saveP(); INFRA.memo = {}; render(); };
}
// 평형 구성 — 평형 목록은 shared/criteria/arch.json '평면'(39·49·59·74·84·101·114㎡형), 비율은 공통 가정값(mixNN)에 저장
function mixSection() {
  const A = JbsFeas.get(), ts = unitTypes(), sum = ts.reduce((s, t) => s + num(A['mix' + t]), 0);
  const pre = Object.keys((ARCHC || {})['평형구성_예시'] || {});
  return `<h3>분양 평형 구성</h3>
  ${pre.length ? `<div class="zk-btns" style="margin-bottom:6px">${pre.map(k => `<button type="button" class="btn ghost sm" data-mixpreset="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
  <div style="display:flex;flex-wrap:wrap;gap:6px 10px">${ts.map(t => `<label style="display:flex;flex-direction:column;font-size:12px">${t}㎡형 %<input data-feas="mix${t}" type="number" min="0" max="100" step="any" value="${num(A['mix' + t]) || ''}" placeholder="0" style="width:64px" aria-label="${t}㎡형 비율(%)"></label>`).join('')}</div>
  <p class="u" style="margin:2px 0 0">합계 ${fmt(sum)}%${Math.abs(sum - 100) > 0.5 ? ' — 100%가 아니면 합계에 대한 비율로 나눔' : ''}. 0이거나 빈 평형은 짓지 않는 것으로 봅니다. 임대는 위 임대 비율만큼 49㎡형으로 따로 셈.</p>`;
}
// 개략 건축계획 결과 → 공통 구역(JbsSite.applyUrbanPlan) → 교통성·환경성·높이경관 검토서(?urban=키&make=1)
function handoffReady() { const z = Z.zones[S.region]; return !!(D.map && z && z.geojson && z.roads && INFRA.ready(S.region)); }
function handoffPlan(a) {
  const pl = plan(a), z = Z.zones[S.region] || {}, e = pl.infra && pl.infra.entry;
  const role = r => e && e.e1 && r.pnu === e.e1.pnu ? '진입도로' : e && e.mode === 3 && e.e2 && r.pnu === e.e2.pnu ? '두 번째 진입도로' : '주변 도로';
  const roads = ((z.roads && z.roads.edge) || []).map(r => { const p = (e && e.per[r.pnu]) || {}; return { pnu: r.pnu, jibun: r.jibun, w: r.w, pw: p.pw || r.w, role: role(r), dec: r.dec || '', partial: !!p.partial }; });
  const retail = pl.gfa - num(pl.U.resArea);
  return Object.assign({ units: pl.units, byType: pl.byType, far: pl.farUse, bcr: P.bcr, floors: pl.floorsTower, towers: pl.towers, gfa: pl.gfa, roads }, retail > 1 ? { retailGFA: retail } : {});
}
function handoff(a, tool) {
  if (!handoffReady()) { toast('구역계와 주변 도로를 먼저 불러오세요', 2500); return; }
  if (!window.JbsSite) { toast('공통 구역 저장 기능을 불러오지 못했습니다 — 새로고침해 보세요', 2500); return; }
  saveZ();
  if (!JbsSite.applyUrbanPlan(S.region, handoffPlan(a))) { toast('검토서로 넘기지 못했습니다(구역계 저장 확인)', 2500); return; }
  location.href = `../${tool}/?urban=${encodeURIComponent(S.region)}&make=1`;
}
function handoffSection() {
  const ok = handoffReady(), dis = ok ? '' : 'disabled';
  return `<h3>검토서로 넘기기</h3>
  <div class="zk-btns"><button type="button" class="btn" data-handoff="traffic" ${dis}>교통성 검토서로 →</button><button type="button" class="btn" data-handoff="env" ${dis}>환경성 검토서로 →</button><button type="button" class="btn" data-handoff="landscape" ${dis}>높이·경관계획으로 →</button></div>
  <p class="hint">${ok ? '지금 정비계획·개략 건축계획 값(세대수·평형·용적률·층수·도로 계획 폭)이 검토서로 넘어갑니다. 동 배치·일조·3D까지 보려면 /arch(자세한 배치)에서 확정하세요.' : '구역계와 주변 도로를 먼저 불러오세요(지도에서 그린 안, 정비계획 탭에서 주변 도로 확인 후).'}</p>`;
}
