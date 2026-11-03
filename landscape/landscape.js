'use strict';
// /landscape 높이·경관계획 — 정비구역 지정 단계의 높이·스카이라인·통경축·조망 검토. 나중에 경관심의 수준으로 확장하는 자리
// /arch에서 확정한 배치(site.arch.chosen)를 읽어 스카이라인 입면, 통경축 개방률, 조망점 시점 그림을 자동으로 만듦
(function () {
  const BEAR = { '0': '남북 방향', '90': '동서 방향', '45': '북동–남서 방향', '135': '북서–남동 방향' };
  // 입면(스카이라인): 바라보는 방향 f(단위벡터)에서 본 동 실루엣. 먼 동부터 그려 가까운 동이 앞에 오게
  function elevation(blds, f, title, aroundH, maxLabel) {
    const r = [f[1], -f[0]], hp = p => p[0] * r[0] + p[1] * r[1], dp = p => p[0] * f[0] + p[1] * f[1];
    const items = blds.map(b => { const h = b.poly.map(hp), d = b.poly.map(dp); return { x0: Math.min(...h), x1: Math.max(...h), d: (Math.min(...d) + Math.max(...d)) / 2, H: b.H, id: b.id, f: b.floors }; });
    if (!items.length) return '';
    const x0 = Math.min(...items.map(i => i.x0)) - 20, x1 = Math.max(...items.map(i => i.x1)) + 20, Hm = Math.max(...items.map(i => i.H), aroundH || 0) * 1.18;
    const W = 900, k = W / (x1 - x0), Hpx = Math.max(160, Hm * k), pad = 28, tot = Hpx + pad * 2 + 10;
    const dmin = Math.min(...items.map(i => i.d)), dmax = Math.max(...items.map(i => i.d)) || 1;
    const X = x => ((x - x0) * k).toFixed(1), Y = h => (pad + Hpx - h * k).toFixed(1);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${tot}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif" style="width:100%;height:auto;background:#fbfbf8"><text x="8" y="16" font-size="12" font-weight="700" fill="#1d2a33">${title}</text>`;
    // 높이 눈금
    const step = [10, 20, 25, 50].find(v => Hm / v <= 6) || 50;
    for (let hh = step; hh < Hm; hh += step) s += `<line x1="0" y1="${Y(hh)}" x2="${W}" y2="${Y(hh)}" stroke="#d5dbd6" stroke-width=".6"/><text x="4" y="${(+Y(hh) - 3).toFixed(1)}" font-size="9" fill="#8a949b">${hh}m</text>`;
    items.sort((a, b) => b.d - a.d);
    items.forEach(i => {
      const t = dmax > dmin ? (i.d - dmin) / (dmax - dmin) : 0, c = Math.round(212 + t * 30);
      s += `<rect x="${X(i.x0)}" y="${Y(i.H)}" width="${((i.x1 - i.x0) * k).toFixed(1)}" height="${(i.H * k).toFixed(1)}" fill="rgb(${c - 20},${c - 10},${c})" stroke="#33424b" stroke-width=".8"/>`;
    });
    // 이름표: 더 가까운 동에 가려지지 않는 것만
    items.forEach((i, n) => {
      if ((i.x1 - i.x0) * k < 34) return;
      const lx = (i.x0 + i.x1) / 2, lh = i.H - 13 / k;
      const hidden = items.slice(n + 1).some(o => o.x0 <= lx && lx <= o.x1 && o.H >= lh);
      if (!hidden) s += `<text x="${X(lx)}" y="${(+Y(i.H) + 13).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#1d2a33">${i.id} · ${i.f}F</text>`;
    });
    s += `<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="#1d2a33" stroke-width="1.2"/>`;
    if (aroundH) s += `<line x1="0" y1="${Y(aroundH)}" x2="${W}" y2="${Y(aroundH)}" stroke="#3f8f5a" stroke-width="1.2" stroke-dasharray="6 4"/><text x="${W - 6}" y="${(+Y(aroundH) - 4).toFixed(1)}" font-size="10" text-anchor="end" fill="#3f8f5a">주변 평균 높이 약 ${aroundH.toFixed(0)}m</text>`;
    s += `<text x="${W - 6}" y="16" font-size="10" text-anchor="end" fill="#6a767d">${maxLabel}</text>`;
    return s + '</svg>';
  }
  // 통경축 평면 도식: 조망축 방향 띠 중 동에 가리지 않는 부분을 녹색으로
  function corridorPlan(blds, pts, bearing) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 10, y1 = Math.max(...ys) + 10;
    const W = 520, k = W / (x1 - x0), H = (y1 - y0) * k, P = p => `${((p[0] - x0) * k).toFixed(1)},${((y1 - p[1]) * k).toFixed(1)}`;
    const b = bearing * Math.PI / 180, ax = [Math.sin(b), Math.cos(b)], perp = [Math.cos(b), -Math.sin(b)];
    const pr = p => p[0] * perp[0] + p[1] * perp[1], sv = pts.map(pr), s0 = Math.min(...sv), s1 = Math.max(...sv);
    const iv = blds.map(bd => { const v = bd.poly.map(pr); return [Math.min(...v), Math.max(...v)]; }).sort((a, c) => a[0] - c[0]);
    const free = []; let at = s0; iv.forEach(x => { if (x[0] > at) free.push([at, x[0]]); at = Math.max(at, x[1]); }); if (s1 > at) free.push([at, s1]);
    const L = Math.hypot(x1 - x0, y1 - y0), c = [(x0 + x1) / 2, (y0 + y1) / 2], cp = pr(c);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H.toFixed(0)}" style="width:100%;max-width:520px;height:auto;background:#fbfbf8"><defs><clipPath id="cl"><polygon points="${pts.map(P).join(' ')}"/></clipPath></defs>`;
    s += `<polygon points="${pts.map(P).join(' ')}" fill="#eef2e9"/>`;
    s += `<g clip-path="url(#cl)">` + free.map(([a, e]) => { const m1 = a - cp, m2 = e - cp; const q = [[m1, -L], [m2, -L], [m2, L], [m1, L]].map(([u, w]) => [c[0] + perp[0] * u + ax[0] * w, c[1] + perp[1] * u + ax[1] * w]); return `<polygon points="${q.map(P).join(' ')}" fill="#7fbf8f" opacity=".45"/>`; }).join('') + '</g>';
    blds.forEach(bd => { (bd.parts || [bd.poly]).forEach(q => { s += `<polygon points="${q.map(P).join(' ')}" fill="#e8e4d8" stroke="#1d2a33" stroke-width=".8"/>`; }); });
    s += `<polygon points="${pts.map(P).join(' ')}" fill="none" stroke="#c8322b" stroke-width="1.4" stroke-dasharray="8 3 2 3"/>`;
    return s + '</svg>';
  }
  // 3D 그림(조감 + 조망점 시점) — 화면 밖 캔버스에 그려 PNG로
  function shots(pts, blds, viewPts, toLocal) {
    if (typeof THREE === 'undefined' || typeof Mass3D === 'undefined') return [];
    const div = document.createElement('div'); div.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:520px'; document.body.appendChild(div);
    const out = [];
    try {
      const v = Mass3D.create(div, { site: pts, buildings: blds.flatMap(b => (b.parts || [b.poly]).map(q => ({ poly: q, h: b.H, color: 0xf2efe6 }))), sunHour: 12, lat: 37.46 });
      v.bird(-0.75, 0.5); out.push({ name: '조감(남서쪽)', src: v.png() });
      v.bird(2.3, 0.45); out.push({ name: '조감(북동쪽)', src: v.png() });
      (viewPts || []).slice(0, 4).forEach(p => { v.eyeAt(toLocal([p.lng, p.lat])); out.push({ name: `${p.name} 시점(눈높이 1.6m)`, src: v.png() }); });
      v.dispose();
    } catch (e) { console.warn('3D 그림 생략:', e.message); }
    div.remove(); return out;
  }

  ReviewUI.start({
    tool: 'landscape', title: '높이·경관계획 검토서', markers: true,
    criteriaUrl: '../shared/criteria/landscape.json', templatesUrl: '../shared/templates/landscape_ko.json',
    roads: false,
    groups: [
      { title: '경관 관리', fields: [
        { k: 'keyArea', label: '중점경관관리구역 해당', select: { '': '모름', '예': '예', '아니오': '아니오' } },
        { k: 'district', label: '경관지구 해당', select: { '': '모름', '예': '예', '아니오': '아니오' } },
        { k: 'aroundFloors', label: '주변 평균 층수', num: true },
        { k: 'gfa', label: '건축 연면적 합계 ㎡', num: true },
        { k: 'sale', label: '분양 목적 건축물', select: { '': '예', '아니오': '아니오' } },
        { k: 'aroundMax', label: '주변 최고층 건물(층)', num: true },
      ] },
      { title: '조망·통경축', fields: [
        { k: 'axisBearing', label: '통경축 방향', select: { '0': '남북 방향', '90': '동서 방향', '45': '북동–남서 방향', '135': '북서–남동 방향' } },
        { k: 'axis', label: '보호할 조망 대상(산·수변 등)', ph: '예: 수봉산' },
        { k: 'views', label: '조망점 이름(지도 마커 도구로도 찍기)', ph: '예: 숭의역 광장, 수봉공원 전망대' },
        { k: 'street', label: '주요 가로', ph: '예: 숭의로 변 상가 가로' },
      ], note: '지도 왼쪽 위 마커 도구로 조망점을 찍으면 그 자리 눈높이에서 본 3D 그림이 검토서에 들어갑니다(최대 4곳).' },
    ],
    async build({ p, C, T, site, h }) {
      const { esc, fmt, T: t, badge, TYPES } = h;
      const cons = site.constraints || {};
      const f = s => s.replace(/\{name\}/g, site.name || '○○');
      const fh = (site.arch && site.arch.params && +site.arch.params.fh) || 2.9;
      const aroundH = h.num(p.aroundFloors) ? +p.aroundFloors * fh + 1.5 : null;
      // /arch 확정안을 구역 좌표(미터)로
      let A = null, pts = null, blds = [], toLocal = null;
      if (site.arch && site.arch.chosen && site.geojson) {
        const g = site.geojson.geometry || site.geojson;
        const ring = ArchGeom.openRing(g.type === 'Polygon' ? g.coordinates[0] : g.coordinates.map(c => c[0]).sort((a, b) => b.length - a.length)[0]);
        const pr = ArchGeom.projector(ring); toLocal = pr.to; pts = ArchGeom.ccw(ring.map(pr.to));
        A = site.arch.chosen; blds = A.buildings.map(b => ({ id: b.id, floors: b.floors, H: b.H, form: b.form, poly: b.poly.map(pr.to), parts: b.parts ? b.parts.map(q => q.map(pr.to)) : null }));
      }
      if (A) p = Object.assign({}, p, { floors: A.maxFloors });
      const r = LandscapeCalc.run(C, T, p, Object.assign({}, cons, { arch: A ? cons.arch || {} : null }));
      const bearing = +(p.axisBearing || 0);
      const op = A ? LandscapeCalc.openness(blds, pts, bearing) : null;
      const tall = A ? LandscapeCalc.edgeTall(blds, pts, h.num(p.aroundFloors), (C._내부검토기준 || {}).주변대비_층수배율_주의 || 2, 30, ArchGeom.segDist) : [];
      if (A && op) {
        if (op.open !== null && op.open < 30) r.list.splice(r.list.length - 1, 0, `${BEAR[bearing]} 통경축 개방률이 ${op.open}%로 낮으므로, 동 사이 간격을 넓히거나 일부 동을 탑상형으로 바꿔 조망축을 확보하는 방안을 검토한다.`);
        if (tall.length) r.list.splice(r.list.length - 1, 0, `구역 경계 30m 안의 ${tall.join('·')}동은 주변 평균 층수의 2배 이상이므로 경계부 층수를 낮추는 방안(층수 점감)을 검토한다.`);
        r.constraints.통경축_개방률_퍼센트 = op.open; r.constraints.경계부_층수_점감_대상동 = tall;
      }
      const imgs = A ? shots(pts, blds, p.viewPts, toLocal) : [];
      const maxLabel = A ? `최고 ${A.maxFloors}층 · 약 ${fmt(A.maxHeight, 1)}m` : '';
      const html = `
      <h2>1. 검토 개요</h2>
      <p>${esc(f(T.purpose))} 정비구역 지정 단계에서는 도시계획과 함께 높이·스카이라인·통경축·주요 조망을 보는 수준이며, 입면·색채·야간경관 등 건축 경관심의 사항은 사업시행계획 단계에서 다룬다.</p>
      <table><tr><th style="width:120px">법적 근거</th><td>「도시 및 주거환경정비법」 제9조(정비계획 — 건축물의 높이 등), 「경관법」 제27조·제28조, 인천광역시 경관 조례 및 경관계획</td></tr>
      <tr><th>배치 자료</th><td>${A ? `/arch 확정안 '${esc(A.label)}' (${A.buildings.length}개동, ${fmt(A.units)}세대, 확정 ${esc(site.arch.at || '')})` : '아직 없음 — /arch(개략 건축계획)에서 배치안을 확정하면 5~8장이 자동으로 채워집니다.'}</td></tr></table>

      <h2>2. 대상지 현황</h2>
      <table><tr><th style="width:120px">사업 유형</th><td>${t(TYPES[p.type])}</td><th style="width:110px">위치</th><td>${t(p.loc)}</td></tr>
      <tr><th>구역면적</th><td>${fmt(p.siteArea, 1)}㎡</td><th>용도지역</th><td>${t(p.zoning)}</td></tr>
      <tr><th>주변 평균 / 최고</th><td>${fmt(p.aroundFloors, 1)}층 / ${fmt(p.aroundMax)}층</td><th>주요 가로</th><td>${t(p.street)}</td></tr></table>

      <h2>3. 경관 관리구역 해당 여부</h2>
      <p>중점경관관리구역 ${t(p.keyArea || '')}, 경관지구 ${t(p.district || '')}</p>
      <p class="note">2040 인천광역시 경관계획(2023. 6. 26. 고시) 중점경관관리구역: ${esc((r.rev.keyList || []).join('·'))}. 필지별 해당 여부는 토지이음 토지이용계획의 지역·지구로 판정.</p>

      <h2>4. 경관심의 대상 여부</h2>
      <table><tr><th style="width:150px">개발사업(정비구역)</th><td>${badge(r.rev.dev)} (기준 ${fmt(r.rev.devLim)}㎡ 이상, 계획 ${fmt(p.siteArea, 1)}㎡)<br><span class="note">${esc(r.rev.devBasis)}. 심의 시기: ${esc(r.rev.when)}. ${esc(r.rev.devNote || '')}</span></td></tr>
      <tr><th>건축물</th><td>${badge(r.rev.bld)}${r.rev.bldWho ? ' — ' + esc(r.rev.bldWho) : ''}<br><span class="note">${esc(r.rev.bldBasis)}. ${esc(r.rev.bldNote || '')}</span></td></tr></table>

      <h2>5. 높이 계획</h2>
      ${A ? `<table><tr><th style="width:150px">최고 층수·높이</th><td>${A.maxFloors}층 · 약 ${fmt(A.maxHeight, 1)}m</td></tr>
        <tr><th>주변 대비</th><td>주변 평균 ${fmt(p.aroundFloors, 1)}층의 ${r.h.ratio === null ? '○○' : r.h.ratio}배 ${badge(r.h.result)} <span class="note">(주변 평균 대비 ${r.h.lim}배 이상이면 '변화 큼' — 내부 검토 기준)</span></td></tr>
        <tr><th>층수 배분</th><td>북쪽 줄을 높게, 남쪽 줄을 낮게(남저북고) — 동별 층수: ${blds.map(b => `${b.id}동 ${b.floors}F`).join(', ')}</td></tr>
        <tr><th>경계부 층수 점감</th><td>${tall.length ? `${badge('검토 필요')} 경계 30m 안 주변 평균 2배 이상: ${tall.join('·')}동` : (h.num(p.aroundFloors) ? badge('해당 없음') : '주변 평균 층수를 넣으면 판정')}</td></tr></table>`
        : `<p>계획 최고 ${fmt(p.floors)}층 · 주변 평균 대비 ${r.h.ratio === null ? '○○' : r.h.ratio}배 ${badge(r.h.result)}</p>`}

      <h2>6. 스카이라인</h2>
      ${A ? elevation(blds, [0, 1], '남측 입면(남쪽에서 북쪽을 바라봄)', aroundH, maxLabel) + '<div style="height:8px"></div>' + elevation(blds, [-1, 0], '동측 입면(동쪽에서 서쪽을 바라봄)', aroundH, maxLabel) : '<p><b>개략 배치 확정 후 작성</b></p>'}

      <h2>7. 통경축</h2>
      ${A ? `<p>${BEAR[bearing]} 통경축 개방률 <b>${op.open}%</b> (구역 폭 ${fmt(op.width)}m 중 동에 가리지 않는 폭의 비율), ${op.minGap}m 이상 열린 틈: ${op.gaps.length ? op.gaps.map(x => x + 'm').join(', ') : '없음'}${p.axis ? ` — 보호할 조망 대상: ${esc(p.axis)}` : ''}</p>${corridorPlan(blds, pts, bearing)}<p class="note">녹색 띠: 조망축 방향으로 막힘 없이 트인 부분</p>` : '<p><b>개략 배치 확정 후 작성</b></p>'}

      <h2>8. 조망</h2>
      ${imgs.length ? imgs.map(i => `<figure style="margin:0 0 10px"><img src="${i.src}" alt="${esc(i.name)}" style="width:100%;max-width:860px;border:1px solid var(--line);border-radius:4px"><figcaption class="note">${esc(i.name)} — 평지·주변 건물 없음 가정, 동지 정오 그림자</figcaption></figure>`).join('') : `<p>조망점 후보: ${t(p.views)}${A ? ' — 지도에 조망점을 찍으면 시점 그림이 들어갑니다.' : ' — 개략 배치 확정 후 시뮬레이션 작성'}</p>`}

      <h2>9. 다른 검토에서 넘어온 조건</h2>
      ${['traffic', 'env', 'arch'].filter(k => cons[k]).length ? `<ul>${cons.traffic ? `<li>교통: 진입 가능 도로 ${esc((cons.traffic.진입_가능_도로 || []).join(', ') || '○○')}</li>` : ''}${cons.env ? `<li>환경: 소음 검토 도로 ${esc((cons.env.소음_검토_도로 || []).join(', ') || '없음')}, 북측 일조 ${esc(cons.env.북측_일조_높이제한 || '해당 없음')}, 국가유산 ${esc(cons.env.국가유산_검토 || '해당 없음')}</li>` : ''}${cons.arch ? `<li>개략 배치: ${esc(cons.arch.배치안)}, 동지 일조 미달 면적 ${esc(cons.arch.일조_미달_면적_제곱미터)}${typeof cons.arch.일조_미달_면적_제곱미터 === 'number' ? '㎡' : ''}</li>` : ''}</ul>` : '<p>교통성·환경성 검토서와 개략 배치를 먼저 만들면 그 조건이 여기에 이어집니다.</p>'}

      <h2>10. 높이·경관 관리 방향 및 종합 의견</h2>
      <ol>${r.list.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <p>보완 필요사항:</p><ul>${r.need.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
      return { html, constraints: r.constraints };
    },
  });
})();
