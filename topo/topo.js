/* /topo 고시용 지형도면(초안) 화면(2026-11-08) — 계산·그림은 shared/topo.js(JbsTopo)
   공통 구역(JbsSite)의 구역계·/arch 토지이용(건축 불가 영역)·건축선 후퇴(params.roadSb)를 브이월드 연속지적 위에 그림
   입력값: localStorage 'jbs-topo-v1' { [siteId]: { title, place, org, gosi, maker, date, scale, sb, mg, dz } }
   연속지적은 창 안에서만 기억(저장·작업 파일에 안 넣음 — 다시 받을 수 있는 자료) */
(() => {
  const $ = s => document.querySelector(s), TP = window.JbsTopo, KEY = 'jbs-topo-v1';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let site = null, parcels = [], M = null, S = null;
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const mine = () => (site && all()[site.id]) || {};
  const save = m => { if (!site) return; const a = all(); a[site.id] = m; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* 저장 공간 */ } };
  const today = () => { const d = new Date(); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
  const FIELDS = ['title', 'place', 'org', 'gosi', 'maker', 'date', 'scale', 'sb', 'mg'];
  const tpName = s => (/recon|재건축/.test(String(((s.plan || {}).type) || ((s.v || {}).type) || '') + (s.name || '')) ? '주택재건축' : '주택재개발');
  const decMeta = () => { try { return ((JSON.parse(localStorage.getItem('jbs-decision-v1') || '{}')[site.id] || {}).meta) || {}; } catch (e) { return {}; } };

  function meta() {
    const m = mine(), d = decMeta(), nm = d.name || site.name || '정비';
    return { title: m.title || `${nm.replace(/\s*(주택재개발|주택재건축)?정비사업$/, '')} ${tpName(site)}정비구역 지정 및 지구단위계획구역 지정 지형도면`, place: m.place || d.loc || '',
      org: m.org || d.org || '인천광역시', gosi: m.gosi || '', maker: m.maker || '', date: m.date || today() };
  }
  function opts() { const m = mine(), P = ((site.arch || {}).params) || {}; return { scale: m.scale || '', sb: m.sb !== undefined && m.sb !== '' ? +m.sb : (+P.roadSb || 0), mg: m.mg !== undefined && m.mg !== '' ? +m.mg : 25, dz: m.dz !== false }; }

  function render() {
    const box = $('#sheets'), warn = $('#warn');
    if (!site) { box.innerHTML = '<p class="note">구역계가 있는 공통 구역이 없습니다. /arch 또는 /urban에서 구역을 먼저 만드세요.</p>'; warn.innerHTML = ''; return; }
    const o = opts(), mt = meta();
    M = TP.model(site, parcels, { sb: o.sb, dz: o.dz });
    if (M.error) { box.innerHTML = `<p class="note">${esc(M.error)}</p>`; return; }
    S = TP.sheets(M, { scale: o.scale ? +o.scale : 0, margin: o.mg });
    let h = '';
    if (S.overview) h += `<div class="sheet">${TP.svg(M, null, S, mt, 'overview')}<div class="cap">총괄도 1/${S.overview.scale.toLocaleString('ko-KR')} (시행령 제7조⑤ — 도면이 2매 이상)</div></div>`;
    S.list.forEach(sh => { h += `<div class="sheet">${TP.svg(M, sh, S, mt, 'sheet')}<div class="cap">도면 ${sh.no} / ${S.list.length} · 축척 1/${S.scale.toLocaleString('ko-KR')} · A1 가로</div></div>`; });
    box.innerHTML = h;
    // 안내·경고
    const w = [];
    if (!parcels.length) w.push('연속지적을 아직 불러오지 않았습니다 — 지번 없이 구역·토지이용만 그렸습니다.');
    if (M.cross.length) w.push(`구역 경계가 필지 ${M.cross.length}개를 가로지릅니다(${M.cross.slice(0, 8).map(c => esc(c.jibun) + ' ' + Math.round(c.ratio * 100) + '%').join(', ')}${M.cross.length > 8 ? ' …' : ''}). 지적선 기준이 아니면 연속지적도가 아니라 지적이 표시된 지형도에 그려야 합니다(지침 제8조②). 분할 측량이 필요한지도 확인하세요.`);
    if (o.sb > 0 && !M.roadsKnown) w.push('도로 위치를 몰라 건축한계선을 못 그렸습니다 — /arch 건축 불가 영역에 도로를 넣거나 연속지적(지목 도)을 불러오세요.');
    if (o.sb > 0 && M.roadsKnown && !M.bline.length) w.push('획지가 도로에 닿은 변이 없어 건축한계선이 없습니다.');
    if (M.restA > M.zoneA * 0.003) w.push(`비율로만 잡은 정비기반시설 ${Math.round(M.restA).toLocaleString('ko-KR')}㎡는 위치가 정해지지 않아 도면에 없습니다 — /urban 3탭 또는 /arch에서 위치를 정하세요.`);
    if (o.scale && S.list.length > 1) w.push(`1/${(+o.scale).toLocaleString('ko-KR')}로는 한 장에 안 들어가 ${S.list.length}장으로 나눴습니다.`);
    w.push('고시 전 국토이용정보체계(KLIP) 지적 자료로 다시 맞추고 검수해야 합니다(지침 제6조①1호·제14조). 범례 색은 결정도 관례이며 개별 법령 도식이 있으면 그에 따릅니다(지침 제10조⑥).');
    warn.innerHTML = `<div class="w${w.length === 1 ? ' ok' : ''}"><b>확인할 것</b><ul>${w.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
    const ch = (site.arch || {}).chosen;
    $('#siteInfo').textContent = `구역 ${Math.round(M.zoneA).toLocaleString('ko-KR')}㎡ · 획지 ${Math.round(M.lotA).toLocaleString('ko-KR')}㎡ · 시설 ${M.land.filter(x => x.kind !== '획지').length}곳` + (ch ? ` · 확정안 ${(+ch.units || 0).toLocaleString('ko-KR')}세대` : '');
  }

  // 연속지적: 구역 범위 + 여유(m)
  async function fetchParcels() {
    if (!site) return; const btn = $('#fetch'); btn.disabled = true; $('#pcInfo').textContent = '불러오는 중…';
    try {
      if (!VWorld.enabled) throw new Error('브이월드 인증키가 없습니다');
      const f = { type: 'Feature', properties: {}, geometry: site.geojson.geometry || site.geojson }, mg = opts().mg + 10;
      const [x0, y0, x1, y1] = turf.bbox(turf.buffer(f, mg, { units: 'meters' }));
      parcels = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0},${y0},${x1},${y1})`, 20);
      $('#pcInfo').textContent = `필지 ${parcels.length.toLocaleString('ko-KR')}개를 불러왔습니다(브이월드 연속지적, ${new Date().toLocaleString('ko-KR')}).`;
    } catch (e) { $('#pcInfo').textContent = '연속지적을 못 불러왔습니다: ' + e.message + ' (www.jbslab.co.kr에서만 됩니다)'; }
    btn.disabled = false; render();
  }

  // 내려받기
  const fileBase = () => meta().title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  function down(data, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  $('#print').addEventListener('click', () => window.print());
  $('#dxf').addEventListener('click', () => { if (M && !M.error) down(TP.dxf(M, meta()), fileBase() + '.dxf', 'application/dxf'); });
  $('#shp').addEventListener('click', () => { if (M && !M.error) down(TP.zip(TP.shapes(M)), fileBase() + '_SHAPE.zip', 'application/zip'); });
  $('#svg').addEventListener('click', () => {
    if (!M || M.error) return; const mt = meta();
    if (S.overview) down(TP.svg(M, null, S, mt, 'overview'), fileBase() + '_총괄도.svg', 'image/svg+xml');
    S.list.forEach((sh, i) => setTimeout(() => down(TP.svg(M, sh, S, mt, 'sheet'), `${fileBase()}_${sh.no}.svg`, 'image/svg+xml'), 300 * (i + 1)));
  });
  $('#fetch').addEventListener('click', fetchParcels);
  FIELDS.forEach(id => $('#' + id).addEventListener('change', () => { const m = mine(); m[id] = $('#' + id).value.trim(); save(m); render(); }));
  $('#dz').addEventListener('change', () => { const m = mine(); m.dz = $('#dz').checked; save(m); render(); });

  function pick(id) {
    site = id ? JbsSite.get(id) : null; parcels = [];
    $('#pcInfo').textContent = '지적을 불러오지 않으면 구역·토지이용만 그립니다.';
    if (site) {
      try { localStorage.setItem('jbs.sites.current', site.id); } catch (e) { /* 무시 */ }
      const m = mine(), mt = meta(), o = opts();
      ['title', 'place', 'org', 'gosi', 'maker', 'date'].forEach(k => { $('#' + k).value = m[k] || ''; $('#' + k).placeholder = mt[k] || $('#' + k).placeholder; });
      $('#scale').value = m.scale || ''; $('#sb').value = o.sb; $('#mg').value = o.mg; $('#dz').checked = o.dz;
    }
    render();
    if (site && VWorld.enabled && /jbslab\.co\.kr$/.test(location.hostname)) fetchParcels();   // 홈페이지에서는 바로 불러옴
  }
  const ring = s => { const g = s && s.geojson; const geo = g && (g.geometry || g); return geo && /Polygon/.test(geo.type); };
  const list = (window.JbsSite ? JbsSite.list() : []).filter(ring);
  $('#siteSel').innerHTML = list.length ? list.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${(s.arch || {}).chosen ? ' (확정안)' : ''}</option>`).join('') : '<option value="">공통 구역 없음</option>';
  const q = new URLSearchParams(location.search); let id = q.get('site'); if (!id) { try { id = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { id = ''; } }
  if (!list.find(s => s.id === id)) id = (list[0] || {}).id || '';
  if (id) $('#siteSel').value = id;
  $('#siteSel').addEventListener('change', e => pick(e.target.value));
  pick(id);
})();
