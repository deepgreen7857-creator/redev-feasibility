'use strict';

// 구역계 만들기 공통 도구 — 사업성 검토(본 화면, js/map.js)와 정비계획 검토(/urban)가 함께 씀.
//  구역계 그리는 방법(지번 목록·필지 맞추기·필지 선택·도로 잇기 등)을 고칠 때는 이 파일에서 고칠 것 → 두 화면에 같이 반영됨.
//  여기에는 화면(DOM·S·App)을 건드리지 않는 계산만 둔다.

// 브이월드 API는 브라우저에서 직접 fetch하면 CORS로 막혀서 JSONP(callback)로 호출
function jsonp(url, params, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const cb = '__vw' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = data => { cleanup(); resolve(data); };
    s.src = url + '?' + new URLSearchParams({ ...params, callback: cb });
    s.onerror = () => { cleanup(); reject(new Error('load')); };
    document.head.append(s);
  });
}

const VWorld = {
  get enabled() { return typeof VWORLD_KEY === 'string' && VWORLD_KEY.trim() !== ''; },
  get key() { return VWORLD_KEY.trim(); },
  get domain() { return location.origin; },

  // 주소 검색. category: 'parcel'(지번) | 'road'(도로명), type: 'address' | 'place'
  async search(query, type = 'address', category = 'parcel') {
    const p = {
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326',
      size: 8, page: 1, query, type, format: 'json', errorformat: 'json', key: this.key, domain: this.domain,
    };
    if (type === 'address') p.category = category;
    const d = await jsonp('https://api.vworld.kr/req/search', p);
    const r = d && d.response;
    if (!r || r.status !== 'OK') {
      if (r && r.status === 'ERROR') throw new Error((r.error && r.error.text) || 'VWorld 오류');
      return [];
    }
    return (r.result.items || []).map(it => ({
      lat: +it.point.y, lon: +it.point.x, precise: true,
      label: it.title || (category === 'road' ? it.address.road : it.address.parcel) || it.address.road || it.address.parcel,
      sub: type === 'place' ? (it.address.road || it.address.parcel) : (category === 'road' ? it.address.parcel : it.address.road),
    }));
  },

  // 2D 데이터 API 한 페이지 조회. data: LP_PA_CBND_BUBUN(연속지적도), LT_C_UQ111(용도지역), LT_C_BLDGINFO(GIS건물통합정보)
  async dataPage(data, geomFilter, page = 1, size = 1000, geometry = true) {
    const d = await jsonp('https://api.vworld.kr/req/data', {
      service: 'data', request: 'GetFeature', data, key: this.key, domain: this.domain,
      geomFilter, geometry: String(geometry), attribute: 'true', crs: 'EPSG:4326',
      format: 'json', errorformat: 'json', size, page,
    }, 20000);
    const r = d && d.response;
    if (!r || r.status === 'NOT_FOUND') return { features: [], pages: 0 };
    if (r.status !== 'OK') throw new Error((r.error && r.error.text) || 'VWorld 오류');
    return { features: r.result.featureCollection.features || [], pages: +(r.page && r.page.total) || 1 };
  },

  // 범위 안의 모든 객체 (여러 페이지)
  async dataAll(data, geomFilter, maxPages = 10) {
    const first = await this.dataPage(data, geomFilter, 1);
    let all = first.features;
    for (let p = 2; p <= Math.min(first.pages, maxPages); p++) all = all.concat((await this.dataPage(data, geomFilter, p)).features);
    return all;
  },

  // 한 점을 포함하는 필지(연속지적도) 조회
  async parcelAt(lat, lon) {
    return (await this.dataPage('LP_PA_CBND_BUBUN', `POINT(${lon} ${lat})`, 1, 1)).features[0] || null;
  },

  // 한 점의 용도지역 이름 (예: 제2종일반주거지역)
  async zoningAt(lat, lon) {
    const fs = (await this.dataPage('LT_C_UQ111', `POINT(${lon} ${lat})`, 1, 10, false)).features;
    const f = fs.find(x => x.properties && x.properties.uname);
    return f ? f.properties.uname : '';
  },

  // 범위(bbox) 안에 걸친 용도지역 이름 목록
  async zoningsInBox(b) {
    const fs = (await this.dataPage('LT_C_UQ111', `BOX(${b.join(',')})`, 1, 100, false)).features;
    return [...new Set(fs.map(f => f.properties && f.properties.uname).filter(Boolean))];
  },

  // 토지특성(토지대장 면적·지목·공시지가·용도지역) 한 필지. 올해 자료가 없으면 전년도, 둘 다 없으면 null
  //  설정 모드(조서)와 검토 모드가 같이 씀
  async landChar(pnu, timeout = 15000) {
    const yr = new Date().getFullYear();
    const get = async y => {
      const d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu, key: this.key, domain: this.domain, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(y) }, timeout);
      return d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0];
    };
    const f = (await get(yr)) || (await get(yr - 1));
    if (!f) return null;
    return {
      ledgerArea: +f.lndpclAr, ledgerJimok: f.lndcgrCodeNm, jiga: +f.pblntfPclnd || 0, baseYear: f.stdrYear, landUse: f.ladUseSittnNm,
      zoning: [f.prposArea1Nm, f.prposArea2Nm].filter(x => x && x !== '지정되지않음').join(', '),
      roadSide: f.roadSideCodeNm || '',   // 도로접면 (정비계획 검토의 주택접도율 추정에 씀)
    };
  },
};


// 필지 여러 개를 하나로 합침. 연속지적도는 이웃 필지 경계 좌표가 미세하게 어긋나 있어
// 그냥 합치면 계산이 실패하는 경우가 있음 → 좌표 정리(1cm) → 살짝 부풀려 합치기 → 그래도 안 되면 따로 둠
function safeUnion2(a, b) {
  try { const u = turf.union(a, b); if (u) return u; } catch (e) { /* 아래에서 다시 시도 */ }
  try { const u = turf.union(turf.truncate(a, { precision: 7 }), turf.truncate(b, { precision: 7 })); if (u) return u; } catch (e) { /* 다음 */ }
  try {
    const grow = f => turf.buffer(turf.truncate(f, { precision: 7 }), 0.02, { units: 'meters' });
    const u = turf.union(grow(a), grow(b)); if (u) return u;
  } catch (e) { /* 다음 */ }
  // 마지막: 합치지 않고 두 도형을 한 묶음(MultiPolygon)으로
  const polys = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  return turf.multiPolygon([...polys(a), ...polys(b)]);
}
// 반씩 나눠 합치면 빠르고, 한 번의 실패가 전체로 번지지 않음
function safeUnion(fs) {
  fs = fs.filter(Boolean);
  if (!fs.length) return null;
  while (fs.length > 1) {
    const next = [];
    for (let i = 0; i < fs.length; i += 2) next.push(i + 1 < fs.length ? safeUnion2(fs[i], fs[i + 1]) : fs[i]);
    fs = next;
  }
  return fs[0];
}

// 구역계에 남은 10㎡ 미만 구멍(이웃 필지 경계·좌표 반올림 틈)을 메움 → 구역 안에 중간선이 생기지 않게
function fillSmallHoles(f) {
  if (!f || !f.geometry || !window.turf) return f;
  const g = f.geometry;
  const fill = p => [p[0], ...p.slice(1).filter(h => turf.area(turf.polygon([h])) >= 10)];
  if (g.type === 'Polygon') g.coordinates = fill(g.coordinates);
  else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fill);
  return f;
}

// 연속지적도 jibun 값은 "233-42대", "산12-3임" 형태
function splitJibun(s) {
  const m = String(s || '').trim().match(/^(산?\s*[\d-]+)\s*(\D*)$/);
  return m ? { no: m[1].replace(/\s/g, ''), jimok: m[2] || '' } : { no: String(s || ''), jimok: '' };
}

// ---------- 구역계 만들기 ----------
// 화면(지도·메시지·조서)과 상관없는 계산만 둠. 각 화면은 결과를 받아 지도에 그리고 조서를 채움.
//  say(t): 진행 문구를 화면에 쓰는 함수(없으면 무시)
const ZoneKit = {
  area1: f => Math.round(turf.area(f) * 10) / 10,
  f1: n => (Math.round(n * 10) / 10).toLocaleString('ko-KR'),
  items(list) { return [...new Set((list || []).map(s => String(s).trim()).filter(s => /\d/.test(s)))]; },
  // 동·리 이름이 들어 있으면 그대로, 숫자만 있으면 기준 동을 앞에 붙임
  query(it, base) { return /[가-힣]+(동|리|가)\s*(산\s*)?\d/.test(it) || /[가-힣]+(시|군|구)\s/.test(it) ? it : `${base} ${it}`.trim(); },

  // 지번 목록 → 필지 찾기. 반환 { found: Map(pnu → 필지), report: 대조표 행 }
  async findByJibuns(items, base, say = () => {}) {
    items = this.items(items);
    const report = [], found = new Map();
    const norm = s => String(s).replace(/번지/g, '').replace(/.*[가-힣](동|리|가)\s*/, '').replace(/\s/g, '');
    let done = 0;
    const work = async it => {
      try {
        const list = await VWorld.search(this.query(it, base), 'address', 'parcel');
        const f = list.length ? await VWorld.parcelAt(list[0].lat, list[0].lon) : null;
        const sp = f ? splitJibun(f.properties.jibun) : null;
        if (!f) report.push({ input: it, result: '실패', jibun: '', jimok: '', area: '', note: '검색 결과 없음 – 지번·기준 동(법정동) 확인' });
        else if (sp.no !== norm(it)) report.push({ input: it, result: '확인 필요', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: `다른 지번(${sp.no})으로 검색됨 – 분할·합병·표기 확인, 구역에 넣지 않음` });
        else {
          if (!found.has(f.properties.pnu)) report.push({ input: it, result: '포함', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: '' });
          else report.push({ input: it, result: '중복', jibun: sp.no, jimok: sp.jimok, area: '', note: '같은 필지가 이미 있음' });
          found.set(f.properties.pnu, f);
        }
      } catch (e) {
        report.push({ input: it, result: '실패', jibun: '', jimok: '', area: '', note: '조회 오류: ' + e.message });
      }
      done++;
      say(`필지를 찾는 중… ${done}/${items.length}`);
    };
    // 브이월드에 무리가 가지 않게 4개씩 동시에
    const queue = items.slice();
    await Promise.all([1, 2, 3, 4].map(async () => { while (queue.length) await work(queue.shift()); }));
    return { found, report, count: items.length };
  },

  // 고시문의 위치 지번들 + 목표 면적 → 지번들을 감싼 범위를 넓혀 가며 면적이 맞는 대략 범위를 추정
  //  반환 { rough, d, miss, pts } (rough를 snapPick → assemble로 필지에 맞춤)
  async roughFromAnchors(items, base, target, threshold = 0.5, say = () => {}) {
    items = this.items(items);
    const pts = [], miss = [];
    for (const it of items) {
      say(`위치 지번을 찾는 중… ${pts.length + miss.length + 1}/${items.length}`);
      try {
        const l = await VWorld.search(this.query(it, base), 'address', 'parcel');
        if (l.length) pts.push(turf.point([l[0].lon, l[0].lat])); else miss.push(it);
      } catch (e) { miss.push(it); }
    }
    if (!pts.length) return { rough: null, d: 0, miss, pts };
    const core = pts.length >= 3 ? turf.convex(turf.featureCollection(pts)) : turf.buffer(turf.featureCollection(pts).features[0], 30, { units: 'meters' });
    say('주변 필지를 불러오는 중…');
    const reach = Math.sqrt(target) * 0.8;
    const big = turf.buffer(core, reach, { units: 'meters' });
    const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${turf.bbox(big).join(',')})`, 20);
    const snapped = d => {
      const rough = d > 0 ? turf.buffer(core, d, { units: 'meters' }) : core;
      let sum = 0;
      for (const f of fs) {
        const A = turf.area(f);
        if (!A) continue;
        try { const x = turf.intersect(f, rough); if (x && turf.area(x) / A >= threshold) sum += A; } catch (e) { /* 건너뜀 */ }
      }
      return { rough, sum };
    };
    // 넓히는 거리를 이분 탐색해 목표 면적에 맞춤
    let lo = 0, hi = reach, best = null;
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      say(`목표 면적에 맞추는 중… (${k + 1}/9)`);
      await new Promise(r => setTimeout(r));
      const r = snapped(mid);
      if (!best || Math.abs(r.sum - target) < Math.abs(best.sum - target)) best = { ...r, d: mid };
      if (r.sum < target) lo = mid; else hi = mid;
    }
    return { rough: best.rough, d: best.d, miss, pts };
  },

  // 대략 그린 범위 → 필지 고르기. 필지 면적의 threshold(기본 50%) 이상이 범위 안이면 포함
  //  반환 { found, report, boundary(pnu → 범위 안 %) } — 실패 시 예외
  async snapPick(rough, threshold = 0.5, say = () => {}) {
    say('그린 범위의 필지를 불러오는 중…');
    const [x0, y0, x1, y1] = turf.bbox(rough);
    const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0},${y0},${x1},${y1})`, 20);
    const found = new Map(), report = [], boundary = new Map();
    let i = 0;
    for (const f of fs) {
      if (++i % 200 === 0) { say(`필지 포함 여부 계산 중… ${i}/${fs.length}`); await new Promise(r => setTimeout(r)); }
      const A = turf.area(f);
      if (!A) continue;
      let ratio;
      try { const x = turf.intersect(f, rough); ratio = x ? turf.area(x) / A : 0; }
      catch (e) { try { ratio = turf.booleanPointInPolygon(turf.pointOnFeature(f), rough) ? 1 : 0; } catch (e2) { ratio = 0; } }
      if (ratio < 0.02) continue;
      const sp = splitJibun(f.properties.jibun), pct = Math.round(ratio * 100);
      if (ratio >= 0.98) {
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '포함', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: '' });
      } else if (ratio >= threshold) {
        found.set(f.properties.pnu, f);
        boundary.set(f.properties.pnu, pct);
        report.push({ input: '', result: '경계 필지', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: `그린 범위 안 ${pct}% – 포함함` });
      } else {
        report.push({ input: '', result: '경계 제외', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: `그린 범위 안 ${pct}% – 제외함 (필요하면 필지 선택으로 추가)` });
      }
    }
    return { found, report, boundary };
  },

  // 고른 필지들 → 구역계 (떨어진 블록 사이 도로 잇기·갇힌 필지 포함·자투리 제거·작은 틈 메움)
  //  found·report는 고쳐서 돌려줌. 반환 { merged, partial: [{f, piece, isPart, part}], enclosed: Set(pnu) } (필지가 없으면 merged null)
  async assemble(found, report, opts = {}, say = () => {}) {
    let feats = [...found.values()];
    const partial = [], enclosed = new Set();
    if (!feats.length) return { merged: null, partial, enclosed };
    const polysOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
    let merged = safeUnion(feats);

    // 주변 필지 (도로·둘러싸인 필지를 찾기 위해)
    let around = [];
    if (opts.fillHoles || opts.bridge) {
      say('주변 도로·필지를 확인하는 중…');
      const [x0, y0, x1, y1] = turf.bbox(merged), e = 30 / 88000, n = 30 / 111000;
      around = (await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`)).filter(f => !found.has(f.properties.pnu));
    }
    const ptIn = (f, poly) => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), poly); } catch (e) { return false; } };

    // 1) 떨어진 덩어리 사이를 도로·구거·하천 필지로 잇기 (구역 외곽선 안쪽 부분만)
    if (opts.bridge && merged.geometry.type === 'MultiPolygon' && merged.geometry.coordinates.length > 1) {
      const hull = turf.convex(merged);
      const parts = merged.geometry.coordinates.map(c => turf.buffer(turf.polygon(c), 1.5, { units: 'meters' }));
      const roads = around.filter(f => !found.has(f.properties.pnu) && ['도', '구', '천'].includes(splitJibun(f.properties.jibun).jimok));
      roads.forEach(f => {
        const touching = parts.filter(p => { try { return turf.booleanIntersects(p, f); } catch (e) { return false; } }).length;
        if (touching < 2) return;
        let piece = null;
        try { piece = turf.intersect(f, hull); } catch (e) { piece = null; }
        if (!piece || turf.area(piece) < 1) return;
        const sp = splitJibun(f.properties.jibun);
        const whole = this.area1(f), part = this.area1(piece);
        const isPart = part < whole * 0.98;
        partial.push({ f, piece, isPart, part });
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '도로 잇기', jibun: sp.no, jimok: sp.jimok, area: part, note: `떨어진 블록 사이 도로${isPart ? ` – 일부 편입 (전체 ${this.f1(whole)}㎡)` : ''}` });
      });
      if (partial.length) merged = safeUnion([merged, ...partial.map(p => p.piece)]);
    }

    // 2) 구역 안에 둘러싸인 필지(구멍) 자동 포함 – 도로를 이은 뒤에 갇히는 필지도 잡도록 나중에 (10㎡ 미만 틈은 그냥 메움)
    if (opts.fillHoles) {
      const holes = polysOf(merged.geometry).flatMap(p => p.slice(1)).map(h => turf.polygon([h])).filter(h => turf.area(h) >= 10);
      const inHole = around.filter(f => !found.has(f.properties.pnu) && holes.some(h => ptIn(f, h)));
      inHole.forEach(f => {
        const sp = splitJibun(f.properties.jibun);
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '갇힌 필지', jibun: sp.no, jimok: sp.jimok, area: this.area1(f), note: '목록에 없지만 구역 안에 갇혀 자동 포함' });
        enclosed.add(f.properties.pnu);
      });
      if (inHole.length) merged = safeUnion([merged, ...inHole]);
    }

    // 본 구역과 떨어진 100㎡ 미만 자투리 조각은 뺌
    if (merged.geometry.type === 'MultiPolygon') {
      const ps = merged.geometry.coordinates.map(c => ({ c, a: turf.area(turf.polygon(c)) }));
      const keep = ps.filter(p => p.a >= 100), drop = ps.filter(p => p.a < 100);
      if (keep.length && drop.length) {
        drop.forEach(p => report.push({ input: '', result: '경계 제외', jibun: '', jimok: '', area: Math.round(p.a * 10) / 10, note: '본 구역과 떨어진 자투리 조각이라 뺌' }));
        merged = keep.length === 1 ? turf.polygon(keep[0].c) : turf.multiPolygon(keep.map(p => p.c));
      }
    }

    // 붙어 있는 필지 사이에 생기는 아주 작은 틈(10㎡ 미만 구멍)은 메움
    const g = merged.geometry;
    const fill = poly => [poly[0], ...poly.slice(1).filter(h => turf.area(turf.polygon([h])) >= 10)];
    if (g.type === 'Polygon') g.coordinates = fill(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fill);
    return { merged, partial, enclosed };
  },

  // 결과 문구 (assemble 뒤). intro: 앞부분
  summary(report, merged, intro) {
    const g = merged.geometry, parts = g.type === 'MultiPolygon' ? g.coordinates.length : 1;
    const cnt = r => report.filter(x => x.result === r).length;
    return `${intro}포함 <b>${cnt('포함')}필지</b>`
      + (cnt('경계 필지') ? `, 경계 필지 <b>${cnt('경계 필지')}필지</b>` : '') + (cnt('경계 제외') ? `, 경계에서 제외 ${cnt('경계 제외')}필지` : '') + (cnt('갇힌 필지') ? `, 갇힌 필지 <b>${cnt('갇힌 필지')}필지</b>` : '') + (cnt('도로 잇기') ? `, 블록 사이 도로 <b>${cnt('도로 잇기')}필지</b>` : '')
      + '로 구역계를 그렸습니다.'
      + (parts > 1 ? ` <b class="warn">구역이 아직 ${parts}덩어리로 떨어져 있습니다.</b>` : '')
      + (cnt('실패') + cnt('확인 필요') ? `<br><b class="warn">확인 필요 ${cnt('실패') + cnt('확인 필요')}건</b> – 필지 대조표를 보세요.` : '');
  },

  // 필지 하나를 구역계에 더하거나(add=true) 뺌 → 새 구역계(Feature) 또는 null
  toggle(zone, f, add) {
    if (add) return zone ? fillSmallHoles(safeUnion([zone, f])) : f;
    if (!zone) return null;
    try { return turf.difference(zone, f); }
    catch (e) { try { return turf.difference(turf.truncate(zone, { precision: 7 }), turf.truncate(f, { precision: 7 })); } catch (e2) { return zone; } }
  },
  // 필지가 구역계 안에 든 비율 (0~1)
  inRatio(zone, f) {
    if (!zone) return 0;
    try { const x = turf.intersect(f, zone); return x ? turf.area(x) / turf.area(f) : 0; } catch (e) { return 0; }
  },

  // 구역계가 지금 지적 경계와 얼마나 맞는지. 많이 어긋나면 { cut, dev, pct, cutList }, 잘 맞으면 null
  // (옛 고시 도면을 옮긴 선 등은 필지를 가로지르므로, 사이트 지적도가 틀린 것으로 오해하지 않게)
  async fit(zone) {
    if (!zone || !VWorld.enabled) return null;
    let fs;
    try { fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${turf.bbox(zone).join(',')})`, 20); }
    catch (e) { return null; }
    const zA = turf.area(zone);
    let dev = 0, cut = 0;
    const cutList = [];
    for (let i = 0; i < fs.length; i++) {
      if (i % 200 === 199) await new Promise(r => setTimeout(r));
      const f = fs[i], A = turf.area(f);
      if (!A) continue;
      let ratio;
      try { const x = turf.intersect(f, zone); ratio = x ? turf.area(x) / A : 0; } catch (e) { continue; }
      if (ratio <= 0.02 || ratio >= 0.98) continue;
      const sp = splitJibun(f.properties.jibun);
      // 도로·구거·하천은 경계선이 가운데를 지나는 일이 흔해서 따로 셈
      if (['도', '구', '천'].includes(sp.jimok)) continue;
      dev += Math.min(ratio, 1 - ratio) * A;
      if (ratio > 0.15 && ratio < 0.85) { cut++; if (cutList.length < 8) cutList.push(`${sp.no}(${Math.round(ratio * 100)}%)`); }
    }
    const pct = zA ? dev / zA * 100 : 0;
    if (pct < 2 && cut < 10) return null;
    return { cut, dev, pct, cutList };
  },

  // 대조표 정렬·색 구분
  reportRows(report) {
    const order = { '실패': 0, '확인 필요': 1, '경계 정리': 2, '경계 필지': 3, '경계 제외': 4, '갇힌 필지': 5, '도로 잇기': 6, '포함': 7, '중복': 8 };
    return report.slice().sort((a, b) => (order[a.result] ?? 9) - (order[b.result] ?? 9));
  },
  reportClass(r) { return r === '포함' ? 'good' : ['갇힌 필지', '도로 잇기', '경계 필지', '경계 정리'].includes(r) ? 'auto' : r === '중복' ? '' : 'warn'; },

  // 엑셀·CSV에서 지번 목록 읽기: '지번' 제목 열을 찾고, '소재지·주소' 열이 있으면 앞에 붙임. rows: 2차원 배열
  jibunsFromRows(rows) {
    const hi = rows.findIndex(r => r.some(c => /지번/.test(String(c))));
    let list;
    if (hi >= 0) {
      const jc = rows[hi].findIndex(c => /지번/.test(String(c)));
      const ac = rows[hi].findIndex(c => /소재지|주소/.test(String(c)));
      list = rows.slice(hi + 1).map(r => {
        const j = String(r[jc] ?? '').trim(), a = ac >= 0 ? String(r[ac] ?? '').trim() : '';
        return a && !/\d+(-\d+)?$/.test(a) ? `${a} ${j}` : j;
      });
    } else list = rows.flat().map(c => String(c ?? '').trim());
    return list.filter(s => /\d/.test(s));
  },
};
