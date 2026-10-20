'use strict';

// =====================================================================
// 서식 자동 기입 + 사업성 검토표  (jbslab 정비구역 검토 모드)
//   - 입력: "구역 자료"(zone) 하나 -> 법정서식(별지 제4·5·6·9호)과 사업성 검토표를 엑셀로 만듦
//   - 모든 계산은 엑셀 수식으로 남김: 단가·배율 한 칸만 고쳐도 비례율·분담금이 따라 바뀜
//   - 개인정보(명부)는 이 브라우저 안에서만 처리하고 서버로 보내지 않음
//
// zone = {
//   name, location, baseYear,
//   parcels: [{ jibun, dong, jimok, ledgerArea, area(편입면적), zoning, jiga(원/㎡), ownerType, owners:[...] , note }],
//   owners:  [{ no, name, birth, addr, phone, parcels:[{jibun, ho, ownArea, inArea, share}], isPublic }]   (선택)
//   buildings: [{ jibun, use, structure, year, floorArea, units }]  (선택)
// }
// ownerType: '사유지' | '국유지' | '시유지' | '구유지' | '공공기관' | '기타'
// =====================================================================

const Forms = (() => {
  const PY = 3.305785;
  const PUBLIC = ['국유지', '시유지', '구유지', '도유지', '군유지', '국공유지'];
  const isPublic = t => PUBLIC.includes(t);
  // 정비기반시설 지목 (도로·공원·구거·하천·제방·철도·수도). 한 글자 부호와 전체 이름 모두
  const INFRA = ['도', '공', '구', '천', '제', '철', '수', '도로', '공원', '구거', '하천', '제방', '철도용지', '수도용지'];
  const isInfra = j => INFRA.includes(String(j || '').trim());
  // 구역면적 → 정비기반시설 → 건축 대지면적. 기반시설 지목 필지가 없으면 구역면적의 20%
  function netSite(parcels, infraM2) {
    const site = parcels.reduce((a, q) => a + (+q.area || 0), 0);
    const r2 = x => Math.round(x * 100) / 100;
    if (infraM2 != null && infraM2 !== '' && isFinite(+infraM2)) return { site, infra: r2(+infraM2), net: r2(Math.max(0, site - +infraM2)), basis: '입력값' };
    const ls = parcels.filter(q => isInfra(q.jimok));
    const sum = ls.reduce((a, q) => a + (+q.area || 0), 0);
    const infra = sum > 0 ? Math.min(sum, site) : site * 0.2;
    return { site, infra: r2(infra), net: r2(Math.max(0, site - infra)), count: ls.length,
      basis: sum > 0 ? `지목 도로·공원 등 ${ls.length}필지 합계` : '지목 도로 등 필지가 없어 구역면적의 20%(추정)' };
  }

  // ---------- 시트 도우미 ----------
  const A1 = (r, c) => XLSX.utils.encode_cell({ r, c });            // 0-based
  function Sheet() {
    const ws = {}; let maxR = 0, maxC = 0;
    const api = {
      ws,
      set(r, c, v, z) {
        if (v === undefined || v === null || v === '') return api;
        let cell;
        if (typeof v === 'object' && v.f) cell = { t: 'n', f: v.f.replace(/^=/, '') };
        else if (typeof v === 'number') cell = { t: 'n', v };
        else cell = { t: 's', v: String(v) };
        if (z) cell.z = z;
        else if (cell.t === 'n') cell.z = '#,##0.##';
        ws[A1(r, c)] = cell;
        maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
        return api;
      },
      row(r, arr, c0 = 0, z) { arr.forEach((v, i) => api.set(r, c0 + i, v, Array.isArray(z) ? z[i] : z)); return api; },
      merge(r1, c1, r2, c2) { (ws['!merges'] = ws['!merges'] || []).push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); return api; },
      cols(widths) { ws['!cols'] = widths.map(w => ({ wch: w })); return api; },
      done() { ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } }); return ws; },
    };
    return api;
  }
  const F = f => ({ f });
  const WON = '#,##0', M2 = '#,##0.0', PCT = '0.00%', RATE = '0.0000';

  function jibunKey(j) { const n = String(j).match(/\d+/g) || [0]; return (+n[0]) * 100000 + (+(n[1] || 0)); }
  function sorted(z) { return [...z.parcels].sort((a, b) => jibunKey(a.jibun) - jibunKey(b.jibun)); }
  function ownersLabel(p) {
    const o = (p.owners || []).map(x => x.name || x).filter(Boolean);
    const u = [...new Set(o)];
    return u.length === 0 ? (p.ownerName || '') : u.length === 1 ? u[0] : `${u[0]} 외 ${u.length - 1}인`;
  }

  // =====================================================================
  // 1. 법정서식 (인천광역시 도시 및 주거환경정비 조례 시행규칙)
  // =====================================================================

  // 건축물 용도 구분 (조서 각주의 단독주택 수·공동주택 수)
  const isDetached = b => /단독|다가구|다중주택/.test(b.useStd || b.use || '');
  const isApt = b => /아파트|연립|다세대/.test(b.useStd || b.use || '');
  const locOf = x => `${x.dong || ''} ${x.jibun || ''}`.trim();
  const floorsLabel = b => b.floorsLabel || (b.floors || b.basement ? `${b.basement || 0}/${b.floors || 0}` : '');
  const fmt1 = v => (Math.round((+v || 0) * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // 대지 필지를 그 위 건축물로 단독주택 용지 / 공동주택 용지로 나눔
  function housingLots(z) {
    const bj = new Map(); (z.buildings || []).forEach(b => { const a = bj.get(b.jibun) || []; a.push(b); bj.set(b.jibun, a); });
    let detached = 0, apt = 0;
    z.parcels.forEach(p => {
      if (!/^대/.test(p.jimok || '')) return;
      const bs = bj.get(p.jibun) || [];
      if (bs.some(isApt)) apt += +p.area || 0; else if (bs.length && bs.every(isDetached)) detached += +p.area || 0;
    });
    return { detached, apt };
  }

  // 별지 제4호 토지 및 건축물 조서 (인천광역시 도시 및 주거환경정비 조례 시행규칙 서식의 칸 그대로)
  //   대조·판단 내용은 sheet4Review(별도 시트)에 둠
  function sheet4(z, opt = {}) {
    const s = Sheet();
    s.set(0, 0, '[별지 제4호서식]');
    s.set(1, 0, '토지 및 건축물 조서'); s.merge(1, 0, 1, 11);
    s.set(2, 0, `사업명: ${z.name || ''}   위치: ${z.location || ''}`);
    s.set(4, 0, '1. 토지조서');
    s.row(5, ['연번', '위치', '지목', '면적(㎡)', '용도지역', '용도지구', '도시계획시설', '소유주', '용도']);
    const P = sorted(z), first = 8, last = 7 + P.length;
    s.set(6, 0, '계'); s.set(6, 3, F(P.length ? `SUM(D${first}:D${last})` : '0'), M2);
    P.forEach((p, i) => s.row(7 + i, [i + 1, locOf(p), p.jimok || '', +p.area || 0, p.zoning || '', p.district || '', p.facility || '', ownersLabel(p), p.landUse || p.use || ''], 0, [null, null, null, M2]));
    let r = 7 + P.length;
    const HL = housingLots(z);
    s.set(r++, 0, `※ 단독주택 용지 : ${fmt1(HL.detached)}㎡,  공동주택 용지 : ${fmt1(HL.apt)}㎡`);
    const part = P.filter(p => p.ledgerArea && p.area != null && p.area < p.ledgerArea - 0.05);
    if (part.length) s.set(r++, 0, `※ 일부편입 ${part.length}필지(면적은 편입면적): ` + part.map(p => `${p.jibun}(공부 ${fmt1(p.ledgerArea)}㎡ 중 ${fmt1(p.area)}㎡)`).join(', '));
    r++;
    s.set(r++, 0, '2. 건축물 조서');
    s.row(r, ['연번', '위 치', '용 도', '구 조', '동 수', '호 수', '세대수', '준공연도', '규  모', '', '', '비 고']);
    s.row(r + 1, ['건축면적(㎡)', '연면적(㎡)', '층수(지하/지상)'], 8);
    s.merge(r, 8, r, 10); [0, 1, 2, 3, 4, 5, 6, 7, 11].forEach(c => s.merge(r, c, r + 1, c));
    r += 2;
    const B = z.buildings || [], tr = r, b1 = r + 2, b2 = r + 1 + B.length;
    s.set(tr, 0, '계');
    if (B.length) [['E', 4], ['F', 5], ['G', 6], ['I', 8], ['J', 9]].forEach(([L, c]) => s.set(tr, c, F(`SUM(${L}${b1}:${L}${b2})`), c >= 8 ? M2 : undefined));
    r++;
    B.forEach((b, i) => {
      s.row(r++, [i + 1, `${locOf(b)}${b.bname ? ' ' + b.bname : ''}`, b.use || '', b.structure || '', +b.dongs || 1, b.units === '' || b.units == null ? '' : +b.units || 0,
        b.households === '' || b.households == null ? '' : +b.households || 0, b.year || '', b.archArea === '' ? '' : +b.archArea || '', +b.floorArea || '', floorsLabel(b), b.note || ''],
        0, [null, null, null, null, null, null, null, null, M2, M2]);
    });
    const det = B.filter(isDetached).reduce((a, b) => a + (+b.units || 1), 0);
    const apt = B.filter(isApt), aptH = apt.reduce((a, b) => a + (+b.households || +b.units || 0), 0);
    s.set(r++, 0, '주) 1. 호수 산정은 「인천광역시 도시 및 주거환경정비 조례」에 따름');
    s.set(r++, 0, '    2. 비고란에 빈집(공가․폐가) 현황 등 기재');
    s.set(r++, 0, `※ 단독주택 수 : ${det}호,  공동주택 수 : ${apt.length}개동, ${aptH}세대`);
    r++;
    const sign = opt.sign || {};
    s.set(r++, 0, `작성자 : 직 ${sign.writerTitle || '      '}  성명 ${sign.writer || '            '}  (서명 또는 날인)`);
    s.set(r++, 0, `확인자 : 직 ${sign.checkerTitle || '      '}  성명 ${sign.checker || '            '}  (서명 또는 날인)`);
    s.cols([6, 22, 12, 12, 9, 9, 9, 10, 11, 11, 13, 30]);
    return { ws: s.done(), totalRow: 7 };
  }

  // 제4호 조서를 만들 때의 대조·판단 기록 (조서 서식에는 없는 칸)
  function sheet4Review(z) {
    const s = Sheet(); let r = 0;
    s.set(r++, 0, `토지·건축물 조서 대조표 — ${z.name || ''}`);
    s.set(r++, 0, `${z.confirm ? `${z.confirm.roleLabel} 검토 완료 ${z.confirm.at}` : '검토 완료 전(참고용)'}   공부: 브이월드 토지특성·연속지적${z.ledgerQueried ? ', 건축물대장(건축HUB)' : ' (건축물대장 미조회 — 건축물은 명부 기준)'}`);
    r++;
    s.set(r++, 0, '1. 토지');
    s.row(r++, ['연번', '위치', '조서 지목', '명부 지목', '조서 공부면적(㎡)', '명부 공부면적(㎡)', '편입면적(㎡)', '제척면적(㎡)', '편입구분', '소유구분', '토지이용상황', '공시지가(원/㎡)', '비고']);
    sorted(z).forEach((p, i) => {
      const R1 = r + 1;
      s.row(r, [i + 1, locOf(p), p.jimok || '', p.rosterJimok || '', p.ledgerArea === '' || p.ledgerArea == null ? '' : +p.ledgerArea, p.rosterArea == null ? '' : +p.rosterArea, +p.area || 0], 0, [null, null, null, null, M2, M2, M2]);
      s.set(r, 7, F(`IF(E${R1}="","",E${R1}-G${R1})`), M2);
      s.set(r, 8, F(`IF(E${R1}="","",IF(ABS(E${R1}-G${R1})<0.05,"전체편입","일부편입"))`));
      s.row(r, [p.ownerType || '', p.landUse || '', p.jiga || '', p.note || ''], 9, [null, null, WON, null]);
      r++;
    });
    r++;
    s.set(r++, 0, '2. 건축물');
    s.row(r++, ['연번', '위치', '용도', '구조', '출처', '허가', '사용승인일', '경과연수', '노후 기준연수', '노후·불량', '접도(4m×4m)', '비고']);
    (z.buildings || []).forEach((b, i) => s.row(r++, [i + 1, `${locOf(b)}${b.bname ? ' ' + b.bname : ''}`, b.use || '', b.structure || '', b.source || '', b.permit || '', b.aprDate || '',
      isFinite(b.age) ? b.age : '', b.limit || '', b.old == null ? '' : b.old ? '노후' : '', b.road == null ? '' : b.road ? '접도' : '미접도', b.note || '']));
    if (z.decisions && z.decisions.length) {
      r++;
      s.set(r++, 0, '3. 명부 ↔ 공부 불일치 판단 기록');
      s.row(r++, ['구분', '위치', '항목', '명부(제출)', '공부', '판단', '판단 방식']);
      z.decisions.forEach(d => s.row(r++, [d.kind, d.loc, d.label, d.roster, d.ledger, d.choice, d.manual ? '직접 선택' : '기본값']));
    }
    s.cols([6, 22, 12, 12, 14, 14, 14, 12, 12, 12, 14, 14, 40]);
    return s.done();
  }

  // 집합건축물 조서 (호별) - 실무 형식
  function sheetUnits(z) {
    const s = Sheet();
    s.set(0, 0, '집합건축물 조서');
    s.row(2, ['연번', '동명', '본번', '건물명', '용도', '구조', '동', '호', '전유면적(㎡)', '대지권면적(㎡)', '준공연도', '비고']);
    (z.units || []).forEach((u, i) => s.row(3 + i, [i + 1, u.dong || '', u.jibun || '', u.bldgName || '', u.use || '', u.structure || '', u.dongNo || '', u.ho || '', u.excl ?? '', u.landRight ?? '', u.year || '', u.note || '']));
    s.cols([6, 8, 8, 18, 10, 14, 6, 6, 12, 12, 8, 16]);
    return s.done();
  }

  // 별지 제5호 기초 조사·확인 내역서 - 2. 토지 이용현황 / 5. 토지가격 (명부·공부로 채울 수 있는 칸)
  function sheet5(z) {
    const s = Sheet(); const P = z.parcels;
    s.set(0, 0, '[별지 제5호서식] 기초 조사·확인 내역서 (자동 기입 가능 항목)');
    s.set(1, 0, `정비구역: ${z.name || ''}`);
    s.set(3, 0, '2. 토지 및 건축물 이용현황 - 토지');
    s.row(4, ['구 분', '전체 토지', '주거용 건축물', '비주거용 건축물', '나대지', '정비기반시설부지', '기타', '비고']);
    const jc = j => ({ 도로: '도', 구거: '구', 공원: '공', 하천: '천', 제방: '제', 철도용지: '철', 수도용지: '수', 대지: '대' }[j] || j);
    const groups = {
      주거: p => jc(p.jimok) === '대' && p.use !== '비주거' && p.hasBuilding !== false,
      비주거: p => p.use === '비주거',
      나대지: p => jc(p.jimok) === '대' && p.hasBuilding === false,
      기반: p => ['도', '구', '공', '천', '제', '철', '수'].includes(jc(p.jimok)),
    };
    if (z.buildings && z.buildings.length) {   // 건축물대장이 있으면 필지별 건축물 유무·주거 여부 보정
      const bj = new Map(); z.buildings.forEach(b => { const a = bj.get(b.jibun) || []; a.push(b); bj.set(b.jibun, a); });
      const done = new Set(z.ledgerDone || []);   // 건축물대장을 조회한 필지만 '건물 없음' 판정
      P.forEach(p => { const bs = bj.get(p.jibun); if (!bs && !done.has(p.jibun)) return; p.hasBuilding = !!bs; if (bs) p.use = bs.some(b => /주택|아파트|다가구|다세대|연립/.test(b.use || '')) ? '주거' : '비주거'; });
    }
    const cnt = f => P.filter(f).length, area = f => P.filter(f).reduce((a, p) => a + (+p.area || 0), 0);
    const other = p => !Object.values(groups).some(g => g(p));
    s.row(5, ['필지수', P.length, cnt(groups.주거), cnt(groups.비주거), cnt(groups.나대지), cnt(groups.기반), cnt(other), '지목 기준 1차 분류(건축물 유무는 건축물대장 확인 후 보정)']);
    s.row(6, ['면적(㎡)', area(() => true), area(groups.주거), area(groups.비주거), area(groups.나대지), area(groups.기반), area(other)], 0, M2);
    s.set(8, 0, '5. 토지 및 건축물의 가격과 임대차 현황');
    s.row(9, ['구역안의 총 토지가격(공시지가 기준, 원)', '구역안의 총 건축물 가격', '임대차 세대수', '임대차 인구수', '비고']);
    const land = P.reduce((a, p) => a + (+p.area || 0) * (+p.jiga || 0), 0);
    s.row(10, [land, '', '', '', `개별공시지가 ${z.baseYear || ''} × 편입면적 합계`], 0, WON);
    s.set(12, 0, '(참고) 지목별 현황');
    s.row(13, ['지목', '필지수', '면적(㎡)', '국공유 필지', '국공유 면적(㎡)']);
    const jm = [...new Set(P.map(p => p.jimok || '미상'))].sort();
    jm.forEach((j, i) => {
      const f = p => (p.jimok || '미상') === j;
      s.row(14 + i, [j, cnt(f), area(f), cnt(p => f(p) && isPublic(p.ownerType)), area(p => f(p) && isPublic(p.ownerType))], 0, [null, null, M2, null, M2]);
    });
    s.cols([30, 14, 14, 14, 12, 16, 10, 50]);
    return s.done();
  }

  // 별지 제6호 동의총괄표 - 토지면적 / 토지등소유자 (동의자 칸은 빈칸)
  function sheet6(z, count) {
    const s = Sheet(); const P = z.parcels;
    const areaBy = f => P.filter(f).reduce((a, p) => a + (+p.area || 0), 0);
    s.set(0, 0, '[별지 제6호서식] (조합설립추진위원회 구성) 동의총괄표');
    s.set(1, 0, `1. 동의총괄내역 (정비사업 명칭 : ${z.name || ''})`);
    s.set(3, 0, '가. 토지면적');
    s.row(4, ['구 분', '동의율(%)', '동의대상 총면적(㎡)', '', '', '동의면적(㎡)', '', '']);
    s.row(5, ['', '', '계', '지상권 비설정토지', '지상권 설정토지', '계', '지상권 비설정토지', '지상권 설정토지']);
    const rows = [['사유지', p => !isPublic(p.ownerType) && p.ownerType !== '기타'], ['국공유지', p => isPublic(p.ownerType)], ['기타', p => p.ownerType === '기타']];
    s.row(6, ['계', F('IF(C7=0,"",F7/C7*100)'), F('SUM(C8:C10)'), F('SUM(D8:D10)'), 0, F('SUM(F8:F10)'), F('SUM(G8:G10)'), 0], 0, M2);
    rows.forEach(([lab, f], i) => {
      const r = 7 + i, a = areaBy(f);
      s.row(r, [lab, F(`IF(C${r + 1}=0,"",F${r + 1}/C${r + 1}*100)`), a, a, 0, '', '', ''], 0, M2);
    });
    s.set(12, 0, '나. 토지등소유자');
    s.row(13, ['구 분', '전체 토지등소유자', '토지 및 건축물 소유자', '토지소유자', '건축물소유자', '권리유형 계', '사유지', '국공유지', '기타']);
    const c = count || {};
    s.row(14, ['총소유자수', c.total ?? '', c.both ?? '', c.landOnly ?? '', c.bldgOnly ?? '', c.total ?? '', c.private ?? '', c.public ?? '', c.other ?? '']);
    s.row(15, ['동의자수']); s.row(16, ['동의율(%)', F('IF(B15="","",IF(B16="","",B16/B15*100))')]);
    s.set(18, 0, '※ 동의자수·동의면적은 검인 동의서 접수 후 기입. 토지등소유자 수는 도시정비법 시행령 제33조 기준 산정값(검토 결과)');
    s.cols([14, 12, 16, 16, 14, 14, 16, 14, 10]);
    return s.done();
  }

  // 별지 제9호 토지등소유자 명부 (개인정보 포함 - 비공개)
  function sheet9(z) {
    const s = Sheet();
    s.set(0, 0, '[별지 제9호서식]   (비공개 - 개인정보 포함)');
    s.set(1, 0, '토 지 등 소 유 자 명 부'); s.merge(1, 0, 1, 15);
    s.set(2, 0, `(정비사업 명칭 : ${z.name || ''})`);
    // 서식의 3단 머리글: 토지등소유자 / 권리내역(소재지·토지·건축물·지상권)
    s.row(3, ['연번', '토지등소유자', '', '', '', '권 리 내 역', '', '', '', '', '', '', '', '세대주 성명', '동의여부', '비고']);
    s.row(4, ['', '성 명', '생년월일', '주 소', '전화번호', '소재지', '토    지', '', '', '건 축 물', '', '', '지상권']);
    s.row(5, ['소유면적(㎡)', '편입면적(㎡)', '공유여부', '동수', '허가유무', '공유여부'], 6);
    s.merge(3, 1, 3, 4).merge(3, 5, 3, 12).merge(4, 6, 4, 8).merge(4, 9, 4, 11);
    [0, 13, 14, 15].forEach(c => s.merge(3, c, 5, c));
    [1, 2, 3, 4, 5, 12].forEach(c => s.merge(4, c, 5, c));
    let r = 6;
    (z.owners || []).forEach(o => {
      (o.parcels && o.parcels.length ? o.parcels : [{}]).forEach((q, k) => {
        s.row(r++, [k === 0 ? o.no || '' : '', k === 0 ? o.name : '', k === 0 ? o.birth || '' : '', k === 0 ? o.addr || '' : '', k === 0 ? o.phone || '' : '',
          `${q.dong ? q.dong + ' ' : ''}${q.jibun || ''}${q.ho ? ' ' + q.ho : ''}`, q.ownArea ?? '', q.inArea ?? '', q.shared || (q.share ? `공유(${q.share})` : ''),
          q.bldgCount ?? '', q.permit ?? '', q.bldgShare ?? '', q.superficies || '', k === 0 ? o.head || '' : '', q.consent || (k === 0 ? o.consent || '' : ''), q.note || ''], 0, [null, null, null, null, null, null, M2, M2]);
      });
    });
    s.set(r + 1, 0, '※ 공동주택의 경우 소재지에 호수를 기재');
    s.set(r + 2, 0, '제출서류  1. 토지등소유자별 권리내역 증빙서류(지적공부, 부동산등기부, 건축물대장, 무허가건축물확인원 등) 각 1부.');
    s.cols([6, 12, 11, 36, 13, 20, 12, 12, 10, 8, 8, 10, 8, 10, 8, 20]);
    return s.done();
  }

  // 별지 제9호 토지등소유자 명부 "작성 틀": 확정된 구역계(지번·편입면적)와 공부(토지·건축물대장)로 채우고
  //   소유자 칸(성명·생년월일·주소·지분·공유)은 비워 둠 → 등기부 등 열람으로 기재
  //   지번마다 한 행, 집합건물은 그 아래 호마다 한 행. 오른쪽에 공부 값·열람 확인·제출 명부 참고(번호·인원만, 이름 없음)
  function sheet9Frame(z) {
    const s = Sheet(), P = sorted(z), B = z.buildings || [], U = z.units || [];
    const total = P.reduce((a, p) => a + (+p.area || 0), 0);
    s.set(0, 0, '[별지 제9호서식] 토 지 등 소 유 자 명 부 — 작성 틀 (공부 기준, 소유자 칸은 등기부 등 열람으로 기재)');
    s.set(1, 0, `(정비사업 명칭 : ${z.name || ''})   ${z.confirm ? `구역계 확정 ${z.confirm.at}` : '구역계 확정 전(참고)'} · 토지 ${P.length}필지 · 편입면적 합계 ${fmt1(total)}㎡ · 건축물 ${B.length}동${U.length ? ` · 집합건물 ${U.length}호` : ''}`);
    s.row(3, ['연번', '토지등소유자', '', '', '', '권 리 내 역', '', '', '', '', '', '', '', '세대주 성명', '동의여부', '비고', '— 공부(작성 근거) —', '', '', '', '', '등기부 열람', '제출 명부 참고']);
    s.row(4, ['', '성 명', '생년월일', '주 소', '전화번호', '소재지', '토    지', '', '', '건 축 물', '', '', '지상권']);
    s.row(5, ['소유면적(㎡)', '편입면적(㎡)', '공유여부', '동수', '허가유무', '공유여부'], 6);
    s.row(5, ['지목', '공부면적(㎡)', '편입비율', '건축물(대장)', '집합건물 호(전유㎡)', '확인(□)', '소유자 번호·인원'], 16);
    s.merge(3, 1, 3, 4).merge(3, 5, 3, 12).merge(4, 6, 4, 8).merge(4, 9, 4, 11).merge(3, 16, 4, 20);
    [0, 13, 14, 15].forEach(c => s.merge(3, c, 5, c));
    [1, 2, 3, 4, 5, 12].forEach(c => s.merge(4, c, 5, c));
    let r = 6;
    const by = (arr, j) => arr.filter(x => x.jibun === j);
    P.forEach(p => {
      const bs = by(B, p.jibun), us = by(U, p.jibun);
      const ratio = p.ledgerArea ? (+p.area || 0) / p.ledgerArea : 1;
      const permit = !bs.length ? '' : bs.every(b => b.source === '건축물대장') ? '유' : bs.some(b => b.source === '건축물대장') ? '유·확인 필요' : '확인 필요(대장 없음)';
      const bsum = bs.length ? `${bs.length}동 · ${[...new Set(bs.map(b => b.use))].join('·')}${bs.some(b => b.source !== '건축물대장') ? ' · 대장 없는 건물 있음' : ''}` : '';
      const ref = p.rosterNos && p.rosterNos.length ? `${p.rosterNos.length}명 (번호 ${p.rosterNos.slice(0, 6).join(', ')}${p.rosterNos.length > 6 ? ' …' : ''})` : '제출 명부에 없음';
      s.row(r, ['', '', '', '', '', `${p.dong || ''} ${p.jibun}`.trim(), '', +p.area || 0, '', bs.length || '', permit, '', '', '', '', p.note || ''], 0, [null, null, null, null, null, null, M2, M2]);
      s.row(r, [p.jimok || '', p.ledgerArea === '' || p.ledgerArea == null ? '' : +p.ledgerArea, ratio, bsum, us.length ? `${us.length}호 (아래 행)` : '', '□', ref], 16, [null, M2, PCT]);
      r++;
      us.forEach(u => {
        s.row(r, ['', '', '', '', '', `${p.dong || ''} ${p.jibun} ${[u.bldgName, u.dongNo, u.ho].filter(Boolean).join(' ')}`.trim(), '', '', '', 1, '유'], 0);
        s.row(r, ['', '', '', u.use || '', u.excl === '' || u.excl == null ? '' : `${u.dongNo || ''} ${u.ho || ''} (${fmt1(u.excl)}㎡)`.trim(), '□', ''], 16);
        r++;
      });
    });
    s.set(r + 1, 0, '※ 소유자 칸(성명·생년월일·주소·전화·지분·공유여부)은 등기부등본 등 열람으로 기재. 공유 토지는 소유자마다 행을 늘려 소유면적(공부면적×지분)·편입면적(소유면적×편입비율)을 기재');
    s.set(r + 2, 0, '※ 공동주택의 경우 소재지에 호수를 기재(집합건물 호별 행). 건축물 허가유무 "확인 필요"는 무허가건축물확인원으로 확인');
    s.set(r + 3, 0, '※ "제출 명부 참고"는 제출된 명부의 토지등소유자 번호와 인원만 적음(대조용)');
    s.cols([6, 12, 11, 30, 13, 26, 12, 12, 9, 7, 12, 9, 8, 10, 8, 30, 8, 12, 9, 30, 20, 9, 30]);
    return s.done();
  }

  // 최종 결과 틀: 공부 기준 토지·건축물 조서 + 별지 제9호 작성 틀 + 판단 근거(대조표)
  function exportFrame(z, fname, opt = {}) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet4(z, opt).ws, '제4호_토지및건축물조서');
    if (z.units && z.units.length) XLSX.utils.book_append_sheet(wb, sheetUnits(z), '집합건축물조서');
    XLSX.utils.book_append_sheet(wb, sheet9Frame(z), '제9호_명부_작성틀');
    XLSX.utils.book_append_sheet(wb, sheet4Review(z), '판단근거_대조표');
    XLSX.writeFile(wb, fname || `${z.name || '정비구역'}_최종결과틀.xlsx`);
    return wb;
  }

  // 시행령 제33조 기준 토지등소유자 수 (간이): 공유는 대표 1인, 1인 다수 필지 1인, 국공유 재산관리청별 1인
  function countOwners(z) {
    if (!z.owners || !z.owners.length) return null;
    const key = o => o.isPublic ? 'PUB|' + o.name : o.name + '|' + (o.birth || '').slice(0, 6);
    const people = new Set(z.owners.map(key));
    const pub = z.owners.filter(o => o.isPublic);
    return { total: people.size, public: new Set(pub.map(key)).size, private: people.size - new Set(pub.map(key)).size };
  }

  // 별표 1(정비계획 입안대상지역 요건) 검토 - 노후도·과소필지·호수밀도·주택접도율
  function sheetReq(z) {
    const s = Sheet(); let r = 0;
    s.set(r++, 0, '「도시정비법 시행령」 별표 1 정비계획 입안대상지역 요건 검토 (재개발)');
    s.set(r++, 0, `정비구역: ${z.name || ''}   기준일: ${z.baseDate || ''}`);
    s.set(r++, 0, '※ 지정 전 추진위원회 구성(법 제31조제2항제2호가목·시행령 제25조제2항)에도 이 요건이 적용됨');
    r++;
    s.row(r++, ['요건', '현황', '기준', '판정']);
    (z.req || []).forEach(q => s.row(r++, [q.label, q.value, q.need, q.pass == null ? '확인 필요' : q.pass ? '충족' : '미충족']));
    const B = z.buildings || [];
    if (z.road) {
      const lots = z.road.lots, ok = lots.filter(x => x.ok).length;
      const hb = B.filter(b => b.road != null), hok = hb.filter(b => b.road).length;
      r++;
      s.set(r++, 0, '주택접도율 산정 (자동 추정)');
      s.row(r++, ['건축물 기준', hb.length ? `${hok} / ${hb.length}동` : '건축물대장 조회 전', hb.length ? hok / hb.length : '', `폭 4m 이상 도로에 길이 4m 이상 접한 대지의 건축물 비율 (기준: ${((z.req || []).find(q => /접도율/.test(q.label)) || {}).need || '조례 확인'})`], 0, [null, null, PCT, null]);
      s.row(r++, ['대지 필지 기준(참고)', `${ok} / ${lots.length}필지`, ok / lots.length, '지목 도로·공원·하천 등 제외'], 0, [null, null, PCT, null]);
      s.set(r++, 0, '※ 도로 폭은 지적도 지목 "도로" 필지 모양으로 잰 값. 지적상 도로와 실제 통로가 다른 곳·사도·막다른 길은 현장 확인 필요');
      r++;
      s.row(r++, ['지번', '지목', '도로에 접한 길이(m)', '4m 이상 도로 연속 접도(m)', '접한 도로 최대폭(m)', '판정']);
      lots.forEach(x => s.row(r++, [x.jibun, x.jimok || '', Math.round(x.touchLen * 10) / 10, Math.round(x.longest4 * 10) / 10, Math.round(x.maxWidth * 10) / 10, x.ok ? '접도' : x.none ? '맹지(도로 미접)' : '미접도']));
    }
    s.cols([34, 24, 18, 60, 16, 14]);
    return s.done();
  }

  function exportForms(z, fname, opt = {}) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet4(z, opt).ws, '제4호_토지및건축물조서');
    XLSX.utils.book_append_sheet(wb, sheet4Review(z), '제4호_대조표');
    if (z.units && z.units.length) XLSX.utils.book_append_sheet(wb, sheetUnits(z), '집합건축물조서');
    XLSX.utils.book_append_sheet(wb, sheet5(z), '제5호_기초조사');
    if ((z.req && z.req.length) || z.road) XLSX.utils.book_append_sheet(wb, sheetReq(z), '별표1_요건검토');
    XLSX.utils.book_append_sheet(wb, sheet6(z, countOwners(z)), '제6호_동의총괄표');
    if (z.owners && z.owners.length) XLSX.utils.book_append_sheet(wb, sheet9(z), '제9호_명부(비공개)');
    XLSX.writeFile(wb, fname || `${z.name || '정비구역'}_법정서식.xlsx`);
    return wb;
  }

  // =====================================================================
  // 2. 사업성 검토표 (구청 검토 양식 + 부동산원 보고서 항목)
  // =====================================================================
  // p(가정값) 기본: 구청 검토 엑셀 단가, 한국부동산원 사업성 검토 항목
  const DEFAULTS = {
    multiplier: 1.4,          // 종전자산 = 공시지가 × 배율
    consent: 0.8,             // 분양대상자(조합설립 동의자) 비율
    gfaM2: null,              // 계획 연면적(㎡) - 비우면 건축 대지면적 × 용적률 × 연면적계수
    infraM2: null,            // 정비기반시설 면적(㎡) - 비우면 지목 도로 등 합계(없으면 구역면적의 20%)
    far: 250, gfaFactor: 1.45,
    supplyRatio: 0.63,        // 분양 공급면적 합 ÷ 연면적 (세대수 자동 배분용)
    constPerPy: 7000000,      // 평당 공사비
    memberRatio: 0.9,         // 조합원 분양가 = 일반분양가 × 0.9
    fin: { share: 0.5, rate: 0.035, years: 4 },
    units: [                  // 공급면적㎡, 전용㎡, 조합원 세대, 일반 세대, 일반 평당분양가
      { type: '59형', supply: 82.78, excl: 59.98, member: 0, general: 0, genPy: 17800000 },
      { type: '84형', supply: 112.45, excl: 84.98, member: 0, general: 0, genPy: 17500000 },
    ],
    retail: { areaM2: 0, memberPy: 20700000, genPy: 23000000, memberShare: 0.3 },
    baseAsset: 300000000,     // 평형별 분담금 예시 종전자산
    sensSteps: [-0.10, -0.05, 0, 0.05, 0.10],
  };

  // 지출 항목: [구분, 항목, 수량식, 단위, 단가, 산출근거]
  //   수량식: 'GFA_PY'(연면적 평) 'GFA_M2'(연면적 ㎡) 숫자, 또는 '=수식'(금액 직접)
  // 재개발 대규모 프리셋: 대규모 재개발(연면적 약 7만평·1,500세대급) 사업수지 실적을 연면적 평당 단가로 환산
  //   (금액이 규모와 무관한 항목·산식 항목은 별도 처리)
  function costItemsRedev() {
    const P = (g, n, u, note) => [g, n, 'GFA_PY', '평', u, note + ''];
    return [
      P('공사비', '정비기반시설 공사비', 139551, '도로·공원 등'),
      P('공사비', '석면해체(철거)', 21267, ''),
      P('공사비', '지장물 이설공사비', 20824, ''),
      P('공사비', '인입공사비(지역난방·가스·수도·전기·통신)', 40583, ''),
      ['공사비', '공사 부가세(국민주택 초과·상가)', 1, '식', 0, '해당 시 입력'],
      ['설계감리비', '감리비(건축)', '=SUPERVISION', '', '', '건축공사비 × 약 1.8% (실적 약 2%)'],
      P('설계감리비', '석면·소방·통신·기반시설 감리', 24388, ''),
      P('설계감리비', '설계용역비(변경 포함)', 58146, ''),
      P('설계감리비', '정비기반시설·흙막이 설계', 7827, ''),
      P('조사측량비', '측량(확정측량 포함)', 14537, ''),
      P('조사측량비', '문화재·지질·석면 조사', 7178, ''),
      P('외주용역비', 'PM·정비사업전문관리 용역', 47220, ''),
      P('외주용역비', '정비계획 용역', 8722, ''),
      P('외주용역비', '교통·친환경·경관·지하안전·주거환경 등 영향평가', 10614, ''),
      P('외주용역비', '범죄예방계획·이주관리', 25904, ''),
      P('외주용역비', '상가세입자 영업권 보상 협의', 11629, ''),
      P('외주용역비', '기반시설 설치비 산출·국공유지 협의 등', 9478, ''),
      P('세금과공과', '학교용지부담금', 27011, ''),
      P('세금과공과', '광역교통시설부담금', 8736, ''),
      P('세금과공과', '하수도 원인자부담금', 5088, ''),
      ['보상비', '국·공유지 매입비', '=PUBLIC_BUY', '', '', '국공유지 공시지가 × 배율(가정값)'],
      ['보상비', '청산대상자 청산금', '=CASHOUT_COMP', '', '', '청산대상자 종전자산 추정액 × 손실보상 배율 (실적 약 2%)'],
      P('보상비', '이사비용', 53785, ''),
      P('보상비', '기타 이주보상비', 87219, ''),
      P('보상비', '손실보상비(세입자·영업권·종교시설 등)', 39249, ''),
      P('보상비', '국공유지 변상금', 5815, ''),
      ['보상비', '이주비 생활지원금(대위변제)', 1, '식', 0, '조합 지급 시 입력'],
      ['금융비용', '중도금 무이자 금융비용(조합원)', 1, '식', 0, '해당 시 입력'],
      ['금융비용', '이주비 금융비용(기본이주비)', 1, '식', 0, '조합 부담 시 입력. 이자후불제면 0'],
      P('관리비', '조합운영비', 39249, '월 2,500만원 × 9년 수준'),
      P('관리비', '총회비용', 31980, ''),
      P('관리비', '추진위원회 기투입 사업비', 26355, ''),
      P('관리비', '조합창립 용역비', 5815, ''),
      P('부대경비', '감정평가 수수료', 11629, ''),
      P('부대경비', '세무회계 용역', 5102, ''),
      P('부대경비', '보존·멸실·신탁등기, 이전고시', 39248, ''),
      ['세금과공과', '일반분양·상가 보존등기 취득세', '=ACQ_TAX', '', '', '일반분양+상가 분양액 × 3.16% × 건물비율(약 25%) 개략'],
      ['분양경비', '분양관련비용 및 보증수수료', '=HUG_FEE', '', '', '일반분양 아파트 × 70% × 0.28% × 2.5년 + 분양대행'],
      P('기타경비', '소송·인허가 변경·민원처리', 26165, ''),
      P('기타경비', '입주관리·교육환경 조건이행', 15990, ''),
      ['세금과공과', '법인세', '=CORP_TAX', '', '', '일반분양 총액 × 1%'],
      ['기타경비', '예비비', '=RESERVE', '', '', '공사비+기타사업비 × 2% (부동산원 보고서 기준)'],
    ];
  }

  function costItems(preset) {
    if (preset === 'redev') return costItemsRedev();
    return [
      ['조사측량비', '조사측량비', 1, '식', 50000000, '분할측량, 기타측량 및 확정측량비 [VAT포함, 추정액]'],
      ['설계감리비', '설계비(건축설계)', 'GFA_M2', '㎡', 45000, '연면적 × 단가 [VAT포함, 추정액]'],
      ['설계감리비', '도시설계비(정비계획 변경 용역)', 1, '식', 100000000, '[VAT포함, 추정액]'],
      ['설계감리비', '정비기반시설 설계비', 1, '식', 50000000, '도로·공원 등 [VAT포함, 추정액]'],
      ['설계감리비', '소방시설 설계비', 1, '식', 80000000, '[VAT포함, 추정액]'],
      ['설계감리비', '감리비(소방·석면감리 포함)', 'GFA_PY', '평', 170000, '연면적(평) × 단가 [VAT포함, 추정액]'],
      ['외주용역비', '정비사업전문관리업비', 'GFA_M2', '㎡', 41500, '연면적 × 단가 [VAT포함, 추정액]'],
      ['공사비', '정비기반시설 공사비', 1, '식', 0, '정비기반시설 있는 경우 입력'],
      ['공사비', '이설비(도시가스·상하수도 등)', 'GFA_PY', '평', 30000, '연면적(평) × 단가'],
      ['공사비', '인입공사비', 'GFA_PY', '평', 35000, '상하수도·전기 등 인입, 연면적(평) × 단가'],
      ['공사비', '기타 공사비', 'GFA_PY', '평', 30000, '연면적(평) × 단가'],
      ['보상비', '국·공유지 매수(시행자 매수분)', '=PUBLIC_BUY', '', '', '무상양도 제외 국공유지 공시지가 × 120%'],
      ['보상비', '손실보상비(토지·건축물)', '=CASHOUT_COMP', '', '', '수용·협의매수·청산대상자 추정액 × 120%'],
      ['보상비', '기타 이주보상비', 1, '식', 500000000, '추정액'],
      ['관리비', '조합운영비(인건비·임차료 등)', 8, '년', 100000000, '연예산 × 사업기간'],
      ['관리비', '회의비', 1, '식', 200000000, '총회·대의원회·이사회 등'],
      ['관리비', '등기비', 1, '식', 300000000, '공동주택·근린생활시설·국공유지 등 등기'],
      ['부대경비', '감정평가 수수료', 1, '식', 300000000, '종전·종후·국공유지 평가 등'],
      ['외주용역비', '기반시설 설치비 산출 등 용역', 1, '식', 10000000, '[VAT포함]'],
      ['외주용역비', '친환경인증 관련 용역', 1, '식', 120000000, '[VAT포함]'],
      ['외주용역비', '교통영향평가', 1, '식', 50000000, '[VAT포함]'],
      ['외주용역비', '풍동실험', 1, '식', 80000000, '[VAT포함]'],
      ['외주용역비', '지질(지반)조사', 1, '식', 20000000, '[VAT포함]'],
      ['외주용역비', '굴토·흙막이 설계', 1, '식', 30000000, '[VAT포함]'],
      ['외주용역비', '지하안전영향평가', 1, '식', 30000000, '[VAT포함]'],
      ['외주용역비', '경관심의', 1, '식', 50000000, '[VAT포함]'],
      ['외주용역비', '사전재해영향성검토', 1, '식', 30000000, '[VAT포함]'],
      ['외주용역비', '석면 사전조사', 1, '식', 35000000, '[VAT포함]'],
      ['외주용역비', '공원·구조안전 심의', 1, '식', 30000000, '[VAT포함]'],
      ['외주용역비', '분양신청 용역', 1, '식', 10000000, '[VAT포함]'],
      ['외주용역비', '이주관리·수용재결·범죄예방', 1, '식', 350000000, '[VAT포함]'],
      ['외주용역비', '법무(변호)사 용역', 1, '식', 350000000, '매도청구·명도소송 등 [VAT포함]'],
      ['외주용역비', '세무회계 용역', 1, '식', 150000000, '외부회계감사 포함'],
      ['외주용역비', '기타 외주용역', 1, '식', 500000000, '추정액'],
      ['세금과공과', '학교용지부담금', 1, '식', 0, '증가세대 × 분양가 × 0.8% 등 - 입력'],
      ['세금과공과', '재산세 등 제세공과금', 1, '식', 200000000, '추정액'],
      ['세금과공과', '광역교통시설부담금', 1, '식', 200000000, '추정액'],
      ['세금과공과', '상하수도·전기·가스 원인자부담금', 1, '식', 350000000, '사업시행인가 시 추정'],
      ['세금과공과', '국민주택채권 매입비 등', 1, '식', 10000000, '추정액'],
      ['세금과공과', '법인세', '=CORP_TAX', '', '', '일반분양 총액 × 1%'],
      ['세금과공과', '부가세', '=RETAIL_VAT', '', '', '근린생활시설 일반분양 × 10%'],
      ['분양경비', '분양보증수수료', '=HUG_FEE', '', '', '일반분양 아파트 × 70% × 0.28% × 2.5년'],
      ['기타경비', '기타 예비비', 1, '식', 3000000000, '사업계획 변경 등 예기치 않은 비용'],
    ];
  }

  // 평형별 세대수가 비어 있으면 자동 배분: 분양 공급면적 합 = 연면적 × 공급비율(지하주차장 등 제외),
  // 타입별 세대 비율(mix)로 나누고, 조합원 세대 = 사유 소유자 × 동의율, 나머지 일반분양
  function autoUnits(p, gfaM2, z) {
    const U = (p.units && p.units.length ? p.units : DEFAULTS.units).map(u => ({ ...u }));
    if (U.some(u => (u.member || 0) + (u.general || 0) > 0)) return { units: U, auto: false };
    const mix = U.map(u => u.mix || 1 / U.length);
    const avgSupply = U.reduce((a, u, i) => a + u.supply * mix[i], 0);
    const total = Math.floor(gfaM2 * (p.supplyRatio || 0.63) / avgSupply);
    const oc = countOwners(z || {});
    let members = Math.round(((oc && oc.private) || 0) * p.consent);
    members = Math.min(members, total);
    let restM = members, restT = total;
    U.forEach((u, i) => {
      const last = i === U.length - 1;
      const t = last ? restT : Math.round(total * mix[i]);
      const m = last ? restM : Math.min(t, Math.round(members * mix[i]));
      u.member = m; u.general = t - m; restT -= t; restM -= m;
    });
    return { units: U, auto: true, total, members };
  }

  function feasibility(z, prm = {}, fname) {
    const p = JSON.parse(JSON.stringify({ ...DEFAULTS, ...prm, fin: { ...DEFAULTS.fin, ...(prm.fin || {}) }, retail: { ...DEFAULTS.retail, ...(prm.retail || {}) } }));
    const P = sorted(z);
    const wb = XLSX.utils.book_new();

    // ---- 가정값 시트 (모든 수식이 참조) ----
    const ga = Sheet();
    ga.set(0, 0, '사업성 검토 가정값 (노란 칸을 고치면 전체가 다시 계산됨)');
    // 구역 → 정비기반시설 공제 → 건축 대지 → 연면적
    const NS = netSite(P, p.infraM2);
    const gfaM2 = p.gfaM2 || Math.round(NS.net * p.far / 100 * p.gfaFactor * 100) / 100;
    const G = {};   // 이름 -> 셀 주소 (값이 함수면 앞 행들의 주소가 정해진 뒤 계산)
    const gRows = [
      ['SITE', '구역면적(㎡)', F(`'종전자산'!E${P.length + 5}`), M2, '종전자산 시트 편입면적 합계'],
      ['INFRA', '정비기반시설 면적(㎡)', NS.infra, M2, NS.basis + ' · 정비계획 값이 있으면 고쳐 쓰세요'],
      ['NET_SITE', '건축 대지면적(㎡)', () => F(`${G.SITE}-${G.INFRA}`), M2, '구역면적 − 정비기반시설'],
      ['MULT', '종전자산 배율(공시지가 ×)', p.multiplier, RATE, '구청 검토 관행 1.4 (1.5·1.8 비교)'],
      ['CONSENT', '분양대상자 비율(동의율)', p.consent, PCT, '나머지는 청산대상자(미동의)로 봄'],
      ['GFA_M2', '계획 연면적(㎡)', p.gfaM2 ? gfaM2 : () => F(`ROUND(${G.NET_SITE}*${p.far}/100*${p.gfaFactor},2)`), M2,
        p.gfaM2 ? '입력값' : `건축 대지면적 × 용적률 ${p.far}% × 연면적계수 ${p.gfaFactor} (추정)`],
      ['GFA_PY', '계획 연면적(평)', null, M2, '㎡ ÷ 3.305785'],
      ['CONST_PY', '평당 공사비(원)', p.constPerPy, WON, '철거·석면해체 포함, VAT 별도'],
      ['MEMBER_RATIO', '조합원 분양가 비율', p.memberRatio, PCT, '일반분양가 대비'],
      ['FIN_SHARE', '사업비 금융 대상 비율', p.fin.share, PCT, '총사업비 중 대여 비율'],
      ['FIN_RATE', '금리(연)', p.fin.rate, PCT, ''],
      ['FIN_YEARS', '금융 기간(년)', p.fin.years, '0.0', ''],
      ['BASE_ASSET', '분담금 예시 종전자산(원)', p.baseAsset, WON, '평형별 분담금 산정 기준'],
      ['BUY_RATE', '국공유지 매수 배율', 1.2, RATE, '공시지가 대비'],
      ['COMP_RATE', '손실보상 배율', 1.2, RATE, '청산대상자 추정액 대비'],
    ];
    ga.row(2, ['항목', '값', '근거']);
    gRows.forEach(([k, lab, v, z2, note], i) => {
      const r = 3 + i; G[k] = `'가정값'!$B$${r + 1}`;
      ga.set(r, 0, lab);
      if (k === 'GFA_PY') ga.set(r, 1, F(`B${r}/${PY}`), M2); else ga.set(r, 1, typeof v === 'function' ? v() : v, z2);
      ga.set(r, 2, note);
    });
    ga.cols([30, 18, 60]);

    // ---- 종전자산 (공시지가) ----
    const zs = Sheet();
    zs.set(0, 0, `${z.name || ''} 개별공시지가 (${z.baseYear || ''}) · 종전자산 추정`);
    zs.row(2, ['연번', '지번', '지목', '소유구분', '편입면적(㎡)', '개별공시지가(원/㎡)', '공시지가 합계(원)', '예상감정가(원/㎡)', '예상감정 합계(원)', '비고']);
    P.forEach((q, i) => {
      const r = 3 + i, R = r + 1;
      zs.row(r, [i + 1, q.jibun, q.jimok || '', q.ownerType || '사유지', +q.area || 0, +q.jiga || 0], 0, [null, null, null, null, M2, WON]);
      zs.set(r, 6, F(`E${R}*F${R}`), WON); zs.set(r, 7, F(`F${R}*${G.MULT}`), WON); zs.set(r, 8, F(`G${R}*${G.MULT}`), WON);
      if (!q.jiga) zs.set(r, 9, '공시지가 없음 - 확인');
    });
    const zt = 3 + P.length, ZT = zt + 1;  // 합계행(엑셀 행번호 ZT+1)
    zs.set(zt + 1, 1, '합계'); zs.set(zt + 1, 4, F(`SUM(E4:E${ZT})`), M2); zs.set(zt + 1, 6, F(`SUM(G4:G${ZT})`), WON); zs.set(zt + 1, 8, F(`SUM(I4:I${ZT})`), WON);
    const pubCrit = PUBLIC.map(t => `"${t}"`);
    const sumPub = col => pubCrit.map(t => `SUMIF($D$4:$D$${ZT},${t},${col}$4:${col}$${ZT})`).join('+');
    zs.set(zt + 2, 1, '국공유지'); zs.set(zt + 2, 4, F(sumPub('E')), M2); zs.set(zt + 2, 6, F(sumPub('G')), WON); zs.set(zt + 2, 8, F(sumPub('I')), WON);
    zs.set(zt + 3, 1, '사유지 등'); zs.set(zt + 3, 4, F(`E${zt + 2}-E${zt + 3}`), M2); zs.set(zt + 3, 6, F(`G${zt + 2}-G${zt + 3}`), WON); zs.set(zt + 3, 8, F(`I${zt + 2}-I${zt + 3}`), WON);
    zs.cols([6, 10, 6, 9, 12, 14, 16, 14, 16, 22]);
    const Z = { total: `'종전자산'!$I$${zt + 2}`, pub: `'종전자산'!$I$${zt + 3}`, priv: `'종전자산'!$I$${zt + 4}`,
      pubLand: `'종전자산'!$G$${zt + 3}`, privArea: `'종전자산'!$E$${zt + 4}`, area: `'종전자산'!$E$${zt + 2}` };
    gRows[0][2] = null; // SITE는 아래에서 다시 연결
    ga.set(3, 1, F(`'종전자산'!E${zt + 2}`), M2);

    // ---- 수입 ----
    const sv = Sheet();
    sv.set(0, 0, '수입(안)');
    sv.row(2, ['타입', '공급면적(㎡)', '전용면적(㎡)', '공급(평)', '세대 계', '조합원 세대', '일반 세대', '일반 평당분양가(원)', '조합원 평당분양가(원)', '조합원 세대별(원)', '일반 세대별(원)', '조합원 합계(원)', '일반 합계(원)']);
    const AU = autoUnits(p, gfaM2, z), U = AU.units;
    if (AU.auto) sv.set(1, 0, `※ 세대수 자동 배분: 연면적 × 공급비율 ${p.supplyRatio} ÷ 평균 공급면적 = ${AU.total}세대, 조합원 = 사유 소유자 × 동의율 = ${AU.members}세대 → 배치계획이 나오면 F·G열을 고치세요`);
    U.forEach((u, i) => {
      const r = 3 + i, R = r + 1;
      sv.row(r, [u.type, u.supply, u.excl], 0, M2);
      sv.set(r, 3, F(`B${R}/${PY}`), M2); sv.set(r, 4, F(`F${R}+G${R}`), '#,##0');
      sv.set(r, 5, u.member || 0, '#,##0'); sv.set(r, 6, u.general || 0, '#,##0');
      sv.set(r, 7, u.genPy, WON); sv.set(r, 8, F(`ROUND(H${R}*${G.MEMBER_RATIO},-3)`), WON);
      sv.set(r, 9, F(`ROUND(D${R}*I${R},-3)`), WON); sv.set(r, 10, F(`ROUND(D${R}*H${R},-3)`), WON);
      sv.set(r, 11, F(`J${R}*F${R}`), WON); sv.set(r, 12, F(`K${R}*G${R}`), WON);
    });
    const ut = 3 + U.length, UT = ut + 1, U1 = 4;
    sv.set(ut, 0, '공동주택 계'); sv.set(ut, 4, F(`SUM(E${U1}:E${ut})`), '#,##0'); sv.set(ut, 5, F(`SUM(F${U1}:F${ut})`), '#,##0'); sv.set(ut, 6, F(`SUM(G${U1}:G${ut})`), '#,##0');
    sv.set(ut, 11, F(`SUM(L${U1}:L${ut})`), WON); sv.set(ut, 12, F(`SUM(M${U1}:M${ut})`), WON);
    const rr = ut + 2, RR = rr + 1;
    sv.row(rr - 1, ['근린생활시설', '분양면적(㎡)', '', '평', '', '조합원 비율', '', '일반 평당분양가', '조합원 평당분양가', '', '', '조합원 합계', '일반 합계']);
    sv.set(rr, 0, '근린생활시설'); sv.set(rr, 1, p.retail.areaM2 || 0, M2); sv.set(rr, 3, F(`B${RR}/${PY}`), M2);
    sv.set(rr, 5, p.retail.memberShare, PCT); sv.set(rr, 7, p.retail.genPy, WON); sv.set(rr, 8, p.retail.memberPy, WON);
    sv.set(rr, 11, F(`ROUND(D${RR}*F${RR}*I${RR},-3)`), WON); sv.set(rr, 12, F(`ROUND(D${RR}*(1-F${RR})*H${RR},-3)`), WON);
    sv.set(rr + 2, 0, '총 수입(원)'); sv.set(rr + 2, 12, F(`L${UT}+M${UT}+L${RR}+M${RR}`), WON);
    sv.set(rr + 3, 0, '※ 수입액은 추정액으로서 조합원분양·일반분양·근린생활시설 분양가 등에 따라 변동될 수 있음');
    sv.cols([14, 11, 11, 9, 8, 10, 9, 15, 15, 15, 15, 17, 17]);
    const V = { member: `'수입'!$L$${UT}`, general: `'수입'!$M$${UT}`, rMember: `'수입'!$L$${RR}`, rGeneral: `'수입'!$M$${RR}`, total: `'수입'!$M$${rr + 3}`,
      memberUnits: `'수입'!$F$${UT}` };

    // ---- 지출 ----
    const xs = Sheet();
    xs.set(0, 0, '정비사업비 추산액 (지출)');
    xs.row(2, ['구분', '항목', '수량', '단위', '단가(원)', '금액(원)', '산출근거']);
    xs.row(3, ['공사비', '건축시설공사비', F(G.GFA_PY), '평', F(G.CONST_PY), F('C4*E4'), '연면적(평) × 평당 공사비, 철거비·석면해체 포함, VAT 별도']);
    ['', '', M2, '', WON, WON].forEach((zz, c) => { if (zz) xs.ws[A1(3, c)].z = zz; });
    const preset = p.preset || (gfaM2 / PY > 30000 ? 'redev' : 'small');
    const items = costItems(preset);
    xs.set(1, 0, preset === 'redev' ? '단가 기준: 재개발 대규모 - 대규모 재개발 사업수지 실적을 연면적 평당으로 환산' : '단가 기준: 소규모·가로주택 - 구청 검토 엑셀 단가');
    const special = {
      '=SUPERVISION': `F4*1.8%`,
      '=ACQ_TAX': `(${V.general}+${V.rGeneral})*25%*3.16%`,
      '=PUBLIC_BUY': `${Z.pubLand}*${G.BUY_RATE}`,
      '=CASHOUT_COMP': `(${Z.total}-${Z.pub})*(1-${G.CONSENT})*${G.COMP_RATE}`,
      '=CORP_TAX': `${V.general}*1%`,
      '=RETAIL_VAT': `${V.rGeneral}*10%`,
      '=HUG_FEE': `${V.general}*70%*0.28%*2.5`,
    };
    let r = 4;
    const x0 = r + 1;
    items.forEach(([g, name, q, unit, price, note]) => {
      const R = r + 1;
      xs.set(r, 0, g); xs.set(r, 1, name);
      if (q === '=RESERVE') { xs.set(r, 5, F(`(F4+SUM(F${x0}:F${R - 1}))*2%`), WON); }
      else if (typeof q === 'string' && q.startsWith('=')) { xs.set(r, 5, F(special[q]), WON); }
      else {
        if (q === 'GFA_PY') xs.set(r, 2, F(G.GFA_PY), M2); else if (q === 'GFA_M2') xs.set(r, 2, F(G.GFA_M2), M2); else xs.set(r, 2, q, '#,##0');
        xs.set(r, 3, unit); xs.set(r, 4, price, WON); xs.set(r, 5, F(`C${R}*E${R}`), WON);
      }
      xs.set(r, 6, note); r++;
    });
    const xe = r;               // 기타사업비 마지막 엑셀행 = xe
    xs.set(r, 1, '기타사업비 소계'); xs.set(r, 5, F(`SUM(F${x0}:F${xe})`), WON); const ETC = `'지출'!$F$${r + 1}`; r++;
    xs.set(r, 0, '금융비용'); xs.set(r, 1, '사업비 금융비용'); xs.set(r, 5, F(`(F4+F${r})*${G.FIN_SHARE}*${G.FIN_RATE}*${G.FIN_YEARS}`), WON);
    xs.set(r, 6, '(공사비+기타사업비) × 대여비율 × 금리 × 기간. 이주비 금융비용은 조합원 개별부담(이자후불제)으로 봄'); const FIN = `'지출'!$F$${r + 1}`; r++;
    xs.set(r, 1, '지출 합계'); xs.set(r, 5, F(`F4+${ETC.split('!')[1]}+${FIN.split('!')[1]}`), WON); const XT = `'지출'!$F$${r + 1}`; r += 2;
    // 9분류 요약 (부동산원 보고서 형식)
    xs.set(r, 0, '분류별 요약 (부동산원 보고서 형식)'); r++;
    xs.row(r, ['분류', '', '', '', '', '금액(원)', '비중']); r++;
    const cats = ['공사비', '보상비', '설계감리비', '분양경비', '외주용역비', '세금과공과', '금융비용', '관리비', '부대경비', '조사측량비', '기타경비'];
    const c0 = r;
    cats.forEach(cname => {
      const R = r + 1;
      const f = cname === '공사비' ? `F4+SUMIF($A$${x0}:$A$${xe},"공사비",$F$${x0}:$F$${xe})` : cname === '금융비용' ? `${FIN.split('!')[1]}+SUMIF($A$${x0}:$A$${xe},"금융비용",$F$${x0}:$F$${xe})` : `SUMIF($A$${x0}:$A$${xe},"${cname}",$F$${x0}:$F$${xe})`;
      xs.set(r, 0, cname); xs.set(r, 5, F(f), WON); xs.set(r, 6, F(`IF(${XT.split('!')[1]}=0,0,F${R}/${XT.split('!')[1]})`), PCT); r++;
    });
    xs.set(r, 0, '합계'); xs.set(r, 5, F(`SUM(F${c0 + 1}:F${r})`), WON);
    xs.cols([12, 30, 12, 6, 14, 17, 60]);
    const X = { constr: `'지출'!$F$4`, etc: ETC, fin: FIN, total: XT };

    // ---- 총괄 ----
    const sm = Sheet();
    sm.set(0, 0, `${z.name || ''} 사업성 검토(안)`);
    sm.set(2, 0, '1) 종전토지 등의 감정평가 예상액'); sm.set(2, 5, '단위 : 원');
    sm.row(3, ['항목', '추정금액(원)', '비고']);
    sm.row(4, ['종전자산추정 총 금액', F(Z.total), F(`"총 시행면적: "&TEXT(${Z.area}/${PY},"#,##0.00")&"평 ("&TEXT(${Z.area},"#,##0.00")&"㎡), 공시지가의 "&TEXT(${G.MULT}*100,"0")&"%"`)]);
    sm.row(5, ['국공유지 추정금액', F(Z.pub), F(`"국공유지 면적 "&TEXT('종전자산'!E${zt + 3},"#,##0.00")&"㎡"`)]);
    sm.row(6, ['청산대상자 추정금액', F(`(B5-B6)*(1-${G.CONSENT})`), F(`TEXT(1-${G.CONSENT},"0%")&" (조합설립 미동의자 추정)"`)]);
    sm.row(7, ['분양대상자 추정금액', F(`(B5-B6)*${G.CONSENT}`), F(`TEXT(${G.CONSENT},"0%")&" (조합설립 동의자 추정)"`)]);
    sm.row(8, ['종전자산추정(사유지) 평당 단가', F(`IF(${Z.privArea}=0,0,(B5-B6)/(${Z.privArea}/${PY}))`), F(`"사유지 면적 약 "&TEXT(${Z.privArea}/${PY},"#,##0.00")&"평"`)]);
    [4, 5, 6, 7, 8].forEach(rw => { sm.ws[A1(rw, 1)].z = WON; });
    sm.set(10, 0, '2) 지출(총사업비)');
    sm.row(11, ['구분', '추정금액(원)', '비고']);
    sm.row(12, ['공사비', F(X.constr), F(`TEXT(${G.GFA_PY},"#,##0.00")&"평 × "&TEXT(${G.CONST_PY},"#,##0")&"원"`)]);
    sm.row(13, ['금융비용', F(X.fin), '사업비 금융비용(이주비 금융비용은 조합원 개별부담)']);
    sm.row(14, ['기타사업비용', F(X.etc), '공사비·금융비용 외 설계·감리·정비업체·보상·관리·외주용역·부담금 등']);
    sm.row(15, ['지출 합계', F(X.total), F(`"기타사업비/공사비 = "&TEXT(B15/B13,"0.0%")`)]);
    [12, 13, 14, 15].forEach(rw => { sm.ws[A1(rw, 1)].z = WON; });
    sm.set(17, 0, '3) 수입(분양수입금 등)');
    sm.row(18, ['구분', '추정금액(원)', '비고']);
    sm.row(19, ['수입 계', F(V.total), F(`"공동주택 "&TEXT('수입'!E${UT},"#,##0")&"세대, 근린생활시설 등"`)]); sm.ws[A1(19, 1)].z = WON;
    sm.set(21, 0, '4) 비례율(사업성)');
    sm.row(22, ['구분', '추정 비례율(%)', '산식']);
    sm.row(23, ['구청 검토식', F('IF(B8=0,0,(B20-B16)/B8*100)'), '(수입 − 지출) ÷ 분양대상자 추정금액 × 100']);
    sm.row(24, ['부동산원식', F('IF((B5-B6)=0,0,(B20-B16)/(B5-B6)*100)'), '(수입 − 지출) ÷ 종전자산추정액(국공유지 제외) × 100']);
    sm.ws[A1(23, 1)].z = '0.00'; sm.ws[A1(24, 1)].z = '0.00';
    sm.row(26, ['수입 − 지출', F('B20-B16')]); sm.ws[A1(26, 1)].z = WON;
    sm.set(28, 0, '※ 본 비례율(사업성)은 수입(분양가격), 지출(공사비 등), 종전자산금액에 따라 변경될 수 있음. 개략적인 분담금 추정·검증 용도');
    sm.cols([30, 20, 70]);
    const SUM = { ratio: `'총괄'!$B$24`, ratio2: `'총괄'!$B$25`, inc: `'총괄'!$B$20`, out: `'총괄'!$B$16`, base: `'총괄'!$B$8`, base2: `('총괄'!$B$5-'총괄'!$B$6)` };

    // ---- 민감도 (조합원 분양가 × 공사비) ----
    const ss = Sheet();
    ss.set(0, 0, '비례율 민감도 분석 - 조합원 분양가 × 공사비 (구청 검토식 분모)');
    ss.set(2, 0, '조합원분양가 변동 \\ 공사비 변동');
    p.sensSteps.forEach((b, j) => { ss.set(2, 1 + j, b, '+0%;-0%;0%'); });
    p.sensSteps.forEach((a, i) => {
      const r2 = 3 + i; ss.set(r2, 0, a, '+0%;-0%;0%');
      p.sensSteps.forEach((b, j) => {
        const col = XLSX.utils.encode_col(1 + j);
        ss.set(r2, 1 + j, F(`IF(${SUM.base}=0,0,((${SUM.inc}+(${V.member}+${V.rMember})*$A${r2 + 1})-(${SUM.out}+${X.constr}*${col}$3*(1+${G.FIN_SHARE}*${G.FIN_RATE}*${G.FIN_YEARS})))/${SUM.base}*100)`), '0.00');
      });
    });
    ss.set(9, 0, '※ 공사비 변동분에는 금융비용 증감을 함께 반영. 행 = 조합원 분양가 변동률, 열 = 평당 공사비 변동률');
    ss.cols([30, 12, 12, 12, 12, 12]);

    // ---- 평형별 분담금 (종전자산 예시) ----
    const bs = Sheet();
    bs.set(0, 0, '추정 분담금 - 종전자산가액 예시 기준');
    bs.row(2, ['종전자산(원)', F(G.BASE_ASSET)]); bs.ws[A1(2, 1)].z = WON;
    bs.row(3, ['비례율(%)', F(SUM.ratio)]); bs.ws[A1(3, 1)].z = '0.00';
    bs.row(4, ['권리가액(원)', F('ROUND(B3*B4/100,-3)')]); bs.ws[A1(4, 1)].z = WON;
    bs.row(6, ['분양평형', '조합원분양가(원)', '추정분담금(원)', '부담/환급']);
    U.forEach((u, i) => {
      const R = 8 + i;
      bs.row(7 + i, [u.type, F(`'수입'!J${4 + i}`), F(`B${R}-$B$5`), F(`IF(C${R}>=0,"부담","환급")`)], 0, [null, WON, WON]);
    });
    bs.cols([16, 18, 18, 10]);

    XLSX.utils.book_append_sheet(wb, sm.done(), '총괄');
    XLSX.utils.book_append_sheet(wb, ga.done(), '가정값');
    XLSX.utils.book_append_sheet(wb, zs.done(), '종전자산');
    XLSX.utils.book_append_sheet(wb, sv.done(), '수입');
    XLSX.utils.book_append_sheet(wb, xs.done(), '지출');
    XLSX.utils.book_append_sheet(wb, ss.done(), '민감도');
    XLSX.utils.book_append_sheet(wb, bs.done(), '평형별분담금');

    // ---- 물건별(소유자별) 추정분담금 (명부 있을 때) ----
    if (z.owners && z.owners.length) {
      const os = Sheet();
      os.set(0, 0, '토지등소유자별 추정분담금 (비공개 - 개인정보 포함, 토지 공시지가 기준 개략치)');
      os.row(2, ['연번', '성명', '소유필지', '편입 소유면적(㎡)', '종전자산 추정(원)', '비례율(%)', '권리가액(원)', ...U.map(u => `${u.type} 분담금(원)`)]);
      const jg = {}; P.forEach(q => { jg[q.jibun] = +q.jiga || 0; });
      let r3 = 3;
      z.owners.filter(o => !o.isPublic).forEach((o, i) => {
        const R = r3 + 1;
        const parts = (o.parcels || []).filter(q => q.jibun in jg);
        const expr = parts.map(q => `${(+q.inArea || +q.ownArea || 0)}*${jg[q.jibun]}`).join('+') || '0';
        const areaSum = parts.reduce((a, q) => a + (+q.inArea || +q.ownArea || 0), 0);
        os.row(r3, [i + 1, o.name, parts.map(q => q.jibun).join(', '), areaSum], 0, [null, null, null, M2]);
        os.set(r3, 4, F(`ROUND((${expr})*${G.MULT},-3)`), WON);
        os.set(r3, 5, F(SUM.ratio), '0.00');
        os.set(r3, 6, F(`ROUND(E${R}*F${R}/100,-3)`), WON);
        U.forEach((u, k) => os.set(r3, 7 + k, F(`'수입'!$J$${4 + k}-G${R}`), WON));
        r3++;
      });
      os.set(r3 + 1, 0, '※ 토지 지분면적 × 개별공시지가 × 배율만 반영(건축물 가액 미포함). 집합건물·건축물은 감정평가 또는 거래사례로 보정 필요');
      os.cols([6, 12, 24, 14, 16, 9, 16, ...U.map(() => 16)]);
      XLSX.utils.book_append_sheet(wb, os.done(), '소유자별분담금(비공개)');
    }

    if (fname !== false) XLSX.writeFile(wb, fname || `${z.name || '정비구역'}_사업성검토.xlsx`);
    return wb;
  }

  // 화면용 간이 계산 (비례상수 방식): 기타사업비 = 공사비 × k
  function quick(z, prm = {}) {
    const p = { ...DEFAULTS, ...prm, retail: { ...DEFAULTS.retail, ...(prm.retail || {}) } };
    const NS = netSite(z.parcels, p.infraM2), site = NS.site;
    const land = z.parcels.reduce((a, q) => a + (+q.area || 0) * (+q.jiga || 0), 0) * p.multiplier;
    const pub = z.parcels.filter(q => isPublic(q.ownerType)).reduce((a, q) => a + (+q.area || 0) * (+q.jiga || 0), 0) * p.multiplier;
    const gfa = p.gfaM2 || NS.net * p.far / 100 * p.gfaFactor;
    const constr = gfa / PY * p.constPerPy;
    let income = prm.income || 0;
    if (!income) {
      const AU = autoUnits(p, gfa, z);
      income = AU.units.reduce((a, u) => { const py = u.supply / PY; return a + py * u.genPy * (u.general + u.member * p.memberRatio); }, 0)
        + (p.retail ? (p.retail.areaM2 || 0) / PY * ((p.retail.memberShare || 0) * p.retail.memberPy + (1 - (p.retail.memberShare || 0)) * p.retail.genPy) : 0);
    }
    const res = k => { const etc = constr * k; const fin = (constr + etc) * p.fin.share * p.fin.rate * p.fin.years; const out = constr + etc + fin; const base = (land - pub) * p.consent; return base ? (income - out) / base * 100 : 0; };
    return { site, infra: NS.infra, netSite: NS.net, land, pub, gfa, constr, income, ratioLow: res(0.44), ratioMid: res(0.36), ratioHigh: res(0.27) };
  }

  return { exportForms, exportFrame, sheet9Frame, feasibility, quick, autoUnits, sheet4, sheet4Review, sheet5, sheet6, sheet9, countOwners, DEFAULTS, costItems, isPublic, isInfra, netSite };
})();

if (typeof module !== 'undefined') module.exports = Forms;
