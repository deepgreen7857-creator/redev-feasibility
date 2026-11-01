'use strict';
// 검토서 도구 공통 화면 (/traffic, /env, /landscape)
// - 지도에서 구역계 그리기 또는 저장 구역·/urban 안 불러오기
// - 입력값은 구역 하나(site.v)에 저장 → 다른 검토서 도구에서도 같은 값이 보임
// - 각 도구는 fields(입력 칸)와 build(검토서 HTML·배치 조건)만 넘김
(function (g) {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const fmt = (v, d = 0) => num(v) === null ? '○○' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: d });
  const T = v => (v === '' || v === null || v === undefined) ? '○○' : esc(v);
  const badge = r => {
    const s = String(r);
    const cls = /^○○$|확인/.test(s) ? 'b-unk' : /미충족|대상$|^대상|해당|필요/.test(s) && !/아님|없음/.test(s) ? 'b-bad' : 'b-ok';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };
  const chk = on => on ? ' <span class="chk">※ 기준 확인 필요</span>' : '';
  const TYPES = { redev: '정비사업', district: '지구단위계획', facility: '도시계획시설', building: '건축물' };
  const LEVELS = ['', '간선도로', '보조간선도로', '집산도로', '국지도로'];
  const TOOLS = [['traffic', '교통성 검토서'], ['env', '환경성 검토서'], ['arch', '개략 건축계획'], ['landscape', '높이·경관계획']];

  const COMMON = [
    { title: null, fields: [
      { k: 'name', label: '구역 이름', ph: '예: 숭의2구역' },
      { k: 'type', label: '사업 유형', select: TYPES },
      { k: 'loc', label: '위치(지번 일원)', ph: '예: 숭의동 ○○번지 일원' },
      { k: 'zoning', label: '용도지역', ph: '예: 제2종일반주거지역' },
      { k: 'siteArea', label: '구역(부지)면적 ㎡', num: true },
      { k: 'year', label: '목표연도', num: true, ph: '예: 2032' },
    ] },
  ];
  const SCALE = { title: '계획 규모', fields: [
    { k: 'units', label: '계획 세대수(임대 포함)', num: true },
    { k: 'far', label: '용적률 %', num: true },
    { k: 'bcr', label: '건폐율 %', num: true },
    { k: 'floors', label: '최고층수', num: true },
  ] };

  function start(cfg) {
    let site = null, C = null, Tp = null, map = null, layer = null, mk = null;
    const v = () => site.v;

    // 화면 틀
    document.title = `jbslab ${cfg.title}`;
    $('#app').innerHTML = `
    <header class="top">
      <div class="mark" aria-label="jbslab">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="4" fill="var(--ink)"/><path d="M6 6h6v6H6zM14 6h6v6h-6zM6 14h6v6H6z" fill="var(--paper)" opacity=".85"/><path d="M14 14h6v6h-6z" fill="none" stroke="var(--redline)" stroke-width="1.6" stroke-dasharray="3 1.4 .8 1.4"/></svg>
        jbslab <small>/${cfg.tool}</small>
      </div>
      <h1>${esc(cfg.title)} 초안</h1>
      <a href="../urban/">정비계획 검토로</a>
    </header>
    <nav class="tools" aria-label="검토서 도구">${TOOLS.map(([k, n]) => `<a href="../${k}/" data-tool="${k}"${k === cfg.tool ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
    <div class="layout">
      <section class="panel" aria-label="구역">
        <h2>1. 구역</h2>
        <div class="bar">
          <select id="siteSel" aria-label="구역 불러오기"><option value="">구역 불러오기…</option></select>
          <button id="newSite">새로 그리기</button>
          <button id="delSite">구역 삭제</button>
        </div>
        <div id="map" aria-label="구역 지도"></div>
        <p class="note">지도 왼쪽 위 다각형 도구로 구역계를 그리면 면적이 자동으로 들어갑니다. /urban에서 그린 안은 '구역 불러오기'에서 고르세요. 입력한 값은 교통·환경·경관 검토서가 같이 씁니다.</p>
      </section>
      <section class="panel" aria-label="입력">
        <h2>2. 현황·계획값</h2>
        <div id="form"></div>
        <div class="bar" style="margin-top:14px">
          <button class="primary" id="make">검토서 만들기</button>
          <button id="save">구역 저장</button>
        </div>
        <div class="msg" id="msg" role="status"></div>
      </section>
    </div>
    <section id="report" aria-label="검토서"></section>`;

    // 입력 칸
    const groups = [...COMMON, ...(cfg.roads ? [{ title: '접도 도로', roads: true }] : []), ...(cfg.scale !== false ? [SCALE] : []), ...cfg.groups];
    const fieldHtml = f => {
      if (f.select) return `<label>${esc(f.label)}<select data-k="${f.k}">${Object.entries(f.select).map(([a, b]) => `<option value="${esc(a)}">${esc(b)}</option>`).join('')}</select></label>`;
      return `<label>${esc(f.label)}<input data-k="${f.k}"${f.num ? ' inputmode="decimal"' : ''} placeholder="${esc(f.ph || '')}"></label>`;
    };
    $('#form').innerHTML = groups.map(gp => gp.roads
      ? `<h3>접도 도로</h3><table><thead><tr><th>도로명</th><th style="width:76px">폭(m)</th><th style="width:96px">규모</th><th style="width:130px">위계</th><th style="width:44px"></th></tr></thead><tbody id="roads"></tbody></table>
         <div class="bar" style="margin-top:6px"><button id="addRoad">도로 추가</button><span class="note" id="roadsFrom"></span></div>`
      : `${gp.title ? `<h3>${esc(gp.title)}</h3>` : ''}<div class="grid">${gp.fields.map(fieldHtml).join('')}</div>${gp.note ? `<p class="note">${esc(gp.note)}</p>` : ''}`).join('');

    const msg = (t, bad) => { const m = $('#msg'); m.textContent = t; m.style.display = 'block'; m.style.background = bad ? 'var(--bad-soft)' : 'var(--accent-soft)'; };
    const blank = () => ({ name: '', v: { type: 'redev', roads: [] }, constraints: {} });

    function toForm() {
      document.querySelectorAll('#form [data-k]').forEach(el => { const x = v()[el.dataset.k]; el.value = x ?? (el.tagName === 'SELECT' ? el.options[0].value : ''); });
      if (cfg.roads) renderRoads();
    }
    function fromForm() {
      document.querySelectorAll('#form [data-k]').forEach(el => { v()[el.dataset.k] = el.value.trim(); });
      if (cfg.roads) v().roads = [...document.querySelectorAll('#roads tr')].map(tr => { const w = tr.querySelector('.rw').value.trim(), dec = tr.dataset.dec || ''; return { name: tr.querySelector('.rn').value.trim(), w, level: tr.querySelector('.rl').value, dec, scale: dec || (num(w) !== null && window.AutoSite ? AutoSite.scaleOf(w) : '') }; }).filter(r => r.name || r.w);
      site.name = v().name || site.name || '이름 없는 구역';
    }
    function renderRoads() {
      const rs = v().roads && v().roads.length ? v().roads : [{ name: '', w: '', level: '' }];
      $('#roads').innerHTML = rs.map(r => `<tr data-dec="${esc(r.dec || '')}"><td><input class="rn" value="${esc(r.name)}" placeholder="예: 숭의로"></td><td><input class="rw" inputmode="decimal" value="${esc(r.w)}"></td>
        <td class="rs note" title="${r.dec ? '도시계획도로 결정 등급' : '폭 기준(도시·군계획시설 규칙 제9조)'}">${esc(r.dec ? r.dec + '(결정)' : (num(r.w) !== null && window.AutoSite ? AutoSite.scaleOf(r.w) : ''))}${num(r.w) !== null && +r.w < 4 ? '<br><b style="color:var(--bad)">4m 미만</b>' : ''}</td>
        <td><select class="rl">${LEVELS.map(l => `<option${l === (r.level || '') ? ' selected' : ''} value="${l}">${l || '모름'}</option>`).join('')}</select></td><td><button class="rx" aria-label="도로 삭제">×</button></td></tr>`).join('');
      $('#roadsFrom').textContent = v().roadsFrom ? `가져온 값: ${v().roadsFrom}` : '';
    }

    // 지도
    function initMap() {
      const c = [37.4645, 126.6455];
      map = L.map('map').setView(c, 16);
      const key = (typeof VWORLD_KEY !== 'undefined' && VWORLD_KEY) ? VWORLD_KEY : '';
      if (key && /jbslab\.co\.kr$/.test(location.hostname)) L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/{z}/{y}/{x}.png`, { maxZoom: 21, maxNativeZoom: 19, attribution: '브이월드' }).addTo(map);
      else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      layer = new L.FeatureGroup().addTo(map);
      map.addControl(new L.Control.Draw({ edit: { featureGroup: layer }, draw: { polygon: { shapeOptions: { color: '#c8322b', dashArray: '8 3 2 3' } }, polyline: false, circle: false, circlemarker: false, marker: !!cfg.markers, rectangle: false } }));
      mk = L.layerGroup().addTo(map);
      const take = lyr => {
        layer.clearLayers(); layer.addLayer(lyr);
        site.geojson = lyr.toGeoJSON();
        const a = Math.round(turf.area(site.geojson) * 10) / 10;
        const c2 = turf.centerOfMass(site.geojson).geometry.coordinates;
        Object.assign(v(), { siteArea: String(a), lng: c2[0], lat: c2[1] });
        document.querySelector('[data-k="siteArea"]').value = a;
        msg(`구역 면적 ${fmt(a, 1)}㎡ (지도 계산값, 공부면적과 다를 수 있음)`);
      };
      map.on(L.Draw.Event.CREATED, e => {
        if (e.layerType === 'marker') {
          const ll = e.layer.getLatLng(), vp = v().viewPts = v().viewPts || [];
          vp.push({ lng: ll.lng, lat: ll.lat, name: `조망점 ${vp.length + 1}` }); showMarks(); msg(`조망점 ${vp.length}을 찍었습니다. 표시를 누르면 지웁니다.`); return;
        }
        take(e.layer);
      });
      map.on(L.Draw.Event.EDITED, e => e.layers.eachLayer(take));
    }
    function showMarks() {
      if (!mk) return; mk.clearLayers();
      (v().viewPts || []).forEach((p, i) => L.marker([p.lat, p.lng], { title: p.name }).bindTooltip(p.name, { permanent: true, direction: 'top' }).on('click', () => { v().viewPts.splice(i, 1); v().viewPts.forEach((q, k) => { q.name = `조망점 ${k + 1}`; }); showMarks(); }).addTo(mk));
    }
    function showGeo() {
      layer.clearLayers();
      if (!site.geojson) return;
      const gl = L.geoJSON(site.geojson, { style: { color: '#c8322b', dashArray: '8 3 2 3', weight: 2, fillOpacity: .08 } });
      gl.eachLayer(l => layer.addLayer(l));
      try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch (e) { /* 무시 */ }
    }

    // 구역 목록
    function fillSel() {
      const s = $('#siteSel');
      const saved = JbsSite.list(), urb = JbsSite.urbanZones();
      s.innerHTML = '<option value="">구역 불러오기…</option>' +
        (saved.length ? `<optgroup label="저장한 구역">${saved.map(x => `<option value="s:${x.id}"${site && site.id === x.id ? ' selected' : ''}>${esc(x.name)} (${esc(x.updated || '')})</option>`).join('')}</optgroup>` : '') +
        (urb.length ? `<optgroup label="/urban 정비계획 검토의 안">${urb.map(x => `<option value="u:${x.key}">${x.key}안 가져오기</option>`).join('')}</optgroup>` : '');
    }
    function load(s) {
      site = s; site.v = site.v || { type: 'redev', roads: [] };
      // /urban에서 가져온 구역: profile 값을 v로 옮김
      if (site.profile) {
        if (site.profile.roads && !(site.v.roads || []).length) { site.v.roads = site.profile.roads; site.v.roadsFrom = site.profile.roadsFrom; }
        if (site.profile.zoning && !site.v.zoning) site.v.zoning = site.profile.zoning;
      }
      if (site.geojson && !num(site.v.siteArea)) site.v.siteArea = String(Math.round(turf.area(site.geojson) * 10) / 10);
      if (!site.v.name) site.v.name = site.name || '';
      toForm(); showGeo(); showMarks(); fillSel(); $('#report').innerHTML = '';
      try { localStorage.setItem('jbs.sites.current', site.id || ''); } catch (e) { /* 무시 */ }
      // 자동 채우기(빈 칸만): 도로 규모·위계, 위치, 최근접 역·버스정류장
      if (window.AutoSite && site.geojson) {
        const me = site;
        msg('현황 자동 채우는 중…(도로 위계·위치·대중교통)');
        AutoSite.fill(me).then(r => {
          if (site !== me) return;
          if (r.changed) { JbsSite.save(me); toForm(); fillSel(); msg('자동으로 채웠습니다: ' + r.notes.join(' · ') + '. 값이 다르면 칸에서 바로 고치세요.'); }
          else msg('');
        }).catch(e => { console.warn(e); msg(''); });
      }
    }

    // 검토서
    async function make() {
      fromForm();
      const p = Object.assign({}, v());
      let out;
      try { msg('검토서를 만드는 중…'); out = await cfg.build({ p, C, T: Tp, site, h: { esc, fmt, T, badge, chk, num, TYPES } }); }
      catch (e) { msg('검토서를 만들지 못했습니다: ' + e.message, true); console.error(e); return; }
      if (out.constraints) { site.constraints = site.constraints || {}; site.constraints[cfg.tool] = Object.assign({}, out.constraints, { at: new Date().toLocaleString('sv-SE').slice(0, 16) }); }
      JbsSite.save(site); fillSel();
      const today = new Date().toLocaleDateString('ko-KR');
      const cons = site.constraints || {};
      const consHtml = Object.keys(cons).length ? `<h2>부록. 개략 배치(/arch)에 넘기는 배치 조건</h2><div class="cons">${Object.entries(cons).map(([tool, o]) => `<p><b>${esc((TOOLS.find(t => t[0] === tool) || [tool, tool])[1])}</b> (${esc(o.at || '')})</p><ul>${Object.entries(o).filter(([k]) => k !== 'at').map(([k, x]) => `<li>${esc(k.replace(/_/g, ' '))}: ${esc(Array.isArray(x) ? (x.length ? x.map(y => typeof y === 'object' ? Object.values(y).join(' ') : y).join(', ') : '없음') : (x === null || x === '' ? '○○' : x))}</li>`).join('')}</ul>`).join('')}</div>` : '';
      $('#report').innerHTML = `<div class="rbar"><button id="dlDoc">워드(.doc)로 내려받기</button><button id="prt">인쇄 · PDF 저장</button></div>
        <article class="doc" id="docBody"><h1>${T(site.name)} ${esc(cfg.title)}(초안)</h1>
        <div class="sub">작성일 ${esc(today)} · jbslab /${cfg.tool} 자동 작성 초안 — 검토자 확인 후 사용</div>${out.html}${consHtml}</article>`;
      $('#report').scrollIntoView({ behavior: 'smooth' });
      msg('검토서를 만들고 구역을 저장했습니다.');
    }
    // 워드는 SVG를 못 그리므로 그림으로 바꿔 넣음
    const svgPng = (svgEl, width = 1600) => new Promise(res => {
      const xml = new XMLSerializer().serializeToString(svgEl), img = new Image();
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
      img.onload = () => { const vb = svgEl.viewBox && svgEl.viewBox.baseVal, r = vb && vb.width ? vb.height / vb.width : img.height / img.width; const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * r); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
      img.onerror = () => res(null); img.src = url;
    });
    async function downloadDoc() {
      const clone = $('#docBody').cloneNode(true);
      const live = [...$('#docBody').querySelectorAll('svg')], dead = [...clone.querySelectorAll('svg')];
      for (let i = 0; i < live.length; i++) { const src = await svgPng(live[i]); const im = document.createElement('img'); if (src) { im.src = src; im.width = 620; dead[i].replaceWith(im); } }
      clone.querySelectorAll('img').forEach(im => { if (!im.getAttribute('width')) im.setAttribute('width', '620'); });
      const body = clone.innerHTML;
      const html = `<html><head><meta charset="utf-8"><style>body{font-family:'맑은 고딕',sans-serif;font-size:11pt}h1{text-align:center;font-size:16pt}h2{font-size:12pt;border-bottom:1.5pt solid #000}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:3pt 5pt;font-size:10pt}.sub{text-align:center;color:#555;font-size:9pt}.chk{color:#9a6a10;font-size:9pt}.badge{font-weight:bold}</style></head><body>${body}</body></html>`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + html], { type: 'application/msword' }));
      a.download = `${(site.name || '구역').replace(/[\\/:*?"<>|]/g, '')}_${cfg.title}_초안.doc`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // 이벤트
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.id === 'addRoad') { fromForm(); v().roads.push({ name: '', w: '', level: '' }); renderRoads(); }
      else if (t.classList.contains('rx')) { t.closest('tr').remove(); }
      else if (t.id === 'make') make();
      else if (t.id === 'save') { fromForm(); JbsSite.save(site); fillSel(); msg('구역을 저장했습니다. 다른 검토서 도구에서도 같은 값으로 열립니다.'); }
      else if (t.id === 'newSite') { load(blank()); msg('지도에서 다각형 도구로 구역계를 그리세요.'); }
      else if (t.id === 'delSite') { if (site.id && confirm(`'${site.name}' 구역을 이 브라우저에서 삭제할까요?`)) { JbsSite.remove(site.id); load(blank()); msg('구역을 삭제했습니다.'); } }
      else if (t.id === 'dlDoc') downloadDoc();
      else if (t.id === 'prt') window.print();
      else if (t.dataset && t.dataset.tool && site && site.id) { fromForm(); JbsSite.save(site); }
    });
    $('#siteSel').addEventListener('change', e => {
      const x = e.target.value; if (!x) return;
      if (x.startsWith('s:')) load(JbsSite.get(x.slice(2)));
      else { const s = JbsSite.fromUrban(x.slice(2)); if (s) { load(s); msg(`/urban ${x.slice(2)}안을 가져왔습니다. 세대수 등 계획값은 직접 넣어 주세요.`); } }
    });

    // 시작: 기준표·문장 틀 읽기
    initMap();
    const q = new URLSearchParams(location.search);
    Promise.all([cfg.criteriaUrl, cfg.templatesUrl].map(u => fetch(u + '?v=' + Date.now()).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
      .then(([c, t]) => {
        C = c; Tp = t;
        let first = null;
        if (q.get('urban')) first = JbsSite.fromUrban(q.get('urban'));
        if (!first && q.get('site')) first = JbsSite.get(q.get('site'));
        if (!first) { let cur = ''; try { cur = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { cur = ''; } first = cur ? JbsSite.get(cur) : null; }
        load(first || blank());
      })
      .catch(e => { load(blank()); msg('기준표를 읽지 못했습니다(' + e.message + '). 사이트 주소(www.jbslab.co.kr)나 serve.ps1로 열어 주세요.', true); });
  }

  g.ReviewUI = { start, esc, num, fmt };
})(window);
