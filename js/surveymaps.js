'use strict';

// =====================================================================
// 기초조사 현황도 (별지 제5호 15번) — A4 한 장에 하나씩 13장, 인쇄 → PDF로 저장
//   도면 엔진(Export.collect: TM 좌표·실제 축척·건물 위치 보정)을 그대로 쓰고, 항목마다 필지·건물을 색으로 나눔
//   필지 값은 토지조서(토지대장 기준), 건물 값은 같은 필지의 건축물대장(없으면 GIS건물통합정보)
//   용도지역·도시계획시설은 브이월드(국토교통부) 자료
// =====================================================================
const SurveyMaps = (() => {
  const PAL = ['#e76f51', '#f4a261', '#e9c46a', '#8ab17d', '#2a9d8f', '#457b9d', '#6d597a', '#b56576', '#90be6d', '#bc6c25', '#7f5539', '#a8dadc'];
  const GRAY = '#d9d9d9', NONE = '#f3f3f3';
  const JM = { 대: '대지', 도: '도로', 구: '구거', 답: '답', 임: '임야', 전: '전', 잡: '잡종지', 차: '주차장', 학: '학교용지', 종: '종교용지', 천: '하천', 공: '공원', 제: '제방', 철: '철도용지', 수: '수도용지', 유: '유지', 창: '창고용지', 장: '공장용지', 주: '주유소용지', 목: '목장용지', 과: '과수원', 광: '광천지', 염: '염전', 사: '사적지', 묘: '묘지', 원: '유원지', 체: '체육용지' };
  const jimokName = j => { j = String(j || '').trim(); return JM[j] || j || '기타'; };
  const INFRA = ['도로', '구거', '하천', '공원', '제방', '철도용지', '수도용지'];
  const isRes = u => /주택|아파트|다가구|다세대|연립/.test(u || '');
  const isDet = u => /단독|다가구|다중주택/.test(u || '');
  const isApt = u => /아파트|연립|다세대/.test(u || '');
  const n1 = v => fmt(v, 1);

  // 용도지역 색 (주거 노랑·갈색 / 상업 빨강 / 공업 보라 / 녹지 초록 / 그 밖 회색)
  const zoneColor = n => (/전용주거/.test(n) ? '#fff3b0' : /제1종일반/.test(n) ? '#ffe08a' : /제2종일반/.test(n) ? '#f9c74f' : /제3종일반/.test(n) ? '#f4a261' : /준주거/.test(n) ? '#e9a17a'
    : /상업/.test(n) ? '#e5737a' : /공업/.test(n) ? '#b8a1d9' : /녹지/.test(n) ? '#a8d5a2' : /관리|농림|자연환경/.test(n) ? '#cfe8c9' : '#cccccc');

  // ---------- 자료 모으기 ----------
  async function collect(say) {
    say('도면 자료(지적·건물)를 불러오는 중…');
    const d = await Export.collect();
    const landBy = new Map(S.lands.filter(l => l.pnu).map(l => [l.pnu, l]));
    // 필지: 토지조서 값
    d.parcels.forEach(p => {
      const l = landBy.get(p.pnu);
      p.land = l || null;
      p.jm = jimokName((l && (l.ledgerJimok || l.jimok)) || p.jimok);
      p.own = l ? (l.ownerType === '국공유지' ? '국공유지' : '사유지') : (['도', '구', '천', '제', '공'].includes(p.jimok) ? '국공유지' : '사유지');
      p.sz = l ? +l.area || 0 : p.area;
    });
    // 건물: 같은 필지의 건축물대장과 짝짓기 (대장 1동이면 그 필지 건물 모두, 여러 동이면 바닥면적이 가까운 순)
    const ledBy = new Map();
    S.buildings.filter(b => b.ledger && b.pnu).forEach(b => { const a = ledBy.get(b.pnu) || []; a.push(b); ledBy.set(b.pnu, a); });
    const gisBy = new Map();
    d.buildings.filter(b => b.inZone).forEach(b => { const a = gisBy.get(b.pnu) || []; a.push(b); gisBy.set(b.pnu, a); });
    gisBy.forEach((G, pnu) => {
      const L = (ledBy.get(pnu) || []).slice();
      const land = landBy.get(pnu);
      if (!L.length) { G.forEach(g => { g.src = g.gis; g.permit = land && land.ledgerEmpty === true ? '무' : '확인 전'; }); return; }
      if (L.length === 1) { G.forEach(g => { g.src = L[0]; g.permit = '유'; }); return; }
      const gs = G.slice().sort((a, b) => b.area - a.area), ls = L.slice().sort((a, b) => (+b.archArea || 0) - (+a.archArea || 0));
      gs.forEach((g, i) => {
        g.src = ls[i] || ls.reduce((m, x) => (Math.abs((+x.archArea || 0) - g.area) < Math.abs((+m.archArea || 0) - g.area) ? x : m), ls[0]);
        g.permit = '유';
        g.unsure = G.length !== L.length;   // 동수가 달라 짝이 어긋날 수 있음
      });
    });
    d.buildings.forEach(b => {
      const s = b.src || b.gis;
      b.use = s.use || '';
      b.struct = s.structureName || s.structure || '';
      b.floors = +s.floors || 0;
      b.age = Calc.age(S, s);
      b.isOld = isFinite(b.age) ? Calc.isOld(S, s) : null;
    });
    // 용도지역·도시계획시설 (브이월드)
    const box = `BOX(${d.lonlatBox.join(',')})`;
    const proj = g => Export.rings(g).map(r => r.map(c => d.P.fwd(c)));
    const get = async layer => { try { return (await VWorld.dataAll(layer, box, 3)).map(f => ({ f, rings: proj(f), props: f.properties || {} })); } catch (e) { return []; } };
    // 도시계획시설: 구역 안에 든 부분(도형·면적)
    const zoneIn = x => { let g = null; try { g = turf.intersect(x.f, S.area.geojson); } catch (e) { g = null; } x.inRings = g ? proj(g) : []; x.inArea = g ? turf.area(g) : 0; };
    say('용도지역·도시계획시설 자료를 불러오는 중…');
    d.zoning = await get('LT_C_UQ111');
    d.upis = {};
    const UPIS = { LT_C_UPISUQ151: '도로', LT_C_UPISUQ152: '교통시설', LT_C_UPISUQ153: '공간시설', LT_C_UPISUQ154: '유통·공급시설', LT_C_UPISUQ155: '공공·문화체육시설', LT_C_UPISUQ156: '방재시설', LT_C_UPISUQ157: '보건위생시설', LT_C_UPISUQ158: '환경기초시설', LT_C_UPISUQ159: '기타시설' };
    for (const [k, name] of Object.entries(UPIS)) { const fs = await get(k); fs.forEach(zoneIn); if (fs.length) d.upis[name] = fs; }
    return d;
  }

  // ---------- 13장 정의 ----------
  //   kind: 'parcel' 구역 안 필지를 칠함 | 'bldg' 구역 안 건물을 칠함 | 'layer' 별도 도형(용도지역·시설)
  //   cls(x): 구분 이름(없으면 칠하지 않음), order: 일러두기 순서(없으면 나온 순서)
  function themes(d) {
    const bj = new Map(); S.buildings.forEach(b => { const a = bj.get(b.jibun) || []; a.push(b); bj.set(b.jibun, a); });
    const T = [
      { no: '가', title: '토지이용 현황도', kind: 'parcel', note: '건축물은 토지조서·건축물조서 기준(제5호 2번 표와 같은 분류)',
        order: ['주거용 건축물', '비주거용 건축물', '나대지', '정비기반시설 부지', '기타'],
        colors: ['#f9c74f', '#e76f51', '#e9edc9', '#adb5bd', '#cdb4db'],
        cls: p => { const bs = p.land ? bj.get(p.land.jibun) || [] : []; return INFRA.includes(p.jm) ? '정비기반시설 부지' : p.jm !== '대지' ? '기타' : !bs.length ? '나대지' : bs.some(b => isRes(b.use)) ? '주거용 건축물' : '비주거용 건축물'; } },
      { no: '나', title: '도시계획시설 설치현황도', kind: 'upis', note: '구역 안 도시계획시설(UPIS 결정 도면). 색 채움: 설치(집행완료·부분집행), 빗금: 미집행(계획), 점선: 집행 여부 미상. 면적은 구역과 겹친 부분' },
      { no: '다', title: '사업지 주변 가로망 현황도', kind: 'roads', note: '회색: 지적상 도로(지목 도로) / 색: 도시계획도로(대로·중로·소로). 도로 폭·교통량은 현장 조사 필요' },
      { no: '라', title: '용도지역 현황도', kind: 'zoning', note: '자료: 브이월드 용도지역(LT_C_UQ111)' },
      { no: '마', title: '지목 현황도', kind: 'parcel', note: '지목은 토지대장 기준', cls: p => p.jm },
      { no: '바', title: '토지소유 현황도', kind: 'parcel', note: '소유 구분은 토지조서 기준(관리청별 구분은 공부에 없음)', order: ['사유지', '국공유지'], colors: ['#f6bd60', '#84a59d'], cls: p => p.own },
      { no: '사', title: '필지규모별 현황도', kind: 'parcel', note: '면적은 토지조서(토지대장 × 편입비율) 기준, 90㎡ 기준',
        order: ['대지 90㎡ 미만', '대지 90㎡ 이상', '대지 외 90㎡ 미만', '대지 외 90㎡ 이상'], colors: ['#e63946', '#f4a261', '#a8dadc', '#457b9d'],
        cls: p => `${p.jm === '대지' ? '대지' : '대지 외'} 90㎡ ${p.sz < 90 ? '미만' : '이상'}` },
      { no: '아', title: '건축물 허가유무 현황도', kind: 'bldg', note: '유허가: 건축물대장 있음 / 무허가: 대장 없음(무허가건축물확인원으로 확인)', order: ['유허가', '무허가', '대장 확인 전'], colors: ['#8ab17d', '#e63946', GRAY],
        cls: b => (b.permit === '유' ? '유허가' : b.permit === '무' ? '무허가' : '대장 확인 전') },
      { no: '자', title: '건축물 경과연수 현황도', kind: 'bldg', note: `노후도 기준일 ${Calc.baseDate(S).toLocaleDateString('sv-SE')} 기준 사용승인 후 경과연수`, order: ['20년 미만', '20~29년', '30~39년', '40년 이상', '정보 없음'], colors: ['#a8dadc', '#f9c74f', '#f4a261', '#e63946', GRAY],
        cls: b => (!isFinite(b.age) ? '정보 없음' : b.age < 20 ? '20년 미만' : b.age < 30 ? '20~29년' : b.age < 40 ? '30~39년' : '40년 이상') },
      { no: '차', title: '건축물 용도 현황도', kind: 'bldg', note: '건축물대장 주용도 기준', order: ['단독주택', '공동주택', '근린생활시설', '기타'], colors: ['#f9c74f', '#f4a261', '#e76f51', '#9d8189'],
        cls: b => (isDet(b.use) ? '단독주택' : isApt(b.use) ? '공동주택' : /근린/.test(b.use) ? '근린생활시설' : '기타') },
      { no: '카', title: '건축물 구조 현황도', kind: 'bldg', note: '건축물대장 구조 기준', order: ['철근콘크리트·철골조', '조적·벽돌조', '블록조', '목조', '기타'], colors: ['#457b9d', '#e76f51', '#f4a261', '#8ab17d', GRAY],
        cls: b => { const s = b.struct; return /목/.test(s) ? '목조' : /블록|블럭|시멘트|세멘/.test(s) ? '블록조' : /조적|벽돌|연와|석조/.test(s) ? '조적·벽돌조' : /철|콘크리트|강구조/.test(s) ? '철근콘크리트·철골조' : '기타'; } },
      { no: '타', title: '건축물 층수 현황도', kind: 'bldg', note: '지상층 기준', order: ['1층', '2층', '3층', '4층', '5층 이상', '정보 없음'], colors: ['#e9edc9', '#ccd5ae', '#a3b18a', '#588157', '#344e41', GRAY],
        cls: b => (!b.floors ? '정보 없음' : b.floors >= 5 ? '5층 이상' : `${b.floors}층`) },
      { no: '파', title: '건축물 노후·불량 현황도', kind: 'bldg', note: `노후 기준: 철근콘크리트·철골 ${S.criteria.rcYears}년, 기타 ${S.criteria.otherYears}년 이상 (기준일 ${Calc.baseDate(S).toLocaleDateString('sv-SE')})`,
        order: ['노후·불량건축물', '일반건축물', '판정 불가(사용승인일 없음)'], colors: ['#e63946', '#a8dadc', GRAY],
        cls: b => (b.isOld == null ? '판정 불가(사용승인일 없음)' : b.isOld ? '노후·불량건축물' : '일반건축물') },
    ];
    return T;
  }

  // 구분별 색 정하기 (order·colors가 있으면 그대로, 없으면 나온 순서대로 팔레트)
  function legendOf(th, items) {
    const keys = th.order ? th.order.slice() : [];
    items.forEach(x => { const k = th.cls(x); if (k && !keys.includes(k)) keys.push(k); });
    return keys.map((k, i) => ({ key: k, color: (th.colors && th.colors[i]) || PAL[i % PAL.length], n: items.filter(x => th.cls(x) === k).length, area: items.filter(x => th.cls(x) === k).reduce((a, x) => a + (x.sz || x.area || 0), 0) }));
  }

  // ---------- 한 장 (A4 가로, mm) ----------
  function sheet(d, th, idx) {
    const W = 297, H = 210, m = 10, side = 78, gap = 6;
    const fx = m, fy = m + 8, fw = W - m * 2 - side - gap, fh = H - m * 2 - 8;
    const zx = d.zone.flat().map(c => c[0]), zy = d.zone.flat().map(c => c[1]);
    let x0 = Math.min(...zx), x1 = Math.max(...zx), y0 = Math.min(...zy), y1 = Math.max(...zy);
    const pad = Math.max(x1 - x0, y1 - y0) * (th.kind === 'roads' || th.kind === 'zoning' ? 0.25 : th.kind === 'upis' ? 0.12 : 0.08);
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const scale = Export.niceScale(Math.max((x1 - x0) / (fw / 1000), (y1 - y0) / (fh / 1000)));
    const k = 1000 / scale;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ox = fx + fw / 2, oy = fy + fh / 2;
    const tx = x => +(ox + (x - cx) * k).toFixed(2), ty = y => +(oy - (y - cy) * k).toFixed(2);
    const path = rs => rs.map(r => 'M' + r.map(c => tx(c[0]) + ' ' + ty(c[1])).join('L') + 'Z').join('');
    const out = [], el = s => out.push(s);
    const cid = `f${idx}`;
    el(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif">`);
    el(`<defs><clipPath id="${cid}"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}"/></clipPath>`
      + `<pattern id="h${idx}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" stroke="#555" stroke-width="0.35"/></pattern></defs>`);
    el(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    // 제목 띠
    el(`<text x="${m}" y="${m + 4}" font-size="5" font-weight="700">${esc(th.no)}. ${esc(th.title)}</text>`);
    el(`<text x="${W - m}" y="${m + 4}" font-size="2.6" text-anchor="end" fill="#555">[별지 제5호서식] 기초 조사·확인 내역서 15. 기초조사 현황도</text>`);
    el(`<g clip-path="url(#${cid})">`);

    let legend = [];
    const inP = d.parcels.filter(p => p.inZone), inB = d.buildings.filter(b => b.inZone);
    if (th.kind === 'zoning') {
      const names = [...new Set(d.zoning.map(z => z.props.uname).filter(Boolean))];
      d.zoning.forEach(z => el(`<path d="${path(z.rings)}" fill="${zoneColor(z.props.uname || '')}" fill-opacity="0.75" stroke="#666" stroke-width="0.15" fill-rule="evenodd"/>`));
      legend = names.map(n => ({ key: n, color: zoneColor(n) }));
    } else if (th.kind === 'upis') {
      // 구역 안 도시계획시설만 색으로 (구역 밖은 위치 참고용 흐린 테두리)
      d.parcels.filter(p => p.jimok === '도').forEach(p => el(`<path d="${path(p.rings)}" fill="#f4f4f4" stroke="none"/>`));
      let any = false;
      Object.entries(d.upis).forEach(([name, fs], i) => {
        const c = PAL[i % PAL.length];
        fs.forEach(f => el(`<path d="${path(f.rings)}" fill="none" stroke="#bbb" stroke-width="0.15" stroke-dasharray="0.8 0.6"/>`));
        const inF = fs.filter(f => f.inArea >= 1);
        // 집행 여부: 집행완료·부분집행 = 설치(채움), 미집행 = 계획(빗금), 그 밖(기타·빈칸) = 미상(점선 테두리)
        inF.forEach(f => {
          const e = f.props.exc_nam || '', st = /미집행/.test(e) ? 'plan' : /집행/.test(e) ? 'done' : 'unk';
          const fill = st === 'done' ? c : st === 'plan' ? `url(#h${idx})` : 'none';
          el(`<path d="${path(f.inRings)}" fill="${fill}" fill-opacity="${st === 'done' ? 0.55 : 1}" stroke="${c}" stroke-width="${st === 'unk' ? 0.25 : 0.4}"${st === 'unk' ? ' stroke-dasharray="1 0.6"' : ''} fill-rule="evenodd"/>`);
        });
        if (!inF.length) return;
        any = true;
        const names = [...new Set(inF.map(f => f.props.dgm_nm).filter(Boolean))];
        const cntBy = re => inF.filter(f => re(f.props.exc_nam || '')).length;
        const done = cntBy(e => /집행/.test(e) && !/미집행/.test(e)), plan = cntBy(e => /미집행/.test(e));
        legend.push({ key: `${name}${names.length ? ` (${names.slice(0, 3).join('·')}${names.length > 3 ? ' 등' : ''})` : ''} ${inF.length}건 · 구역 안 ${n1(inF.reduce((a, f) => a + f.inArea, 0))}㎡ (설치 ${done} · 미집행 ${plan})`, color: c });
      });
      if (any) {
        legend.push({ key: '미집행(계획)', pattern: true });
        legend.push({ key: '집행 여부 미상(점선 테두리)', line: '#555', dash: true });
      } else legend.push({ key: '구역 안에 도시계획시설 없음', color: '#fff' });
      legend.push({ key: '구역 밖 도시계획시설(참고)', line: '#bbb', dash: true });
    } else if (th.kind === 'roads') {
      const roads = d.parcels.filter(p => p.jimok === '도');
      roads.forEach(p => el(`<path d="${path(p.rings)}" fill="#cfcfcf" stroke="none"/>`));
      legend.push({ key: '지적상 도로(지목 도로)', color: '#cfcfcf', n: roads.length, unit: '필지' });
      const grade = n => (/광로/.test(n) ? '광로' : /대로/.test(n) ? '대로' : /중로/.test(n) ? '중로' : /소로/.test(n) ? '소로' : '그 밖의 도로');
      const GC = { 광로: '#6a040f', 대로: '#d00000', 중로: '#f48c06', 소로: '#ffba08', '그 밖의 도로': '#9d8189' };
      const R = d.upis['도로'] || [];
      R.forEach(f => el(`<path d="${path(f.rings)}" fill="${GC[grade(f.props.dgm_nm || '')]}" fill-opacity="0.6" stroke="${GC[grade(f.props.dgm_nm || '')]}" stroke-width="0.25" fill-rule="evenodd"/>`));
      Object.keys(GC).forEach(g => { const fs = R.filter(f => grade(f.props.dgm_nm || '') === g); if (fs.length) legend.push({ key: `도시계획도로 ${g} (${[...new Set(fs.map(f => f.props.dgm_nm))].slice(0, 3).join('·')})`, color: GC[g], n: fs.length, unit: '건' }); });
    } else if (th.kind === 'parcel') {
      legend = legendOf(th, inP);
      const col = new Map(legend.map(l => [l.key, l.color]));
      inP.forEach(p => el(`<path d="${path(p.rings)}" fill="${col.get(th.cls(p)) || NONE}" stroke="none" fill-rule="evenodd"/>`));
      legend.forEach(l => { l.unit = '필지'; });
    } else if (th.kind === 'bldg') {
      d.parcels.filter(p => p.jimok === '도').forEach(p => el(`<path d="${path(p.rings)}" fill="#f1f1f1" stroke="none"/>`));
      legend = legendOf(th, inB);
      const col = new Map(legend.map(l => [l.key, l.color]));
      d.buildings.filter(b => !b.inZone).forEach(b => el(`<path d="${path(b.rings)}" fill="#ececec" stroke="#aaa" stroke-width="0.08" fill-rule="evenodd"/>`));
      inB.forEach(b => el(`<path d="${path(b.rings)}" fill="${col.get(th.cls(b)) || NONE}" stroke="${b.unsure ? '#c00' : '#444'}" stroke-width="${b.unsure ? 0.25 : 0.1}"${b.unsure ? ' stroke-dasharray="0.8 0.5"' : ''} fill-rule="evenodd"/>`));
      legend.forEach(l => { l.unit = '동'; });
      if (inB.some(b => b.unsure)) legend.push({ key: '대장과 짝 확인 필요(빨간 점선)', line: '#c00', dash: true });
    }
    // 필지선·구역계·지번
    d.parcels.forEach(p => el(`<path d="${path(p.rings)}" fill="none" stroke="${p.inZone ? '#333' : '#999'}" stroke-width="${p.inZone ? 0.14 : 0.1}"/>`));
    el(`<path d="${path(d.zone)}" fill="none" stroke="#d40000" stroke-width="0.6" stroke-linejoin="round"/>`);
    d.parcels.forEach(p => {
      if (!p.label || p.area * k * k < 25) return;
      el(`<text x="${tx(p.label[0])}" y="${ty(p.label[1])}" font-size="1.6" text-anchor="middle" dominant-baseline="middle" fill="${p.inZone ? '#111' : '#aaa'}">${esc(p.jibun)}</text>`);
    });
    el(`</g><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="#000" stroke-width="0.3"/>`);
    // 방위표·축척 막대
    const nx = fx + fw - 10, ny = fy + 12;
    el(`<path d="M${nx} ${ny - 7}L${nx + 3} ${ny + 3}L${nx} ${ny + 1}L${nx - 3} ${ny + 3}Z" fill="#000"/><text x="${nx}" y="${ny - 8.5}" font-size="3" text-anchor="middle" font-weight="700">N</text>`);
    const barM = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(v => v * k >= 25) || 1000;
    const bx = fx + 6, by = fy + fh - 7, bl = barM * k;
    el(`<g stroke="#000" stroke-width="0.25"><rect x="${bx}" y="${by}" width="${bl / 2}" height="1.4" fill="#000"/><rect x="${bx + bl / 2}" y="${by}" width="${bl / 2}" height="1.4" fill="#fff"/></g>`);
    [0, barM / 2, barM].forEach((v, i) => el(`<text x="${bx + bl * i / 2}" y="${by - 1.2}" font-size="2.2" text-anchor="middle">${v}${i === 2 ? 'm' : ''}</text>`));
    // 오른쪽: 사업 정보·일러두기
    const sx = fx + fw + gap;
    let y = fy + 4;
    const text = (t, size = 2.4, w = 400, c = '#111') => { el(`<text x="${sx}" y="${y}" font-size="${size}" font-weight="${w}" fill="${c}">${esc(t)}</text>`); y += size * 1.6; };
    text(S.meta.name || '정비구역', 3.6, 700);
    const wrap = (t, n = 30) => { const a = []; t = String(t); while (t.length > n) { a.push(t.slice(0, n)); t = t.slice(n); } a.push(t); return a; };
    wrap(S.meta.location || '').forEach(t => text(t, 2.3, 400, '#555'));
    text(`축척 1:${fmt(scale)} (A4) · 구역 ${fmt(turf.area(S.area.geojson))}㎡`, 2.3, 400, '#555');
    y += 3;
    text('일러두기', 2.8, 700);
    const lineL = (color, w, dash) => el(`<line x1="${sx}" x2="${sx + 8}" y1="${y - 0.8}" y2="${y - 0.8}" stroke="${color}" stroke-width="${w}"${dash ? ' stroke-dasharray="0.8 0.5"' : ''}/>`);
    lineL('#d40000', 0.6); el(`<text x="${sx + 11}" y="${y}" font-size="2.3">구역계</text>`); y += 4.2;
    legend.forEach(l => {
      if (l.line) lineL(l.line, 0.3, l.dash);
      else el(`<rect x="${sx}" y="${y - 2.4}" width="8" height="3" fill="${l.pattern ? `url(#h${idx})` : l.color}" stroke="#555" stroke-width="0.08"/>`);
      const cnt = l.n != null ? ` ${fmt(l.n)}${l.unit || ''}${l.unit === '필지' && l.area ? ` · ${n1(l.area)}㎡` : ''}` : '';
      wrap(l.key + cnt, 30).forEach((t, i) => el(`<text x="${sx + 11}" y="${y + i * 3}" font-size="2.2">${esc(t)}</text>`));
      y += 4.2 + (wrap(l.key + cnt, 30).length - 1) * 3;
    });
    // 주석·출처
    const notes = [...wrap(th.note || '', 36), '자료: 브이월드(국토교통부) 연속지적도·GIS건물통합정보·도시계획,', '토지대장·건축물대장(공부). 사업 검토용 참고도이며 측량 성과가 아님.'];
    let ny2 = fy + fh - notes.length * 3.1;
    notes.forEach(t => { el(`<text x="${sx}" y="${ny2}" font-size="2" fill="#666">${esc(t)}</text>`); ny2 += 3.1; });
    el('</svg>');
    return out.join('');
  }

  // 13장 SVG (화면 확인·인쇄 공용)
  async function build(say = () => {}) {
    const d = await collect(say);
    say('현황도 13장을 그리는 중…');
    return themes(d).map((th, i) => sheet(d, th, i));
  }

  // 인쇄 창 → "PDF로 저장"
  async function pdf(say = () => {}) {
    const svgs = await build(say);
    let sheetEl = $('#printSheet');
    if (!sheetEl) { sheetEl = document.createElement('div'); sheetEl.id = 'printSheet'; document.body.append(sheetEl); }
    sheetEl.innerHTML = svgs.join('');
    let st = $('#pageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.append(st); }
    st.textContent = '@page { size: A4 landscape; margin: 0; }';
    document.body.classList.add('print-sheet');
    const done = () => { document.body.classList.remove('print-sheet'); sheetEl.innerHTML = ''; st.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    say('현황도 13장을 만들었습니다. 인쇄 창에서 대상을 "PDF로 저장"으로 고르세요 (A4 가로, 여백 없음).');
    setTimeout(() => window.print(), 150);
    return svgs.length;
  }

  return { build, pdf };
})();
