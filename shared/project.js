/* 공통 사업 기록(2026-11-08, 사용자 요구 '구역명 적어놔도 이어지지 않는다')
 *
 * 사업명은 이 파일의 'jbs.project.v1' 한 곳이 원본이다. 화면마다 따로 들고 있던 이름
 *   - 사업성 화면  jbsc.project.v1 → meta.name
 *   - 정비계획     jbs-urban-zones-v1 → title
 *   - 공통 구역    jbs.sites.v1 → sites[지금 구역].name / .v.name (교통·환경·경관·건축·판넬·결정조서·절차서류·지형도면이 읽음)
 * 은 '사본'이다. 예전에는 처음 넘어갈 때 한 번만 복사돼서, 한 화면에서 이름을 고쳐도 다른 화면엔 옛 이름이 남았다.
 *
 * 규칙
 *  1) 이름을 고치면(어느 화면이든) JbsProject.setName → 원본만 고친다.
 *  2) 페이지를 열 때(<head>, 화면 코드보다 먼저) 원본 이름을 사본 세 곳에 맞춰 넣는다(다를 때만).
 *  3) 열려 있는 다른 창은 원본이 바뀐 걸 알아채고 자기 화면 이름을 바로 고친다(사업성 S.meta, 정비계획 Z, 입력칸).
 *     → 다른 창이 사본을 직접 덮어쓰지 않으므로 사업성 화면의 '다른 창에서 바뀜' 경고가 쓸데없이 뜨지 않는다.
 *  4) 기본값 이름('새 정비사업', '(예시)', '정비계획 검토 A안' 등)은 사업명으로 치지 않는다.
 *  5) [새 사업]은 지금 작업을 자동 백업한 뒤 모든 화면을 비우고 새 이름으로 시작한다(위치가 바뀌면 설정 초기화 — 사용자 결정).
 *
 * 넣는 곳: 사업성·정비계획 쪽 모든 페이지 <head>에서 gate.js 바로 다음. 화면 시험: tools/ui-test/project-ui.js
 */
(function (g) {
  'use strict';
  const KEY = 'jbs.project.v1', MIG = 'jbs.project.migrated';
  const MAIN = 'jbsc.project.v1', URBAN = 'jbs-urban-zones-v1', SITES = 'jbs.sites.v1', CUR = 'jbs.sites.current';
  const DEFAULT_RE = /^(새 정비사업|사업성 검토 구역|이름 없는 구역|정비계획 검토\s*[A-E]?안?|정비사업)$|\(예시\)\s*$/;

  const clean = n => String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
  const isReal = n => { const t = clean(n); return !!t && !DEFAULT_RE.test(t); };
  const jget = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);

  // 사본 세 곳 읽기
  function copies() {
    const m = jget(MAIN), z = jget(URBAN), s = jget(SITES), cur = localStorage.getItem(CUR);
    const site = s && s.sites && cur && s.sites[cur];
    return {
      main: m && m.meta ? clean(m.meta.name) : null,
      urban: z ? clean(z.title) : null,
      site: site ? clean(site.name || (site.v && site.v.name)) : null,
    };
  }

  function read() {
    const p = jget(KEY);
    if (p && typeof p === 'object') return p;
    // 처음 한 번: 사본에서 사업명을 골라 원본을 만든다(사업성 → 정비계획 → 공통 구역 순). 덮어쓰기 전 이름은 따로 남김
    const c = copies(), name = [c.main, c.urban, c.site].find(isReal) || '';
    const rec = { name, updated: now(), from: 'migrate' };
    jset(KEY, rec);
    jset(MIG, { at: now(), before: c });
    return rec;
  }

  // 원본 이름을 사본에 맞춰 넣기(다를 때만). 사업성 화면이 예시를 열어 둔 경우는 건드리지 않음
  function mirror(name) {
    name = clean(name); if (!isReal(name)) return;
    const m = jget(MAIN);
    if (m && m.meta && clean(m.meta.name) !== name && !/\(예시\)\s*$/.test(m.meta.name || '')) { m.meta.name = name; jset(MAIN, m); }
    const z = jget(URBAN);
    if (z && clean(z.title) !== name) { z.title = name; jset(URBAN, z); }
    const s = jget(SITES), cur = localStorage.getItem(CUR);
    if (s && s.sites && cur && s.sites[cur]) {
      const site = s.sites[cur]; let ch = false;
      if (clean(site.name) !== name) { site.name = name; ch = true; }
      if (site.v && 'name' in site.v && clean(site.v.name) !== name) { site.v.name = name; ch = true; }
      if (ch) jset(SITES, s);
    }
  }

  const listeners = [];
  function emit(name, from) {
    listeners.forEach(f => { try { f(name, from); } catch (e) { console.warn(e); } });
    paint();
  }

  const JbsProject = {
    KEY,
    get() { return read(); },
    name() { return clean(read().name); },
    isReal,
    // 사용자가 이름을 고침 → 원본만 고침(이 창의 사본은 그 화면 코드가 스스로 저장)
    setName(n, from) {
      n = clean(n); if (!isReal(n)) return false;
      const p = read(); if (clean(p.name) === n) return false;
      p.name = n; p.updated = now(); p.from = from || 'edit';
      jset(KEY, p); emit(n, p.from); return true;
    },
    // 화면 코드가 저장할 때 알려 줌: 원본이 비었거나 다르면 원본을 고침(프로그램이 이름을 넣은 경우도 놓치지 않게)
    offer(n, from) { return this.setName(n, from || 'save'); },
    clear() { jset(KEY, { name: '', updated: now(), from: 'clear' }); emit('', 'clear'); },
    onChange(f) { if (typeof f === 'function') listeners.push(f); },
    mirror() { mirror(read().name); },
    copies,
    // 모든 화면 비우고 새 사업 시작(자동 백업 먼저)
    async startNew(n) {
      n = clean(n);
      if (g.JbsWork && g.JbsWork.backup) { try { await g.JbsWork.backup('새 사업 전 자동 백업'); } catch (e) { /* 무시 */ } }
      if (g.JbsWork && g.JbsWork.clearWork) g.JbsWork.clearWork();
      else ['jbsc.project.v1', 'jbs-urban-zones-v1', 'jbs-urban-plan', 'jbs-urban-infra-v1', 'jbs-urban-out', 'jbs.sites.v1', 'jbs.sites.current', 'jbs-decision-v1', 'jbs-proc-v1', 'jbs-topo-v1', 'jbs-panel-v1'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } });
      jset(KEY, { name: isReal(n) ? n : '', updated: now(), from: 'new' });
      location.href = '/';
    },
  };

  // ---------- 2) 페이지를 열 때 사본 맞추기(화면 코드보다 먼저 실행됨) ----------
  try { mirror(read().name); } catch (e) { console.warn('사업명 맞추기 실패', e); }

  // ---------- 3) 다른 창에서 이름이 바뀜 → 이 창 화면을 바로 고침 ----------
  function applyHere(name) {
    if (!isReal(name)) return;
    // 사업성 화면(js/state.js의 S·saveState)
    try { if (typeof S !== 'undefined' && S && S.meta && typeof saveState === 'function' && clean(S.meta.name) !== name && !/\(예시\)\s*$/.test(S.meta.name || '')) { S.meta.name = name; saveState(); } } catch (e) { /* 이 화면 아님 */ }
    // 정비계획(urban/js/의 Z·saveZ·syncTitle)
    try { if (typeof Z !== 'undefined' && Z && 'title' in Z && typeof saveZ === 'function' && clean(Z.title) !== name) { Z.title = name; saveZ(); if (typeof syncTitle === 'function') syncTitle(); } } catch (e) { /* 이 화면 아님 */ }
    // 입력칸(사업성 머리·구역명, 정비계획 구역명, 검토서 도구 구역 이름) — 다음 저장 때 화면 코드가 이 값을 읽음
    document.querySelectorAll('[data-bind="meta.name"], #zoneTitle, #form [data-k="name"]').forEach(el => { if (document.activeElement !== el && el.value !== name) el.value = name; });
  }
  g.addEventListener && g.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    let p = null; try { p = JSON.parse(e.newValue || 'null'); } catch (x) { /* 무시 */ }
    const n = p ? clean(p.name) : '';
    applyHere(n); emit(n, 'other-tab');
  });

  // ---------- 1) 사용자가 이 창에서 이름 칸을 고침 → 원본으로 ----------
  if (typeof document !== 'undefined') document.addEventListener('change', e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-bind="meta.name"], #zoneTitle, #form [data-k="name"]')) JbsProject.setName(t.value, 'edit');
  }, true);

  // ---------- 머리줄 '현재 사업' 띠(사업성·정비계획 쪽 화면, 길잡이 줄 안) ----------
  const css = `#jbsProj{flex:none;align-self:center;display:flex;align-items:center;gap:6px;margin-left:auto;margin-right:8px;color:#cfd6dd;font-size:13px;white-space:nowrap}
#jbsProj b{color:#fff;max-width:260px;overflow:hidden;text-overflow:ellipsis}
#jbsProj b.none{color:#f8b26a;font-weight:400}
#jbsProj button{background:#2b3743;color:#e9ecef;border:1px solid #3a4652;border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer}
#jbsProj button:hover{background:#3a4652}
#siteNav #jbsProj ~ .man{margin-left:0}
@media print{#jbsProj{display:none!important}}`;
  function paint() {
    const box = document.getElementById('jbsProj'); if (!box) return;
    const n = clean(read().name);
    const b = box.querySelector('b'); b.textContent = n || '사업명 없음'; b.className = n ? '' : 'none'; b.title = n;
  }
  function mount() {
    const P = location.pathname.replace(/index\.html$/, '');
    if (!(P === '/' || /^\/(urban|traffic|env|landscape|arch|panel|decision|topo|proc)\//.test(P))) return;
    const nav = document.getElementById('siteNav'); if (!nav) { setTimeout(mount, 200); return; }
    if (document.getElementById('jbsProj')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('span'); box.id = 'jbsProj';
    box.innerHTML = '현재 사업 <b></b><button type="button" data-p="ren" title="모든 화면의 사업명을 한 번에 고칩니다">이름 고치기</button><button type="button" data-p="new" title="지금 작업을 자동 백업하고 모든 화면을 비운 뒤 새 사업으로 시작합니다">새 사업</button>';
    const man = nav.querySelector('.man'); nav.insertBefore(box, man || null);
    box.addEventListener('click', async e => {
      const w = e.target && e.target.dataset && e.target.dataset.p; if (!w) return;
      if (w === 'ren') {
        const n = prompt('사업명(모든 화면에 같이 바뀝니다)\n예: 학익장미아파트 주택재건축정비사업', JbsProject.name());
        if (n == null) return;
        if (!isReal(n)) { alert('사업명을 넣어 주세요.'); return; }
        JbsProject.setName(n, 'edit'); applyHere(clean(n)); // 다른 화면 사본은 그 페이지를 열 때 맞춰짐(열린 창은 스스로 고침)
      } else if (w === 'new') {
        const n = prompt('새 사업 이름을 넣으세요.\n지금 작업(구역계·기반시설·배치·검토서·사업성)은 자동 백업한 뒤 모든 화면을 비웁니다.\n사업성 가정값은 그대로 둡니다.', '');
        if (n == null) return;
        await JbsProject.startNew(n);
      }
    });
    paint();
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }

  // ---------- 구역 원본(2026-11-10, 사용자 결정 '구역 저장소 하나로') ----------
  // 사업명처럼 '지금 사업의 구역계'도 원본 하나(jbs.project.v1 .zone {g: geometry, h, at, from})를 둔다.
  //  - 어느 화면이든 구역을 '바꾸면' offerZone → 원본이 됨(사업성 saveState, /urban setZoneGeom·importProject, 공통 구역 JbsSite.save 지금 구역)
  //    창마다 마지막으로 본 구역(seen)과 같으면 알리지 않음 → 열려 있던 옛 창이 다른 저장 때 옛 구역을 다시 원본으로 올리지 않음
  //  - 화면을 열 때 자기 구역이 원본과 다르면 원본으로 맞춤: 사업성 = 지도 구역 바꾸고 필지·조서 다시 불러옴, /urban = 원본과 같은 안이 있으면 그 안을 고르고 없으면 지금 안을 바꿈,
  //    공통 구역(교통·환경·경관·건축·판넬·결정조서·절차·지형도면) = 여기 <head>에서 지금 구역 도형을 바꿈(예전 도형은 zonePrev). 바꿨으면 위쪽 띠 + [되돌리기]
  //  - 비교는 꼭짓점 집합(약 1m 반올림) — 순서·방향·소수점 차이로 서로 다르다고 보지 않게
  const geomOf = gj => { if (!gj) return null; if (gj.type === 'Feature') return gj.geometry || null; if (gj.type === 'FeatureCollection') return gj.features && gj.features[0] ? gj.features[0].geometry : null; return gj.coordinates ? gj : null; };
  function zh(gj) {
    const gm = geomOf(gj); if (!gm || !gm.coordinates) return '';
    const set = new Set(), walk = a => { if (typeof a[0] === 'number') set.add(Math.round(a[0] * 1e5) + ',' + Math.round(a[1] * 1e5)); else a.forEach(walk); };
    walk(gm.coordinates);
    const str = [...set].sort().join(';'); let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '.' + set.size;
  }
  const seen = {};
  JbsProject.zoneHash = zh;
  JbsProject.zone = () => { const z = read().zone; return z && z.g ? z : null; };
  JbsProject.seenZone = (from, gj) => { seen[from] = zh(gj); };
  JbsProject.offerZone = function (gj, from) {
    const h = zh(gj); if (!h || seen[from] === h) return false;
    seen[from] = h;
    const p = read(); if (p.zone && p.zone.h === h) return false;
    p.zone = { g: geomOf(gj), h, at: now(), from: from || 'save' }; jset(KEY, p); return true;
  };
  // 이 화면 구역(gj)이 원본과 다르면 원본을 돌려줌(같으면 null)
  JbsProject.adoptFor = function (from, gj) {
    const z = JbsProject.zone(); if (!z) return null;
    const h = zh(gj); if (h === z.h) { seen[from] = h; return null; }
    return z;
  };
  const FROM = { main: '사업성 검토', urban: '정비계획 검토', site: '검토 도구', undo: '되돌리기' };
  JbsProject.fromName = f => FROM[f] || f || '';
  // 위쪽 띠: '다른 화면에서 바꾼 구역을 가져왔습니다' + [되돌리기]
  JbsProject.noteAdopted = function (msg, undo) {
    if (typeof document === 'undefined') return;
    const show = () => {
      let b = document.getElementById('jbsZoneNote');
      if (!b) { b = document.createElement('div'); b.id = 'jbsZoneNote'; b.style.cssText = 'position:sticky;top:0;z-index:1200;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 14px;background:#e7f5ff;border-bottom:1px solid #a5d8ff;font-size:13.5px;color:#1c3d5a'; const nav = document.getElementById('siteNav'); if (nav && nav.parentNode) nav.parentNode.insertBefore(b, nav.nextSibling); else document.body.prepend(b); }
      b.innerHTML = `<span>${msg}</span>` + (undo ? '<button type="button" id="jbsZoneUndo" style="border:1px solid #74c0fc;background:#fff;border-radius:5px;padding:2px 9px;cursor:pointer">되돌리기</button>' : '') + '<button type="button" id="jbsZoneX" style="margin-left:auto;border:0;background:none;cursor:pointer;font-size:15px" title="닫기">×</button>';
      const u = document.getElementById('jbsZoneUndo'); if (u) u.onclick = () => { b.remove(); undo(); };
      document.getElementById('jbsZoneX').onclick = () => b.remove();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  };
  // 공통 구역 쪽(<head>에서, 화면 코드보다 먼저): 원본과 같은 구역이 있으면 그것을 지금 구역으로, 없으면 지금 구역 도형을 원본으로 바꿈
  (function siteMirror() {
    try {
      const z = JbsProject.zone(), s = jget(SITES), cur = localStorage.getItem(CUR);
      const site = s && s.sites && cur ? s.sites[cur] : null;
      if (site) seen.site = zh(site.geojson);
      const P = (typeof location !== 'undefined' ? location.pathname : '').replace(/index\.html$/, '');
      if (!z || !s || !s.sites || P === '/' || /^\/urban\//.test(P)) return;   // 사업성·정비계획은 그 화면 코드가 맞춤
      if (site && zh(site.geojson) === z.h) return;
      const same = Object.values(s.sites).find(x => x && zh(x.geojson) === z.h);
      if (same) { localStorage.setItem(CUR, same.id); seen.site = z.h; return; }
      if (!site) return;
      site.zonePrev = site.geojson; site.geojson = { type: 'Feature', properties: {}, geometry: z.g };
      site.zoneFrom = { from: z.from, at: z.at }; site.updated = now();
      jset(SITES, s); seen.site = z.h;
      JbsProject.noteAdopted(`${JbsProject.fromName(z.from)} 화면에서 ${z.at}에 바꾼 구역계로 이 화면 구역을 맞췄습니다.${site.arch && site.arch.chosen ? ' 건축계획 확정안은 예전 구역 기준이니 다시 확정하세요.' : ''}`, () => {
        const s2 = jget(SITES), st = s2 && s2.sites && s2.sites[site.id]; if (!st || !st.zonePrev) return;
        st.geojson = st.zonePrev; delete st.zonePrev; jset(SITES, s2);
        seen.site = ''; JbsProject.offerZone(st.geojson, 'undo'); location.reload();
      });
    } catch (e) { console.warn('구역 맞추기 실패', e); }
  })();
  // 사업성 화면(<head>): 저장된 구역을 이 창이 본 구역으로(이 창의 다른 저장이 옛 구역을 원본으로 올리지 않게)
  try { const m = jget(MAIN); if (m && m.area) seen.main = zh(m.area.geojson); } catch (e) { /* 무시 */ }

  g.JbsProject = JbsProject;
})(typeof window !== 'undefined' ? window : globalThis);
