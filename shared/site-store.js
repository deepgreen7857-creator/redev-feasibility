'use strict';
// 공통 구역 저장소 — /traffic, /env, /landscape, /arch가 같이 씀.
// 같은 구역이면 어느 도구에서 열어도 면적·지번·계획값이 똑같이 나오도록 구역 id 하나로 저장한다.
// 저장 위치: 브라우저 localStorage 'jbs.sites.v1' (서버로 보내지 않음, 개인정보는 넣지 않음)
// constraints[도구명] = 그 도구가 /arch(개략 배치)에 넘기는 배치 조건
(function (g) {
  const KEY = 'jbs.sites.v1';
  const URBAN_ZONES = 'jbs-urban-zones-v1', URBAN_PLAN = 'jbs-urban-plan';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { sites: {} }; } catch (e) { return { sites: {} }; } };
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } };
  const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);

  const JbsSite = {
    list() { return Object.values(read().sites).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))); },
    get(id) { return read().sites[id] || null; },
    save(site) {
      const s = read();
      if (!site.id) site.id = 's' + Date.now().toString(36);
      site.updated = now();
      s.sites[site.id] = site;
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
        site.profile.roads = it.zone.roads.edge.map(r => ({ name: (r.jibun || '') + ' 도로', w: r.w, level: '' }));
        site.profile.roadsFrom = 'urban 주변 도로(지목 도) 폭 추정값';
        site.profile.roadGeoms = it.zone.roads.edge.filter(r => r.geom).map(r => ({ name: (r.jibun || '') + ' 도로', w: r.w, geom: r.geom }));
      }
      site.plan = site.plan || {};
      if (P.zone && !site.profile.zoning) site.profile.zoning = P.zone;
      if (!site.plan.type) site.plan.type = 'redev';
      return this.save(site);
    },
  };
  g.JbsSite = JbsSite;
})(typeof window !== 'undefined' ? window : globalThis);
