'use strict';
// 공통 구역 저장소 — /traffic, /env, /landscape, /arch가 같이 씀.
// 같은 구역이면 어느 도구에서 열어도 면적·지번·계획값이 똑같이 나오도록 구역 id 하나로 저장한다.
// 저장 위치: 브라우저 localStorage 'jbs.sites.v1' (서버로 보내지 않음, 개인정보는 넣지 않음)
// constraints[도구명] = 그 도구가 /arch(개략 배치)에 넘기는 배치 조건
(function (g) {
  const KEY = 'jbs.sites.v1';
  const URBAN_ZONES = 'jbs-urban-zones-v1', URBAN_PLAN = 'jbs-urban-plan';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { sites: {} }; } catch (e) { return { sites: {} }; } };
  // 저장 공간(약 5MB)이 차서 실패하면 화면에 알림(shared/workfile.js가 받아 '작업 보관' 안내)
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { try { window.dispatchEvent(new CustomEvent('jbs-storage-full', { detail: { key: KEY } })); } catch (e2) { /* 무시 */ } return false; } };
  const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);

  const JbsSite = {
    list() { return Object.values(read().sites).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))); },
    get(id) { return read().sites[id] || null; },
    save(site) {
      const s = read();
      if (!site.id) site.id = 's' + Date.now().toString(36);
      site.updated = now();
      const keep = Object.assign({}, site); delete keep.context; // 주변 건물(브이월드, 다시 받을 수 있음)은 저장하지 않음
      s.sites[site.id] = keep;
      write(s);
      return site;
    },
    remove(id) { const s = read(); delete s.sites[id]; write(s); },
    // 도구별 배치 조건 저장 (예: setConstraints(id, 'traffic', {...}))
    setConstraints(id, tool, obj) {
      const site = this.get(id); if (!site) return null;
      site.constraints = site.constraints || {};
      site.constraints[tool] = Object.assign({}, obj, { at: now() });
      return this.save(site);
    },
    // /urban(정비계획 검토)에서 그린 안(A~E) 목록
    urbanZones() {
      try {
        const z = JSON.parse(localStorage.getItem(URBAN_ZONES) || '{}');
        return Object.keys(z.zones || {}).filter(k => z.zones[k] && z.zones[k].geojson).map(k => ({ key: k, zone: z.zones[k] }));
      } catch (e) { return []; }
    },
    // /urban의 안 하나를 공통 구역으로 가져옴 (이미 가져온 적 있으면 같은 id를 갱신)
    fromUrban(key) {
      const it = this.urbanZones().find(x => x.key === key); if (!it) return null;
      let P = {}; try { P = JSON.parse(localStorage.getItem(URBAN_PLAN) || '{}'); } catch (e) { P = {}; }
      const exist = this.list().find(s => s.source === 'urban:' + key);
      const site = exist || { name: `정비계획 검토 ${key}안`, plan: {}, profile: {} };
      site.source = 'urban:' + key;
      site.geojson = it.zone.geojson;
      site.profile = site.profile || {};
      if (it.zone.roads && it.zone.roads.edge && it.zone.roads.edge.length) {
        site.profile.roads = it.zone.roads.edge.map(r => ({ name: (r.jibun || '') + ' 도로', w: r.w, level: '', dec: r.dec || '' }));
        site.profile.roadsFrom = 'urban 주변 도로(지목 도) 폭 추정값';
        site.profile.roadGeoms = it.zone.roads.edge.filter(r => r.geom).map(r => ({ name: (r.jibun || '') + ' 도로', w: r.w, geom: r.geom }));
      }
      // /urban 정비기반시설 탭이 저장한 기반시설 도형(도로·공원·학교·종교용지, 획지) → /arch 건축 불가 영역
      try { const inf = JSON.parse(localStorage.getItem('jbs-urban-infra-v1') || '{}')[key]; if (inf) site.urbanInfra = inf; } catch (e) { /* 무시 */ }
      // /urban 4탭 단지 출입구(주·부·주차장) → /arch 차량 출입구 초기값
      site.urbanGates = ((it.zone.infra || {}).gates || []).map(g => ({ kind: g.kind, pt: g.pt }));
      site.plan = site.plan || {};
      if (P.zone) site.profile.zoning = P.zone;   // 계획 용도지역(/urban 4탭)을 늘 따름(2026-11-06 — 예전에 넘긴 3종이 남아 준주거 구역이 3종으로 나오던 것)
      // 사업 유형: 사업성 화면에서 넘어온 구역이면 그 화면의 사업 유형(재건축·재개발·가로주택)을 따름
      if (it.zone.from === 'project') { try { const pj = JSON.parse(localStorage.getItem('jbsc.project.v1') || 'null'), st = pj && (pj.state || pj), t = st && st.meta && st.meta.type; if (t) site.plan.type = t === 'reconstruction' ? 'recon' : t === 'garo' ? 'garo' : 'redev'; } catch (e) { /* 무시 */ } }
      if (!site.plan.type) site.plan.type = 'redev';
      return this.save(site);
    },
    // 사업성 검토 화면(첫 화면)에 그린 구역계를 바로 공통 구역으로 — /urban을 거치지 않고 /arch 배치·조감도로 (2026-11-07)
    projectZone() {
      try { const pj = JSON.parse(localStorage.getItem('jbsc.project.v1') || 'null'), st = pj && (pj.state || pj); return st && st.area && st.area.geojson && !(st.meta && /예시/.test(st.meta.memo || '')) ? st : null; } catch (e) { return null; }
    },
    fromProject() {
      const st = this.projectZone(); if (!st) return null;
      const g = st.area.geojson, gj = g.type === 'Feature' ? { type: 'Feature', properties: {}, geometry: g.geometry } : { type: 'Feature', properties: {}, geometry: g };
      const exist = this.list().find(x => x.source === 'project');
      const site = exist || { plan: {}, profile: {} };
      const m = st.meta || {};
      site.source = 'project'; site.geojson = gj;
      site.name = (m.name && m.name !== '새 정비사업') ? m.name : '사업성 검토 구역';
      site.profile = site.profile || {}; if (m.zoning) site.profile.zoning = m.zoning;
      site.plan = site.plan || {}; site.plan.type = m.type === 'reconstruction' ? 'recon' : m.type === 'garo' ? 'garo' : 'redev';
      // 1단계 계획 용적률·용도지역을 배치 조건으로(첫 화면 값과 같게)
      site.v = site.v || {}; const far = +((st.plan || {}).far) || 0; if (far > 0) site.v.far = String(far); if (m.zoning) site.v.zoning = m.zoning;
      return this.save(site);
    },
  };
  // /urban 4탭(개략 건축계획)의 계획값을 공통 구역에 넣음 → 교통성·환경성·높이경관 검토서가 그대로 씀
  // plan: { units, byType:{39,49,59,74,84,101,114 중 쓰는 것}(전용㎡ → 임대 포함 세대수), far, bcr, floors, towers, gfa, retailGFA,
  //         roads:[{ pnu, jibun, w(현황 폭), pw(계획 폭), role:'진입도로'|'두 번째 진입도로'|'주변 도로', dec(결정 등급), partial }] }
  JbsSite.applyUrbanPlan = function (key, plan) {
    const site = this.fromUrban(key); if (!site || !plan) return null;
    const v = site.v = site.v || {}, n = x => (x === undefined || x === null || isNaN(+x)) ? '' : String(Math.round(+x * 10) / 10);
    const bt = plan.byType || {};
    if (site.profile && site.profile.zoning) v.zoning = site.profile.zoning;   // 정비계획 값으로 넘길 때는 계획 용도지역으로 덮어씀(2026-11-06)
    v.units = n(plan.units); v.far = n(plan.far); v.bcr = n(plan.bcr); v.floors = n(plan.floors);
    v.aptGFA = n(plan.gfa); if (plan.retailGFA !== undefined) v.retailGFA = n(plan.retailGFA);
    if (Object.keys(bt).length) {
      // 평형 키 = 전용면적(㎡). 39·49·59·74·84·101·114 등 어떤 구성이든 계산
      let u60 = 0, a85 = 0, a85u = 0;
      Object.entries(bt).forEach(([t, c]) => { const ex = +t, k = +c || 0; if (!ex) return; if (ex <= 60) u60 += k; if (ex <= 85) a85 += k * ex; else a85u += k * ex; });
      v.units60below = n(u60); v.area85below = n(a85); v.area85above = n(a85u);
    }
    if (Array.isArray(plan.roads) && plan.roads.length) {
      const old = {}; (v.roads || []).forEach(r => { old[r.name] = r; });
      v.roads = plan.roads.map(r => {
        const name = (r.jibun || '') + ' 도로', o = old[name] || {};
        return { name, w: n(r.w), pw: r.pw && +r.pw > +r.w + 0.05 ? n(r.pw) : '', role: r.role || '', dec: r.dec || '', partial: !!r.partial, level: o.level || '', levelAuto: o.levelAuto };
      });
      v.roadsFrom = '/urban 정비계획(현황 폭은 필지 모양 추정, 계획 폭은 정비계획 값)';
    }
    v.planFrom = `/urban 개략 건축계획 ${key}안 (${new Date().toLocaleString('sv-SE').slice(0, 16)})`;
    site.urbanPlan = Object.assign({}, plan, { at: v.planFrom });
    if (!v.name || /^정비계획 검토/.test(v.name)) v.name = site.name;
    return this.save(site);
  };
  g.JbsSite = JbsSite;
})(typeof window !== 'undefined' ? window : globalThis);
