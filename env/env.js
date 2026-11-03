'use strict';
// /env 환경성 검토서 — 계산은 env-calc.js, 숫자는 shared/criteria/environment.json
ReviewUI.start({
  tool: 'env', title: '환경성 검토서',
  criteriaUrl: '../shared/criteria/environment.json', templatesUrl: '../shared/templates/env_ko.json',
  roads: true,
  groups: [
    { title: '지형·토지이용', fields: [
      { k: 'urban', label: '도시지역 여부', select: { '예': '예', '아니오': '아니오' } },
      { k: 'greenArea', label: '구역 안 녹지지역 면적 ㎡', num: true },
      { k: 'slope', label: '평균경사도 %', num: true },
      { k: 'elevMax', label: '최고 표고 m', num: true },
      { k: 'elevMin', label: '최저 표고 m', num: true },
      { k: 'trees', label: '수목·녹지 현황', ph: '예: 북측 경사지 수림대' },
    ] },
    { title: '대기·소음·일조', fields: [
      { k: 'airStation', label: '최근접 대기측정소', ph: '예: 숭의동 측정소' },
      { k: 'airDist', label: '측정소까지 거리 m', num: true },
      { k: 'pm', label: '최근 연평균 PM10/PM2.5 ㎍/㎥', ph: '예: 38/20' },
      { k: 'northRes', label: '북측 인접 주거지', select: { '': '모름', '예': '예', '아니오': '아니오' } },
      { k: 'floorHeight', label: '층고 가정 m (일조 계산용)', num: true, ph: '3' },
    ] },
    { title: '문화유산·상위계획', fields: [
      { k: 'heritage', label: '최근접 국가유산', ph: '예: ○○향교' },
      { k: 'heritageDist', label: '국가유산까지 거리 m', num: true },
      { k: 'heritageGrade', label: '국가유산 지정 구분', select: { '': '국가지정', '시지정': '시지정' } },
      { k: 'upper', label: '상위계획(도시기본계획·정비기본계획) 관련 사항', ph: '예: 생활권 공원 확충 방향' },
    ] },
  ],
  build({ p, C, T, site, h }) {
    const { esc, fmt, T: t, badge, chk, TYPES } = h;
    const r = EnvCalc.run(C, T, p);
    const f = s => s.replace(/\{name\}/g, site.name || '○○');
    const e = r.eia, hr = r.heritage, n = r.noise, s = r.sun, sl = r.slope;
    const html = `
    <h2>1. 검토 개요</h2>
    <p>${esc(f(T.purpose))}</p>
    <table><tr><th style="width:120px">법적 근거</th><td>「도시 및 주거환경정비법」 제9조(정비계획의 내용 — 환경보전 관련 계획), 「환경영향평가법」 제9조·제22조·제43조, 「건축법」 제61조, 「주택건설기준 등에 관한 규정」 제9조</td></tr>
    <tr><th>검토 방법</th><td>${esc(T.method)}</td></tr></table>

    <h2>2. 대상지 현황</h2>
    <table><tr><th style="width:120px">사업 유형</th><td>${t(TYPES[p.type])}</td><th style="width:110px">위치</th><td>${t(p.loc)}</td></tr>
    <tr><th>구역면적</th><td>${fmt(p.siteArea, 1)}㎡</td><th>용도지역</th><td>${t(p.zoning)}</td></tr>
    <tr><th>계획 세대수</th><td>${fmt(p.units)}세대</td><th>최고층수</th><td>${fmt(p.floors)}층</td></tr></table>

    <h2>3. 지형·지질</h2>
    <p>표고 ${fmt(p.elevMin, 1)}m ~ ${fmt(p.elevMax, 1)}m, 평균경사도 ${fmt(p.slope, 1)}%${sl.deg !== null ? `(약 ${fmt(sl.deg, 1)}도)` : ''} (기준 ${sl.limit}도 미만) ${badge(sl.result)}${chk(sl.unconfirmed)}</p>
    <p class="note">근거: ${esc(sl.basis)}. ${esc(sl.note || '')}. 지질·지반은 사업시행계획 단계 지반조사로 확인.</p>

    <h2>4. 토지이용·녹지</h2>
    <p>도시지역 ${t(p.urban)}, 구역 안 녹지지역 ${fmt(p.greenArea)}㎡. 수목·녹지 현황: ${t(p.trees)}</p>

    <h2>5. 대기질</h2>
    <p>최근접 대기측정소 ${t(p.airStation)}(약 ${fmt(p.airDist)}m), 최근 연평균 미세먼지(PM10/PM2.5) ${t(p.pm)}㎍/㎥.</p>
    <p class="note">공사 중 비산먼지와 입주 후 교통량 증가에 따른 영향은 7장 저감방안으로 관리.</p>

    <h2>6. 소음·일조</h2>
    <p><b>가. 소음</b> ${badge(n.result)}${chk(n.unconfirmed)} — 공동주택 실외소음도 ${n.db}dB 미만 기준(${esc(n.basis)}). 도시지역은 6층 이상 부분에 창호를 닫은 실내소음도 ${n.indoor}dB 이하·환기설비를 모두 갖추면 실외 기준을 적용하지 않음. ${n.roads.length ? `검토 대상: ${esc(n.roads.map(x => `${x.name || '간선도로'}(${x.level})`).join(', '))}` : ''}</p>
    <p><b>나. 일조</b> ${badge(s.result)} — 정북방향 인접대지경계선으로부터 높이 10m 이하 부분 ${s.a}m 이상, 10m 초과 부분은 그 높이의 2분의 1 이상 이격(${esc(s.basis)}).
    ${s.apply && s.H !== null ? `최고 ${fmt(p.floors)}층(층고 ${s.fh}m 가정, 높이 약 ${fmt(s.H, 1)}m) 기준 최상부 이격 약 ${fmt(s.need, 1)}m.` : ''}</p>
    <p class="note">${esc(s.note)}</p>

    <h2>7. 문화유산</h2>
    <p>최근접 국가유산 ${t(hr.name)}${hr.dist !== null ? `(약 ${fmt(hr.dist)}m)` : ''} ${badge(hr.result)}${chk(hr.unconfirmed)} — 역사문화환경 보존지역 ${hr.radius}m 이내 기준(${esc(hr.basis)}).</p>
    <p class="note">${esc(hr.note || '')}</p>

    <h2>8. 상위계획 부합성</h2>
    <p>${t(p.upper)}</p>

    <h2>9. 영향평가 대상 여부</h2>
    <table><tr><th style="width:170px">환경영향평가·소규모 환경영향평가</th><td>${badge(e.result)}${chk(e.unconfirmed)}<br><span class="note">환경영향평가: 사업면적 ${fmt(e.eia.값)}㎡ 이상(${esc(e.eia.근거)}). 소규모: 도시지역 ${fmt(e.small.값)}㎡(녹지지역 ${fmt(e.small.녹지지역_값)}㎡) 이상, 정비구역 지정 시 지구단위계획 의제 포함(${esc(e.small.출처)}).</span>${e.when ? `<br>협의 시기: ${esc(e.when)}` : ''}</td></tr>
    <tr><th>전략환경영향평가</th><td>${badge(e.strategic.result)}${e.strategic.result === '기준확인필요' ? ' <span class="chk">※ 기준 확인 필요</span>' : ''}<br><span class="note">${esc(e.strategic.basis)}${e.strategic.when ? ` · 협의: ${esc(e.strategic.when)}` : ''}</span></td></tr></table>

    <h2>10. 환경 영향 저감방안 및 종합 의견</h2>
    <ol>${r.list.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <p>보완 필요사항:</p>
    <ul>${r.need.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return { html, constraints: r.constraints };
  },
});
