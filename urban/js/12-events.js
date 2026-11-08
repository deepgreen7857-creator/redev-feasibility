// /urban 정비계획 화면 코드 12/12 — 버튼·단축키 연결, 기준 파일 읽기(rules/criteria), 화면 크기 조절, 도구 설명 줄, 시작(syncTitle)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 이벤트 ===== */
function syncMode() { document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === S.mode)); }
// 사이트 길잡이(shared/sitenav.js) 2단 '정비계획 순서'에 지금 탭 표시(4탭 = 1 주출입구 설정, 3탭 = 2 정비기반시설 지정)
const navMark = () => { try { if (window.JbsNav) JbsNav.mark(S.tab); } catch (e) { /* 무시 */ } };
setTimeout(navMark, 50);
document.querySelectorAll('nav.steps button').forEach(b => b.addEventListener('click', () => setTimeout(navMark, 0)));
document.querySelectorAll('nav.steps button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll('nav.steps button').forEach(x => x.setAttribute('aria-selected', x === b));
  if (S.tab === 'arch' && S.mode !== 'arch') { S.mode = 'arch'; syncMode(); }
  if (S.tab === 'plan' && D && D.map && S.mode !== 'infra') { S.mode = 'infra'; syncMode(); }
  render();
});
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; syncMode(); render(); });
const drawBtn = $id('drawBtn'), finBtn = $id('finishBtn'), canBtn = $id('cancelBtn');
function endDraw() { S.drawing = false; S.draft = []; drawBtn.hidden = false; finBtn.hidden = true; canBtn.hidden = true; }
drawBtn.onclick = () => {
  if (D.map) { startMapDraw(); return; }
  S.drawing = true; S.draft = []; drawBtn.hidden = true; finBtn.hidden = false; finBtn.disabled = true; canBtn.hidden = false; drawSvg(); toast('도면을 눌러 꼭짓점을 찍으세요');
};
canBtn.onclick = () => { endDraw(); drawSvg(); };
finBtn.onclick = () => {
  if (S.draft.length < 3) return;
  D.regions.C.pts = S.draft.slice();
  try { localStorage.setItem('jbs-urban-C-sample', JSON.stringify(D.regions.C.pts)); } catch (e) { /* 무시 */ }
  endDraw(); S.region = 'C'; syncRegionChips(); render(); toast('직접 그린 안으로 판정했습니다');
};
$id('editBtn').onclick = toggleEdit;
$id('cutBtn').onclick = () => (CUT.active ? (CUT.stop(), statusMsg('')) : CUT.start());
$id('undoBtn').onclick = () => undoZone(false);
$id('redoBtn').onclick = () => undoZone(true);
document.addEventListener('keydown', e => {
  if (!D || !D.map || drawH || editH) return;
  const t = e.target; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoZone(e.shiftKey); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undoZone(true); }
});
$id('pickBtn').onclick = () => { if (!LM) return; if (drawH) { toast('그리기를 먼저 마쳐 주세요'); return; } ZK.setPicking(!ZK.picking); };
$id('zkJibunBtn').onclick = () => ZK.fromJibuns();
$id('zkCloseBtn').onclick = () => ZK.closure();
$id('zkSnapBtn').onclick = () => ZK.snap();
$id('zkAnchorBtn').onclick = () => ZK.fromAnchors();
$id('zkFileBtn').onclick = () => { $id('zkFile').value = ''; $id('zkFile').click(); };
$id('zkFile').onchange = e => { const f = e.target.files[0]; if (f) ZK.readFile(f); };
$id('fetchBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('먼저 구역계를 그려 주세요'); return; }
  if (busy) { toast('불러오는 중입니다'); return; }
  fetchZone(S.region);
};
$id('geoInBtn').onclick = () => {
  const R = D.regions[S.region];
  if (R.geojson && !confirm(`${R.name} 구역계를 파일 내용으로 바꿀까요?`)) return;
  $id('geoFile').value = ''; $id('geoFile').click();
};
$id('geoFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (/\.dxf$/i.test(f.name)) {   // CAD 구역도 — js/zonekit.js ZoneKit.readDxf (사업성 검토와 같은 코드)
    statusMsg(`${f.name} 읽는 중…`);
    const c = LM ? LM.getCenter() : null;
    let r; try { r = await ZoneKit.readDxf(await f.arrayBuffer(), c ? [c.lat, c.lng] : null); } catch (er) { statusMsg(`${f.name}을(를) 읽지 못했습니다: ${er.message}`, true); return; }
    if (r.error) { statusMsg(r.error, true); return; }
    importGeoJSONText(JSON.stringify(r.fc));
    statusMsg(ZoneKit.dxfNote(r, f.name));
    return;
  }
  const r = new FileReader(); r.onload = () => importGeoJSONText(String(r.result)); r.readAsText(f);
};
// 참고 도면 겹쳐 보기 — js/overlay.js(사업성 검토와 같은 코드)를 이 화면 지도(LM)에 연결
if (typeof RefOverlay !== 'undefined') {
  RefOverlay.host = {
    map: () => LM,
    ensure: () => { if (S.source !== 'map') setSource('map'); initLeaflet(); },
    picking: () => !!ZK.picking,
    stopPicking: () => { ZK.picking = false; },
    ids: { msg: 'zkRefMsg', also: 'zkMsg', align: 'zkRefAlign', toggle: 'zkRefToggle', remove: 'zkRefRemove', opacity: 'zkRefOpacity' },
  };
  $id('zkRefLoad').onclick = () => RefOverlay.load();
  $id('zkRefAlign').onclick = () => RefOverlay.startAlign();
  $id('zkRefToggle').onclick = () => RefOverlay.toggle();
  $id('zkRefRemove').onclick = () => RefOverlay.remove();
  $id('zkRefOpacity').oninput = e => RefOverlay.setOpacity(+e.target.value);
}
$id('geoOutBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('내보낼 구역계가 없습니다'); return; }
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [{ ...R.geojson, properties: { name: (Z.title ? Z.title + ' ' : '') + R.name } }] }, null, 1)], { type: 'application/geo+json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `구역계_${Z.title ? Z.title.replace(/[\\/:*?"<>|\s]+/g, '_') + '_' : ''}${R.name}.geojson`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$id('clearBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('지울 구역계가 없습니다'); return; }
  if (!confirm(`${R.name} 구역계와 판정 결과를 지울까요?`)) return;
  setZoneGeom(S.region, null, 0, '안 지우기'); statusMsg(`${S.region}안 구역계를 지웠습니다. 실행 취소로 되돌릴 수 있습니다.`);
};
$id('searchForm').onsubmit = async e => {
  e.preventDefault();
  const q = $id('searchQ').value.trim(); if (!q || !LM) return;
  if (!VW.ok) { toast('브이월드 인증키가 없어 검색할 수 없습니다'); return; }
  try {
    const r = await VW.search(/인천|미추홀|서울|경기|부산|대구|광주|대전|울산|세종|강원|충|전|경|제주/.test(q) ? q : '인천광역시 미추홀구 ' + q);
    if (!r) { toast('주소를 찾지 못했습니다'); return; }
    LM.setView([r.lat, r.lon], 18); toast(r.label);
    const m = String(r.label).match(/^(.*?[가-힣]+(동|리|가))(\s|\d|$)/);
    if (m && !$id('zkBase').value.trim()) $id('zkBase').value = m[1].trim();
  } catch (err) { toast('검색에 실패했습니다: ' + err.message); }
};

// 교통·환경 검토서 기준표(숫자는 shared/criteria에서만) — 요건판정 탭의 '관련 평가 대상(개략)'에 씀
const CRIT = {};
fetch('../shared/templates/traffic_ko.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { CRIT.tplTraffic = j; if (D.map && S.tab !== 'rules') render(); } }).catch(() => {});
['traffic', 'environment'].forEach(k => fetch(`../shared/criteria/${k}.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { CRIT.raw = CRIT.raw || {}; CRIT.raw[k] = j; CRIT[k] = {}; (j.items || []).forEach(it => { CRIT[k][it.id] = it; }); if (S.tab === 'req' || S.tab === 'arch' || (D.map && S.tab !== 'rules')) render(); } }).catch(() => {}));
// 평형 목록·평형 구성 예시(개략 건축계획 탭) — shared/criteria/arch.json의 '평면'(숫자 키)·'평형구성_예시'. /arch와 같은 표
let ARCHC = null;
fetch('../shared/criteria/arch.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { ARCHC = j; if (S.tab === 'arch') render(); } }).catch(() => {});
const unitTypes = () => { const ks = ARCHC && ARCHC['평면'] ? Object.keys(ARCHC['평면']).filter(k => /^\d+$/.test(k)) : Object.keys(JbsFeas.mixOf(JbsFeas.get())); return ks.map(Number).sort((x, y) => x - y); };
// 법정 주차 하한(주택) — 숫자는 shared/criteria/traffic.json parking_housing에서만. pl.byType(임대 포함 평형별 세대)로 계산
function legalPark(pl) {
  const it = CRIT.traffic && CRIT.traffic.parking_housing; if (!it || !pl || !pl.byType) return null;
  let u = 0, u60 = 0, a85 = 0, a85u = 0;
  Object.entries(pl.byType).forEach(([t, c]) => { const ex = num(t), k = num(c); u += k; if (ex <= 60) u60 += k; if (ex <= 85) a85 += k * ex; else a85u += k * ex; });
  const ord = it.조례 && +it.조례.세대당_최저 || 0, per60 = Math.max(it.세대당_최저.전용60이하, ord), per = Math.max(it.세대당_최저.일반, ord);
  const minByUnits = Math.ceil(u60 * per60 + Math.max(0, u - u60) * per - 1e-9), byArea = Math.ceil(a85 / it.비율['85이하'] + a85u / it.비율['85초과'] - 1e-9);
  return { legal: Math.max(minByUnits, byArea), minByUnits, byArea, u60, per60, per, basis: it.근거 || '' };
}
fetch('rules/incheon.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) applyJson(j); }).catch(() => {}).finally(async () => {
  loadData();
  const first = D.map && D.keys.find(k => D.regions[k].geojson);
  if (first) { S.region = first; syncRegionChips(); renderSourceBar(); fitZone(first); }
  render();
  // 사업성 검토 '1차 재검토' → ?from=main: 사업성 검토 구역계·조서를 빈 안(없으면 새 안)으로 가져와 정비계획(기반시설) 탭을 엶
  const qs = new URLSearchParams(location.search);
  // ?tab=plan|arch|… 로 그 탭을 바로 열고, ?focus=gate면 단지 출입구 칸으로 내려감(사업성 화면 순서 버튼에서 씀)
  if (qs.get('tab') && qs.get('from') !== 'main') {
    const tb = qs.get('tab'), fc = qs.get('focus');
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => { const b = document.querySelector(`nav.steps button[data-tab="${tb}"]`); if (b) b.click(); if (fc === 'gate') setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); }, 300);
  }
  if (qs.get('from') === 'main') {
    history.replaceState(null, '', location.pathname + location.hash);
    const pj = loadProject();
    if (!pj || !pj.area || !pj.area.geojson) { alert('사업성 검토 화면(2단계 구역계)에 저장된 구역이 없습니다.\n사업성 검토 화면 2단계에서 구역을 만든 뒤(구역이 지도에 파랗게 보이는 상태) ★빠른 사업성의 ① 버튼을 다시 눌러 주세요.\n지금 보이는 안은 예전 구역입니다.'); return; }
    if (S.source !== 'map') setSource('map');
    const pg = pj.area.geojson;
    // A~E는 '한 사업'의 여러 안 — 지금 구역과 조금도 겹치지 않는 안은 다른 사업이므로 자동 백업 후 비움(묻지 않음)
    if (pg && window.turf) {
      const touch = g => { try { const x = turf.intersect(g, pg); return !!x && turf.area(x) > 1; } catch (e) { return false; } };
      const filled = ZONE_IDS.filter(k => Z.zones[k] && Z.zones[k].geojson);
      const mine = filled.filter(k => touch(Z.zones[k].geojson)), other = filled.filter(k => !mine.includes(k));
      if (other.length) {
        if (window.JbsWork) { try { await JbsWork.backup(`정비계획 다른 사업(${Z.title || other.join('·') + '안'}) 비우기 전 자동 백업`); } catch (e) { /* 백업 실패해도 진행 */ } }
        const keep = mine.map(k => Z.zones[k]); Z.zones = {};
        keep.forEach((z, i) => { Z.zones[ZONE_IDS[i]] = z; });
        Object.keys(HIST).forEach(k => delete HIST[k]);
        Z.count = Math.max(1, keep.length);
        if (!keep.length) { Z.title = ''; resetPlanState(); }   // 사업성 검토에서 다른 위치를 가져오면 계획 가정도 처음부터
        saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); S.region = D.keys[0];
        syncRegionChips(); renderSourceBar();
        toast(`다른 사업 구역(${other.length}개 안)은 자동 백업한 뒤 비웠습니다. [작업 저장·불러오기]에서 되돌릴 수 있습니다`);
      }
      const nm = pj.meta && pj.meta.name && pj.meta.name !== '새 정비사업' ? pj.meta.name : '';
      if (nm && !Z.title) { Z.title = nm; saveZ(); syncTitle(); }
    }
    // 같은 사업 안 중 지금 구역과 90% 이상 겹치는 안이 있으면 그 안의 구역계·조서를 지금 것으로 바꿈(기반시설 설정은 유지)
    const same = pg && window.turf ? D.keys.find(k => { const g = D.regions[k].geojson; if (!g) return false; try { const x = turf.intersect(g, pg); return x && turf.area(x) / Math.max(turf.area(g), turf.area(pg)) >= 0.9; } catch (e) { return false; } }) : null;
    let id = same || D.keys.find(k => !D.regions[k].geojson);
    if (!id && D.keys.length < ZONE_IDS.length) { Z.count = D.keys.length + 1; saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); id = D.keys[D.keys.length - 1]; }
    if (!id) {
      const pick = S.region || D.keys[0];
      if (!confirm(`정비계획 안(A~E)이 모두 차 있습니다. 지금 보고 있는 ${pick}안을 사업성 검토 구역으로 바꿀까요?\n바꾸기 전 ${pick}안은 홈페이지에 자동 저장되어 오른쪽 아래 [작업 저장·불러오기]에서 언제든 되돌릴 수 있습니다.`)) return;
      if (window.JbsWork) await JbsWork.backup(pick + '안 바꾸기 전 자동 백업');
      id = pick;
    }
    importProject(id).then(() => { const b = document.querySelector('nav.steps button[data-tab="arch"]'); if (b) b.click(); setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); toast(`${id}안으로 사업성 검토 구역을 가져왔습니다. 먼저 주출입구를 찍어 진입도로를 정한 뒤 3탭에서 도로 확폭·공원을 정하세요`, 6000); });
  }
});


/* ===== 화면 크기 조절: 지도 ↔ 설명 너비, 지도 높이 (끌기·화살표 키, 두 번 누르면 처음대로) ===== */
(() => {
  const KEY = 'jbs-urban-split', root = document.documentElement;
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ } };
  let t = 0; const fit = () => { clearTimeout(t); t = setTimeout(() => { if (typeof LM !== 'undefined' && LM) LM.invalidateSize(); }, 60); };
  const apply = () => {
    if (st.lw) root.style.setProperty('--lw', st.lw + '%'); else root.style.removeProperty('--lw');
    if (st.mh) root.style.setProperty('--mh', st.mh + 'px'); else root.style.removeProperty('--mh');
    fit();
  };
  apply();
  const lay = document.querySelector('.layout');
  const drag = (el, onMove) => {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('resizing');
      const mv = ev => { onMove(ev); apply(); };
      const up = () => { el.classList.remove('drag'); document.body.classList.remove('resizing'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); save(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  };
  const h = document.getElementById('hSplit'), v = document.getElementById('vSplit');
  drag(h, ev => { const r = lay.getBoundingClientRect(); st.lw = Math.round(Math.min(80, Math.max(25, (ev.clientX - r.left) / r.width * 100)) * 10) / 10; });
  drag(v, ev => { const m = document.getElementById('lmap').getBoundingClientRect(); st.mh = Math.round(Math.min(window.innerHeight * 1.5, Math.max(260, ev.clientY - m.top))); });
  const key = (el, k1, k2, f) => el && el.addEventListener('keydown', e => { const d = e.key === k1 ? -1 : e.key === k2 ? 1 : 0; if (!d) return; e.preventDefault(); f(d * (e.shiftKey ? 5 : 1)); apply(); save(); });
  key(h, 'ArrowLeft', 'ArrowRight', d => { st.lw = Math.min(80, Math.max(25, (st.lw || 53) + d * 2)); });
  key(v, 'ArrowUp', 'ArrowDown', d => { st.mh = Math.max(260, (st.mh || 560) + d * 20); });
  if (h) h.addEventListener('dblclick', () => { delete st.lw; apply(); save(); });
  if (v) v.addEventListener('dblclick', () => { delete st.mh; apply(); save(); });
})();

/* ===== 도구 막대 설명 줄(지도 위): 아이콘과 이름을 늘 보여 주고, 버튼에 마우스를 올리면 자세한 설명 ===== */
(() => {
  const box = document.getElementById('toolHelp'), bar = document.getElementById('mapTools');
  if (!box || !bar) return;
  const btns = [...bar.querySelectorAll('button.mt')];
  const build = () => {
    const parts = [];
    bar.querySelectorAll('button.mt, .mt-sep').forEach(el => {
      if (el.classList.contains('mt-sep')) { parts.push('<span class="sep" aria-hidden="true">|</span>'); return; }
      const name = el.getAttribute('aria-label') || '';
      parts.push(`<button type="button" data-for="${el.id}" ${el.disabled ? 'disabled' : ''} class="${el.classList.contains('on') ? 'hot' : ''}"><span class="k" aria-hidden="true">${el.textContent}</span>${esc(name)}</button>`);
    });
    box.innerHTML = parts.join('') + '<span class="tip idle" id="toolTip"></span>';
    show(null);
    box.querySelectorAll('[data-for]').forEach(b => {
      const t = document.getElementById(b.dataset.for);
      b.onclick = () => t.click();
      b.onmouseenter = b.onfocus = () => show(t);
      b.onmouseleave = b.onblur = () => show(null);
    });
  };
  // 설명 칸 높이는 늘 같게(누르는 도중 화면이 밀려 클릭이 빗나가지 않게)
  const show = t => { const tip = document.getElementById('toolTip'); if (!tip) return; tip.textContent = t ? (t.dataset.tip || '') : '버튼이나 이름에 마우스를 올리면 자세한 설명이 여기에 나옵니다'; tip.classList.toggle('idle', !t); };
  btns.forEach(t => { t.addEventListener('mouseenter', () => show(t)); t.addEventListener('focus', () => show(t)); t.addEventListener('mouseleave', () => show(null)); t.addEventListener('blur', () => show(null)); });
  // 버튼 상태(켜짐·꺼짐·이름)가 바뀌면 설명 줄도 다시 그림
  new MutationObserver(build).observe(bar, { subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'aria-label'] });
  build();
  const syncHidden = () => { box.hidden = bar.hidden; };
  new MutationObserver(syncHidden).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  syncHidden();
})();

syncTitle();
