'use strict';
// /traffic 교통성 검토서 — 입력 칸과 검토서 문장. 계산은 traffic-calc.js, 숫자는 shared/criteria/traffic.json
ReviewUI.start({
  tool: 'traffic', title: '교통성 검토서',
  criteriaUrl: '../shared/criteria/traffic.json', templatesUrl: '../shared/templates/traffic_ko.json',
  roads: true,
  groups: [
    { title: '대중교통', fields: [
      { k: 'station', label: '최근접 도시철도역', ph: '예: 숭의역' },
      { k: 'stationDist', label: '역까지 거리 m', num: true },
      { k: 'bus', label: '반경 500m 버스정류장 수', num: true },
    ] },
    { title: '주차·연면적', fields: [
      { k: 'units60below', label: '전용 60㎡ 이하 세대수', num: true },
      { k: 'area85below', label: '전용 85㎡ 이하 전용면적 합계 ㎡', num: true },
      { k: 'area85above', label: '전용 85㎡ 초과 전용면적 합계 ㎡', num: true },
      { k: 'aptGFA', label: '아파트 건축 연면적 ㎡', num: true },
      { k: 'retailGFA', label: '근린생활시설 연면적 ㎡', num: true },
      { k: 'parkPlan', label: '계획 주차대수', num: true },
    ], note: '전용면적 합계를 모르면 비워 두세요. 세대당 최저 기준으로만 주차대수를 계산합니다.' },
  ],
  build({ p, C, T, site, h }) {
    const { esc, fmt, T: t, badge, chk, num, TYPES } = h;
    const r = TrafficCalc.run(C, T, p);
    const roads = (p.roads || []).filter(x => x.name || x.w);
    const f = s => s.replace(/\{(\w+)\}/g, (m, k) => ({ name: site.name }[k] ?? '○○'));
    const ar = r.access, pk = r.parking, ti = r.tia, tr = r.trips;
    const parkJudge = pk.legal === null || num(p.parkPlan) === null ? '○○' : (+p.parkPlan >= pk.legal ? '충족' : '미충족');

    const html = `
    <h2>1. 검토 개요</h2>
    <p>${esc(f(T.purpose))}</p>
    <table><tr><th style="width:120px">법적 근거</th><td>「도시 및 주거환경정비법」 제9조(정비계획의 내용) — 정비기반시설 및 교통 관련 계획, 「도시교통정비 촉진법」 제15조(교통영향평가 대상), 「주택건설기준 등에 관한 규정」 제25조(진입도로)·제27조(주차장)</td></tr>
    <tr><th>공간적 범위</th><td>${esc(T.scope_space)}</td></tr>
    <tr><th>시간적 범위</th><td>${esc(T.scope_time)}${num(p.year) ? ` (${esc(p.year)}년)` : ' (○○년)'}</td></tr>
    <tr><th>검토 방법</th><td>${esc(T.method)}</td></tr></table>

    <h2>2. 대상지 현황</h2>
    <table><tr><th style="width:120px">사업 유형</th><td>${t(TYPES[p.type])}</td><th style="width:110px">위치</th><td>${t(p.loc)}</td></tr>
    <tr><th>구역면적</th><td>${fmt(p.siteArea, 1)}㎡</td><th>용도지역</th><td>${t(p.zoning)}</td></tr>
    <tr><th>계획 세대수</th><td>${fmt(p.units)}세대</td><th>용적률 / 건폐율</th><td>${fmt(p.far, 2)}% / ${fmt(p.bcr, 2)}%</td></tr>
    <tr><th>최고층수</th><td>${fmt(p.floors)}층</td><th>근생 연면적</th><td>${fmt(p.retailGFA)}㎡</td></tr>
    <tr><th>계획값 출처</th><td colspan="3">${t(site.v.planFrom || (site.arch && site.arch.chosen ? '/arch 확정안' : ''))}</td></tr></table>

    <h2>3. 교통 현황</h2>
    <p><b>가. 접도 도로</b>${site.v.roadsFrom ? ` <span class="note">(${esc(site.v.roadsFrom)} — 현장·도로대장 확인 필요)</span>` : ''}</p>
    <table><tr><th>도로명</th><th>현황 폭(m)</th><th>계획 폭(m)</th><th>규모(계획)</th><th>위계</th><th>비고</th></tr>${roads.length ? roads.map(x => `<tr><td>${t(x.name)}${x.role && x.role !== '주변 도로' ? ` <span class="note">(${esc(x.role)})</span>` : ''}</td><td>${fmt(x.w, 1)}</td><td>${num(x.pw) !== null && +x.pw > +x.w ? fmt(x.pw, 1) + ' <span class="note">(확폭)</span>' : '현황 유지'}</td><td>${t(x.dec ? x.dec + '(도시계획도로 결정)' : x.scale)}</td><td>${t(x.level)}${x.levelAuto ? ' <span class="note">(추정)</span>' : ''}</td><td>${+x.w < 4 && !(+x.pw >= 4) ? '폭 4m 미만 — 진입도로로 볼 수 없음' : x.partial ? '구역에 짧게 닿음 — 부분 확폭 주의' : ''}</td></tr>`).join('') : '<tr><td>○○</td><td>○○</td><td>○○</td><td>○○</td><td>○○</td><td></td></tr>'}</table>
    <p class="note">규모는 도시·군계획시설의 결정·구조 및 설치기준에 관한 규칙 제9조의 폭 구분, 위계(추정)는 규모로 붙인 개략값입니다. 도로 기능 분류는 도시계획 결정 내용으로 확인합니다.</p>
    <p><b>나. 대중교통</b> 최근접 도시철도역은 ${t(p.station)}(구역 경계에서 약 ${fmt(p.stationDist)}m)이며, 구역 경계 반경 500m 안 버스정류장은 ${fmt(p.bus)}개소이다.${num(p.stationDist) !== null ? (+p.stationDist <= 500 ? ' 역세권(500m) 안에 든다.' : +p.stationDist <= 1000 ? ' 역에서 500m~1km 거리로 2차 역세권에 해당한다.' : ' 역세권(1km) 밖이다.') : ''}</p>
    ${site.v.transitNote ? `<p class="note">${esc(site.v.transitNote)} — 정류장 수는 양방향을 각각 셈, 현장 확인 필요</p>` : ''}
    <p><b>다. 보행·주차</b> 현장 조사 후 기재(보도 유무·폭, 노상주차 현황, 통학로).</p>

    <h2>4. 장래 교통수요</h2>
    <p>${esc(tr.formula)}</p>
    <p>첨두시 발생교통량(승용차, 유입+유출): 오후 ${tr.value === null ? '○○' : fmt(tr.value) + '대/시'}${tr.am != null ? `, 오전 ${fmt(tr.am)}대/시` : ''}${tr.retail ? ` (근생 ${fmt(tr.retail)}대/시 포함)` : ''}${chk(tr.unconfirmed)}</p>
    ${tr.parts ? `<table><tr><th>구성</th><th>값</th><th>출처</th></tr>
    <tr><td>상주 활동인구 원단위</td><td>${tr.parts.상주_활동인구_인per세대.값}인/세대 (${esc(tr.parts.상주_활동인구_인per세대.범위)})</td><td rowspan="2">국토교통부 교통영향평가정보 공공데이터(2015년 이후 아파트 조사 집계)</td></tr>
    <tr><td>첨두 유출입률</td><td>오전 ${(tr.parts.첨두_유출입률.오전 * 100).toFixed(1)}% · 오후 ${(tr.parts.첨두_유출입률.오후 * 100).toFixed(1)}%</td></tr>
    <tr><td>승용차 분담률</td><td>${(tr.parts.승용차_수단분담률.값 * 100).toFixed(1)}%</td><td>${esc(tr.parts.승용차_수단분담률.출처)}</td></tr>
    <tr><td>재차인원</td><td>${tr.parts.재차인원.값}인/대</td><td>${esc(tr.parts.재차인원.출처)}</td></tr></table>` : ''}
    <p class="note">원단위 근거: ${esc(tr.basis)}. ${esc(tr.rateNote || '')} 방향별 분포·배정은 개략 배치 확정 후 진출입구 위치 기준으로 2차 검토한다.</p>

    <h2>5. 교통영향 분석</h2>
    <p><b>가. 진입도로 폭</b> ${badge(ar.result)}</p>
    <table><tr><th style="width:200px">기준(세대수 ${fmt(p.units)}세대)</th><td>단일 진입도로 ${ar.required ?? '○○'}m 이상, 또는 폭 4m 이상 2개 진입도로 합계 ${ar.requiredSum ?? '○○'}m 이상</td></tr>
    <tr><th>현황·계획</th><td>${ar.roads.some(r => r.planned) ? '정비계획 확폭 반영 후 ' : ''}최대 접도 폭 ${ar.maxW ?? '○○'}m${ar.sum2 !== null && ar.sum2 !== undefined ? `, 상위 2개 합계 ${fmt(ar.sum2, 1)}m` : ''}</td></tr>
    <tr><th>근거</th><td>${esc(ar.basis)}, ${esc(ar.basisDual || '')}<br><span class="note">${esc(ar.noteDual || '')}</span></td></tr></table>
    <p><b>나. 주차</b> 법정 주차대수 ${pk.legal === null ? '○○' : fmt(pk.legal) + '대'}${pk.partial ? ' (전용면적 합계 미입력 — 세대당 최저 기준만 적용)' : ''}, 계획 ${fmt(p.parkPlan)}대 ${badge(parkJudge)}${chk(pk.unconfirmed)}</p>
    ${pk.retail ? `<p class="note">주택 ${fmt(pk.housing)}대 + 근린생활시설 ${fmt(pk.retail)}대(${esc(pk.retailBasis)})</p>` : ''}
    <p class="note">산식: ${esc(pk.formula)}<br>근거: ${esc(pk.basis)}. ${esc(pk.note)}</p>

    <h2>6. 교통영향평가 대상 여부</h2>
    <p>${badge(ti.result)}${chk(ti.unconfirmed)}</p>
    <table><tr><th style="width:120px">판정 기준</th><td>${ti.threshold ? `${esc(ti.unit)} ${fmt(ti.threshold)}㎡ 이상` : '○○'}</td></tr>
    <tr><th>계획 규모</th><td>${esc(ti.unit)} ${fmt(ti.value, 1)}㎡</td></tr>
    <tr><th>근거</th><td>${esc(ti.basis)}</td></tr>
    ${ti.result === '대상' ? `<tr><th>제출 시기</th><td>${esc(ti.when)}</td></tr>` : ''}</table>
    <p class="note">시·도 조례로 별표 1 규모의 100분의 50 이상 범위에서 대상을 달리 정할 수 있으나(같은 법 제15조제4항, 시행령 제13조의2제7항) 인천광역시는 대상 규모를 따로 정한 조례가 없어 별표 1 규모를 그대로 적용한다.</p>

    <h2>7. 교통처리계획 및 개선방안</h2>
    <ol>${r.list.map(s => `<li>${esc(s)}</li>`).join('')}</ol>

    <h2>8. 종합 의견 및 보완사항</h2>
    <p>진입도로 ${esc(ar.result)}, 법정 주차대수 ${pk.legal === null ? '○○' : fmt(pk.legal) + '대'}, 교통영향평가 ${esc(ti.result)}${(c => { const k = c.charCodeAt(0) - 0xAC00; return k >= 0 && k < 11172 && k % 28 && k % 28 !== 8 ? '으로' : '로'; })(String(ti.result).slice(-1))} 검토되었다. 본 초안은 공부·공개자료와 기준표에 따른 개략 검토이며, 다음 사항을 보완해야 한다.</p>
    <ul>${r.need.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    return { html, constraints: r.constraints };
  },
});
