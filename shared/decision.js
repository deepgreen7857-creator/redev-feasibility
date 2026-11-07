/* 정비계획 결정 도서(2026-11-07, 사용자 요구 '정비구역 지정 원스톱 — 정비계획 결정조서, 지구단위계획 결정조서도 동일하게 후단에 첨부',
   '교육환경평가·재해영향평가 등은 관련부서 협의의견 수렴 과정으로 갈음')
   구성: Ⅰ 정비구역 지정 및 정비계획 결정(도정법 제9조①) → Ⅱ 지구단위계획 결정(국토계획법 제52조①, 도정법 제17조 의제) → Ⅲ 관련부서 협의의견 및 조치계획 → Ⅳ 관련 도면
   표 형식은 실제 고시문(서울특별시고시 제2026-204호 정비구역 지정·정비계획 결정·지구단위계획 결정 고시)의 표 제목·열을 따름(2026-11-07 확인), 인천 고시 원문을 받으면 맞춰 고칠 것
   값은 공통 구역(JbsSite)의 /arch 확정안·토지이용(건축 불가 영역)·계획 도로·검토 결과·사업성 가정값(JbsFeas)에서 채우고, 모르는 칸은 '입력' 표시(화면에서 고쳐 저장)
   순수 계산 — 브라우저(window.JbsDecision)와 node(require) 둘 다. 화면은 decision/decision.js */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const fmt = (n, d = 0) => (n == null || n === '' || !isFinite(+n) ? '' : (+n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const IN = '(입력)';   // 사용자가 채울 칸
  const sumBy = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);

  /* ---------- 구역 → 숫자(m 좌표) ---------- */
  const ringOf = s => { const gj = s && s.geojson; const geo = gj && (gj.geometry || gj); if (!geo) return null; return geo.type === 'Polygon' ? geo.coordinates[0] : geo.type === 'MultiPolygon' ? geo.coordinates[0][0] : null; };
  function projector(ring) {
    const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length, lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    return p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
  }
  const areaXY = q => Math.abs(q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]; return a + p[0] * r[1] - r[0] * p[1]; }, 0) / 2);
  const typeOf = s => { const t = String(((s.plan || {}).type) || ((s.v || {}).type) || ''); return /recon|재건축/.test(t + (s.name || '')) ? 'recon' : /garo|가로/.test(t) ? 'garo' : 'redev'; };
  const TYPE_NAME = { redev: '주택재개발', recon: '주택재건축', garo: '가로주택정비' };
  const kindGroup = k => (/도로/.test(k) ? '도로' : /공원/.test(k) ? '공원' : /녹지/.test(k) ? '녹지' : /학교/.test(k) ? '학교' : /공공청사|청사/.test(k) ? '공공청사' : /종교/.test(k) ? '종교용지' : /공공공지/.test(k) ? '공공공지' : /광장/.test(k) ? '광장' : /주차/.test(k) ? '주차장' : '그 밖의 정비기반시설');
  const INFRA = ['도로', '공원', '녹지', '공공공지', '광장', '주차장', '그 밖의 정비기반시설'];   // 도정법 제2조제4호·영 제3조 — 학교·공공청사·종교용지는 정비기반시설 아님

  function facts(site, opt) {
    opt = opt || {};
    const ring = ringOf(site), pr = ring ? projector(ring) : null, ch = (site.arch || {}).chosen || null, v = site.v || {};
    const zoneA = ring ? areaXY(ring.map(pr)) : (+v.siteArea || 0);
    const land = {}; ((site.arch || {}).exclude || []).forEach((q, i) => { if (!pr) return; const k = kindGroup(((site.arch || {}).exKinds || [])[i] || ''); land[k] = (land[k] || 0) + areaXY(q.map(pr)); });
    const lot = ch && ch.lot ? +ch.lot : (zoneA ? zoneA - sumBy(Object.values(land), x => x) : 0);
    const placed = sumBy(Object.values(land), x => x), rest = zoneA - lot - placed;   // 위치 없이 비율로만 잡은 기반시설
    if (rest > zoneA * 0.003) land['정비기반시설(위치 미정)'] = (land['정비기반시설(위치 미정)'] || 0) + rest;
    const tp = typeOf(site), name = opt.name || site.name || '정비사업';
    const fullName = /정비사업|재개발|재건축/.test(name) ? name : `${name} ${TYPE_NAME[tp]}정비사업`;
    return { ring, pr, ch, v, zoneA, land, lot, tp, fullName, zoning: (site.profile || {}).zoning || v.zoning || '', site };
  }

  /* ---------- 분담금 추산(도정법 제9조①2의2) — JbsFeas.money ---------- */
  function shares(F, FE, A) {
    if (!F.ch || !FE) return null;
    A = A || FE.get();
    const q = F.site.quick || {}, units = +F.ch.units || 0, members = +q.members || Math.round(units * 0.5);
    const prior = +q.prior || 0;   // 만원
    const rental = Math.round(units * (+A.rentRatio || 0) / 100);
    const run = A2 => FE.money({ byType: F.ch.byType, supply: F.ch.supply, rental, members, prior, farArea: F.ch.gfa, resArea: F.ch.gfa, lotArea: F.lot, owners: members }, A2);
    const base = run(A);
    const vary = [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]].map(([dc, dp]) => { const A2 = Object.assign({}, A, { conPrice: A.conPrice * (1 + dc / 100), generalPrice: A.generalPrice * (1 + dp / 100) }); const r = run(A2); return { dc, dp, ratio: r.ratio }; });
    return { A, base, vary, members, prior, rental };
  }

  /* ---------- 표 만들기 ---------- */
  // 표 = { id, no, title, cols: [제목 또는 [제목, [하위…]]], rows: [[칸…]], note }
  function build(site, opt) {
    opt = opt || {};
    const F = facts(site, opt), ch = F.ch, c = site.constraints || {}, za = F.zoneA, P = (site.arch || {}).params || {};
    const loc = opt.location || IN, pct = a => (za ? fmt(a / za * 100, 1) : '');
    const recon = F.tp === 'recon';
    const I = [], II = [], III = [];

    I.push({ id: 'name', no: '1', title: '정비사업의 명칭', cols: ['구분', '정비사업 명칭', '비고'], rows: [['신규', F.fullName, '']] });
    I.push({ id: 'zone', no: '2', title: '정비구역 지정조서', cols: ['구분', '정비사업 명칭', '위치', ['면적(㎡)', ['기정', '변경', '변경후']], '비고'],
      rows: [['신규', F.fullName, loc, '-', `증) ${fmt(za, 1)}`, fmt(za, 1), '']] });
    // 토지이용계획
    const lr = [], infraKinds = Object.keys(F.land).filter(k => INFRA.includes(k) || /위치 미정/.test(k)), other = Object.keys(F.land).filter(k => !infraKinds.includes(k));
    const infraSum = sumBy(infraKinds, k => F.land[k]), otherSum = sumBy(other, k => F.land[k]);
    lr.push(['합계', '', fmt(za, 1), '100.0', '']);
    lr.push(['정비기반시설 등', '소계', fmt(infraSum, 1), pct(infraSum), '']);
    infraKinds.forEach(k => lr.push(['', k, fmt(F.land[k], 1), pct(F.land[k]), /위치 미정/.test(k) ? '건축계획 기반시설 비율 가정 — 위치 확정 필요' : '']));
    if (other.length) { lr.push(['그 밖의 시설', '소계', fmt(otherSum, 1), pct(otherSum), '정비기반시설 아님']); other.forEach(k => lr.push(['', k, fmt(F.land[k], 1), pct(F.land[k]), ''])); }
    lr.push(['획지', '획지1(공동주택 및 부대복리시설)', fmt(F.lot, 1), pct(F.lot), '']);
    I.push({ id: 'landuse', no: '3', title: '토지이용계획', cols: ['구분', '명칭', '면적(㎡)', '비율(%)', '비고'], rows: lr });
    // 용도지역
    const zRows = [['1', loc, IN, F.zoning || IN, fmt(za, 1), ch ? fmt(ch.far, 1) : IN, IN]];
    I.push({ id: 'zoning', no: '4', title: '용도지역 결정(변경)조서', cols: ['도면표시번호', '위치', '현황 용도지역', '계획 용도지역', '면적(㎡)', '용적률(%)', '결정(변경) 사유'], rows: zRows, note: '현황과 계획 용도지역이 같으면 이 표는 "변경 없음"으로 적습니다.' });
    // 분담금 추산
    const SH = shares(F, opt.feas, opt.assume);
    if (SH && isFinite(SH.base.ratio)) {
      const b = SH.base, A = SH.A, man = x => fmt(x / 10000, 1);   // 만원 → 억원
      const rows = [['총수입', '', man(b.rev), '억원', '분양 수입(조합원·일반·임대·상가)'], ['총지출', '', man(b.cost), '억원', `공사비 ${man(b.construction)}억 + 기타 사업비 ${man(b.etc)}억`], ['종전자산 추정액', '', man(b.prior), '억원', '조합원 종전자산(감정평가 전 추정)'], ['추정비례율', '(총수입 − 총지출) ÷ 종전자산 × 100', fmt(b.ratio, 1), '%', '']];
      I.push({ id: 'share1', no: '5', title: '토지등소유자 유형별 분담금 추산액 및 산출근거 — 가. 추정비례율', cols: ['구분', '산식', '금액', '단위', '비고'], rows });
      const avgRight = b.right;   // 만원(조합원 1인 평균 권리가액)
      const sr = b.types.filter(t => b.mem[t] > 0).map(t => { const a = b.memberPrice * b.sup(t) / 3.305785; return [`전용 ${t}㎡형`, fmt(b.sup(t), 1), fmt(a, 0), fmt(avgRight, 0), fmt(a - avgRight, 0), (a - avgRight) < 0 ? '환급' : '']; });
      I.push({ id: 'share2', no: '', title: '나. 유형별 추정분담금(조합원 1인 평균 권리가액 기준)', cols: ['유형(분양 주택)', '공급면적(㎡)', '권리자 분양가 추정액(a, 만원)', '추정 권리가액(b, 만원)', '추정분담금(a−b, 만원)', '비고'], rows: sr,
        note: `조합원 분양가 = 일반분양가 ${fmt(A.generalPrice)}만원/평 × ${fmt(A.memberRatio)}%, 추정 권리가액 = 종전자산 ÷ 조합원 ${fmt(SH.members)}명 × 추정비례율. 개인별 분담금은 종전자산 감정평가 후 관리처분계획에서 정해지며 인허가 및 심의 과정에서 변동될 수 있습니다.` });
      I.push({ id: 'share3', no: '', title: '다. 공사비·분양가 변동에 따른 비례율 변동', cols: ['공사비 변동', '분양가 변동', '추정비례율(%)'], rows: SH.vary.map(x => [`${x.dc > 0 ? '+' : ''}${x.dc}%`, `${x.dp > 0 ? '+' : ''}${x.dp}%`, fmt(x.ratio, 1)]) });
    } else {
      I.push({ id: 'share1', no: '5', title: '토지등소유자 유형별 분담금 추산액 및 산출근거', cols: ['구분', '내용', '비고'], rows: [['산출 불가', '건축계획 확정안과 종전자산 추정액(사업성 화면 [1차 재검토로 넘기기])이 있어야 계산됩니다', IN]] });
    }
    // 도시계획시설
    const roads = (F.v.roads || []).filter(r => r.pw && +r.pw > +r.w);
    const rr = roads.map(r => ['변경', r.dec || IN, IN, IN, fmt(r.pw, 1), r.role === '진입도로' ? '진입도로(국지도로)' : '국지도로', IN, IN, IN, '일반도로', r.name, IN, `현황 ${fmt(r.w, 1)}m → ${fmt(r.pw, 1)}m 확폭`]);
    if (F.land['도로']) rr.push(['신설', IN, IN, IN, IN, '단지 내·구역 내 도로', IN, IN, IN, '일반도로', '구역 내', IN, `면적 ${fmt(F.land['도로'], 1)}㎡`]);
    if (!rr.length) rr.push(['해당 없음', '', '', '', '', '', '', '', '', '', '', '', '']);
    I.push({ id: 'facRoad', no: '6', title: '도시계획시설 결정(변경)조서 — 가. 도로', cols: ['구분', ['규모', ['등급', '류별', '번호', '폭원(m)']], '기능', '연장(m)', '기점', '종점', '사용형태', '주요 경과지', '최초 결정일', '비고'], rows: rr });
    const fac = ['공원', '녹지', '공공공지', '광장', '주차장'].filter(k => F.land[k]);
    const fr = fac.map((k, i) => ['신설', String(i + 1), k, loc, '-', `증) ${fmt(F.land[k], 1)}`, fmt(F.land[k], 1), '-', '']);
    I.push({ id: 'facOther', no: '', title: '나. 공원·녹지·공공공지 등', cols: ['구분', '도면표시번호', '시설명', '위치', ['면적(㎡)', ['기정', '증감', '변경']], '최초 결정일', '비고'], rows: fr.length ? fr : [['해당 없음', '', '', '', '', '', '', '', '']] });
    I.push({ id: 'common', no: '7', title: '공동이용시설 설치계획', cols: ['구분', '시설명', '위치', '면적(㎡)', '비고'], rows: [['신설', IN, '획지1', IN, '놀이터·마을회관·공동작업장 등(도정법 제2조제5호)']] });
    // 건축물
    const units = ch ? +ch.units : 0;
    I.push({ id: 'bldExist', no: '8', title: '건축물의 정비·개량 및 건축시설 계획 — 가. 기존 건축물 정비·개량 계획', cols: ['구역구분', '가구 또는 획지 구분', '위치', ['정비개량계획(동)', ['계', '존치', '철거후 신축']], '비고'], rows: [['정비구역', '획지1', loc, IN, '0', IN, '']] });
    I.push({ id: 'bldPlan', no: '', title: '나. 획지 및 건축물', cols: ['구분', '주된 용도', '건폐율(%)', '용적률(%)', '높이(층)', '건축선 등', '기타사항'],
      rows: [['획지1', '공동주택 및 부대복리시설', ch ? `${fmt(ch.bcr, 1)} 이하` : IN, ch ? `${fmt(ch.far, 1)} 이하` : IN, ch ? `최고 ${fmt(ch.maxFloors)}층(${fmt(ch.maxHeight, 1)}m) 이하` : IN, '지구단위계획 결정조서 참조', ch ? `${fmt(units)}세대` : '']] });
    const fr2 = [['계획', F.v.farBase || IN, F.v.farAllow || IN, F.v.farMax || IN, ch ? fmt(ch.far, 1) : IN, '인천 2030 정비기본계획(고시 제2026-96호) 용적률 체계']];
    I.push({ id: 'far', no: '', title: '다. 용적률 계획', cols: ['구분', '기준용적률(%)', '허용용적률(%)', '상한용적률(%)', '계획 용적률(%)', '비고'], rows: fr2 });
    if (SH) I.push({ id: 'rental', no: '', title: '라. 임대주택 건설계획', cols: ['구분', '세대 규모(전용 ㎡)', '세대수', '비율(%)', '비고'], rows: [[recon ? '공공임대(용적률 완화분)' : '재개발 의무 임대주택', '49', fmt(SH.rental), units ? fmt(SH.rental / units * 100, 1) : '', `임대주택 비율 ${fmt(SH.A.rentRatio)}%(인천광역시고시 제2018-251호)`]] });
    // 주택 규모별
    if (ch && ch.byType) {
      const bt = ch.byType, ks = Object.keys(bt).filter(k => bt[k] > 0).sort((a, b) => a - b), rent = SH ? SH.base.rent : {};
      const rows = ks.map(k => [`${k}㎡형`, fmt(bt[k]), fmt(bt[k] - (rent[k] || 0)), fmt(rent[k] || 0), fmt(bt[k] / units * 100, 1)]);
      const u85 = sumBy(ks.filter(k => +k <= 85), k => bt[k]);
      rows.push(['계', fmt(units), fmt(units - (SH ? SH.base.rentU : 0)), fmt(SH ? SH.base.rentU : 0), '100.0']);
      I.push({ id: 'size', no: '9', title: '주택의 규모 및 건설비율', cols: ['전용면적', '계(세대)', '분양', '임대', '비율(%)'], rows, note: `전용 85㎡ 이하 ${fmt(u85)}세대(${fmt(u85 / units * 100, 1)}%)` });
    } else I.push({ id: 'size', no: '9', title: '주택의 규모 및 건설비율', cols: ['전용면적', '계(세대)', '분양', '임대', '비율(%)'], rows: [[IN, IN, IN, IN, IN]] });
    // 환경보전·재난방지 — 관련부서 협의의견으로 갈음
    const env = [];
    if (c.env) { if ((c.env.소음_검토_도로 || []).length) env.push(['소음', `${c.env.소음_검토_도로.join(', ')} 쪽 주동 이격·차음 계획`, '환경 부서 협의']); if (c.env.북측_일조_높이제한) env.push(['일조', '북측 주거지 일조 확보(정북 방향 높이 제한)', '']); }
    env.push(['재난방지', '재해영향 검토는 관련부서(재난·안전, 하수) 협의의견으로 갈음 — Ⅲ 협의의견 조치계획 반영', '']);
    env.push(['환경보전', '환경 관련부서 협의의견 반영 — Ⅲ 협의의견 조치계획 참조', '']);
    I.push({ id: 'env', no: '10', title: '환경보전 및 재난방지에 관한 계획', cols: ['구분', '계획 내용', '비고'], rows: env });
    I.push({ id: 'edu', no: '11', title: '정비구역 주변의 교육환경 보호에 관한 계획', cols: ['정비구역 주변 현황', '교육환경 보호에 관한 계획', '비고'], rows: [[IN, '관할 교육지원청 협의의견 반영(교육환경평가는 협의의견 수렴으로 갈음) — Ⅲ 참조', '']] });
    I.push({ id: 'tenant', no: '12', title: '세입자 주거대책', cols: ['구분', '대책', '비고'],
      rows: recon ? [['임차인', '재건축사업 — 임차인 이주·보호 대책(사업시행계획에서 구체화)', IN]] : [['주거 세입자', '재개발 의무 임대주택 입주 자격 부여, 주거이전비 지급(토지보상법 시행규칙 제54조)', ''], ['상가 세입자', '영업손실 보상', '']] });
    I.push({ id: 'sched', no: '13', title: '정비사업 시행계획', cols: ['시행 방법', '시행 예정 시기', '사업시행 예정자', '증가 예상 세대수', '비고'], rows: [[recon ? '관리처분계획 방식(재건축)' : '관리처분계획 방식(재개발)', IN, '조합(설립 예정)', ch ? `${fmt(units)}세대 − 기존 ${IN}` : IN, '']] });
    I.push({ id: 'block', no: '14', title: '가구 및 획지에 관한 계획', cols: ['구분', '가구 면적(㎡)', ['획지', ['명칭', '위치', '면적(㎡)']], '비고'], rows: [['가구1', fmt(F.lot, 1), '획지1', loc, fmt(F.lot, 1), '']] });

    // Ⅱ 지구단위계획
    const dName = `${F.fullName.replace(/\s*(주택)?(재개발|재건축|가로주택)?정비사업$/, '')} 지구단위계획구역`;
    II.push({ id: 'dz', no: '1', title: '지구단위계획구역 결정조서', cols: ['구분', '구역명', '위치', ['면적(㎡)', ['기정', '변경', '변경후']], '비고'], rows: [['신규', dName, loc, '-', `증) ${fmt(za, 1)}`, fmt(za, 1), '도정법 제17조 — 정비구역 지정 고시로 지구단위계획구역 결정 의제']] });
    II.push({ id: 'dzoning', no: '2', title: '토지이용 및 시설에 관한 결정 — 가. 용도지역', ref: 'zoning', cols: ['구분', '내용'], rows: [['용도지역 결정(변경)조서', 'Ⅰ-4 용도지역 결정(변경)조서와 같음']] });
    II.push({ id: 'dfac', no: '', title: '나. 도시계획시설', ref: 'facRoad', cols: ['구분', '내용'], rows: [['도시계획시설 결정(변경)조서', 'Ⅰ-6 도시계획시설 결정(변경)조서와 같음']] });
    II.push({ id: 'dblock', no: '3', title: '획지 및 건축물 등에 관한 결정 — 가. 가구 및 획지', cols: ['구분', '가구 면적(㎡)', '획지', '비고'], rows: [['가구1', fmt(F.lot, 1), `획지1(${fmt(F.lot, 1)}㎡)`, '']] });
    II.push({ id: 'duse', no: '', title: '나. 건축물의 용도', cols: ['구분', '가구', '용도', '비고'], rows: [['허용용도', '가구1', '공동주택 및 부대복리시설, 제1·2종 근린생활시설(단지 내 상가)', ''], ['불허용도', '가구1', IN, '']] });
    II.push({ id: 'ddensity', no: '', title: '다. 건축물의 개발밀도 — 건폐율·용적률', cols: ['구분', '가구', '용도지역', '건폐율(%)', '기준용적률(%)', '허용용적률(%)', '상한용적률(%)', '비고'],
      rows: [['획지1', '가구1', F.zoning || IN, ch ? `${fmt(ch.bcr, 1)} 이하` : IN, F.v.farBase || IN, F.v.farAllow || IN, ch ? `${fmt(ch.far, 1)} 이하` : (F.v.farMax || IN), '']] });
    const hRows = [['획지1', '가구1', '전 지역', ch ? `최고 ${fmt(ch.maxFloors)}층, ${fmt(ch.maxHeight, 1)}m 이하` : IN, '']];
    const ls = c.landscape || {};
    if ((ls.경계부_층수_점감_대상동 || []).length || ls.층수_점감_검토) hRows.push(['획지1', '가구1', '구역 경계부(경계에서 30m 안)', P.lowCap ? `${P.lowCap}층 이하` : IN, '경관 검토 — 주변 저층 주거지 대비 층수 점감']);
    II.push({ id: 'dheight', no: '', title: '라. 건축물의 높이', cols: ['구분', '가구', '지역', '높이', '비고'], rows: hRows });
    const sb = [];
    if (P.roadSb) sb.push(['건축한계선', '도로변', `도로경계선에서 ${P.roadSb}m 후퇴`, '']);
    if (P.artSb) sb.push(['건축한계선', '간선도로변', `도로경계선에서 ${P.artSb}m 후퇴`, '']);
    if (!sb.length) sb.push(['건축한계선', IN, IN, '']);
    II.push({ id: 'dline', no: '', title: '마. 건축물의 건축선', cols: ['구분', '적용 위치', '계획 내용', '비고'], rows: sb });
    const etc = [['대지 안의 공지', '도로변 건축한계선 후퇴 부분', '보도형 전면공지로 조성(담장·시설물 설치 금지)', IN]];
    if (+P.axisN > 0) etc.push(['통경축', `${({ 0: '남북', 90: '동서', 45: '북동–남서', 135: '북서–남동' })[+P.axisB || 0] || ''} 방향`, `폭 ${P.axisW || 20}m 이상 ${P.axisN}개소 건축물 배치 금지`, `경관 검토${ls.통경축_개방률_퍼센트 != null ? ` — 지난 안 개방률 ${fmt(ls.통경축_개방률_퍼센트, 1)}%` : ''}`]);
    II.push({ id: 'detc', no: '', title: '바. 기타사항(대지 안의 공지·통경축 등)', cols: ['구분', '적용 위치', '계획 내용', '비고'], rows: etc });
    II.push({ id: 'dscape', no: '', title: '사. 경관계획', cols: ['구분', '계획 내용', '비고'], rows: [['스카이라인', ls.통경축_개방률_퍼센트 != null ? '경계부 층수 점감, 주동 높이 변화로 스카이라인 형성' : IN, '경관 검토(/landscape) 반영'], ['색채·형태', IN, '경관 관련부서 협의의견 반영']] });
    if (SH) II.push({ id: 'drental', no: '', title: '아. 임대주택 건설에 관한 결정', ref: 'rental', cols: ['구분', '내용'], rows: [['임대주택', 'Ⅰ-8 라. 임대주택 건설계획과 같음']] });

    // Ⅲ 관련부서 협의의견 및 조치계획(교육환경평가·재해영향평가 등은 협의의견 수렴으로 갈음 — 사용자 결정 2026-11-07)
    const D = opt.depts || DEPTS;
    III.push({ id: 'consult', no: '1', title: '관련부서 협의의견 및 조치계획', cols: ['협의 부서', '협의 사항', '협의 의견', '조치계획(반영 여부)', '비고'],
      rows: D.filter(d => !d.when || d.when(F)).map(d => [d.부서, d.사항, IN, IN, d.비고 || '']) });
    return { F, parts: [{ no: 'Ⅰ', title: '정비구역 지정 및 정비계획 결정', tables: I }, { no: 'Ⅱ', title: '지구단위계획에 관한 결정', tables: II }, { no: 'Ⅲ', title: '관련부서 협의의견 및 조치계획', tables: III }], shares: SH, IN };
  }
  // 협의 부서 기본 목록(부서 이름은 구청마다 달라 화면에서 고침)
  const DEPTS = [
    { 부서: '관할 교육지원청', 사항: '정비구역 주변 교육환경 보호, 학교 수용·통학로', 비고: '교육환경평가 갈음' },
    { 부서: '재난·안전 부서', 사항: '재해 위험(침수·사면 등), 재해 저감 대책', 비고: '재해영향평가 갈음' },
    { 부서: '하수·치수 부서', 사항: '우수 처리, 저류시설, 하수관로 용량', 비고: '' },
    { 부서: '교통 부서', 사항: '진입도로·교통처리계획, 주차', 비고: '교통성 검토 반영', },
    { 부서: '환경 부서', 사항: '소음·대기·폐기물, 환경성 검토', 비고: '환경성 검토 반영' },
    { 부서: '공원녹지 부서', 사항: '공원·녹지 배치·규모, 조성 계획', 비고: '' },
    { 부서: '도로 부서', 사항: '도시계획도로 확폭·신설, 기부채납', 비고: '' },
    { 부서: '상수도사업본부', 사항: '상수도 공급 계획', 비고: '' },
    { 부서: '관할 소방서', 사항: '소방차 진입로·소방활동 공간', 비고: '' },
    { 부서: '건축·경관 부서', 사항: '건축선·높이·경관(통경축·스카이라인)', 비고: '경관 검토 반영' },
    { 부서: '주택 부서', 사항: '임대주택 건설·인수', 비고: '', when: F => F.tp !== 'recon' },
    { 부서: '재산·회계 부서', 사항: '국공유지 처분·정비기반시설 무상양도', 비고: '도정법 제97조' },
    { 부서: '국가유산 부서', 사항: '국가유산(문화재) 영향 여부', 비고: '해당 시' },
    { 부서: '관할 경찰서', 사항: '범죄예방 환경설계(CPTED)', 비고: '' },
  ];

  const api = { build, facts, shares, DEPTS, IN, ringOf, projector, areaXY, kindGroup };
  if (isNode) module.exports = api; else g.JbsDecision = api;
})(typeof window !== 'undefined' ? window : globalThis);
