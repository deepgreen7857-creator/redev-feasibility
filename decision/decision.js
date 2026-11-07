/* /decision 정비구역 지정 및 정비계획 결정(안) · 지구단위계획 결정(안) 화면(2026-11-07)
   표 내용은 shared/decision.js(JbsDecision.build)가 만들고, 이 화면은 그리기·칸 고치기(구역별 저장)·도면·인쇄/워드만
   고친 칸: localStorage 'jbs-decision-v1' { [siteId]: { meta:{name,loc,org}, cells:{ 'tableId:r:c': 글 }, extra:{ tableId: 더한 행 수 } } } */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'jbs-decision-v1', D = window.JbsDecision;
  let site = null, built = null;
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const mine = () => (site && all()[site.id]) || { meta: {}, cells: {}, extra: {} };
  const save = m => { if (!site) return; const a = all(); a[site.id] = m; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* 저장 공간 */ } };

  /* ---------- 표 그리기 ---------- */
  function headHtml(cols) {
    const two = cols.some(c => Array.isArray(c));
    const r1 = cols.map(c => Array.isArray(c) ? `<th colspan="${c[1].length}">${esc(c[0])}</th>` : `<th${two ? ' rowspan="2"' : ''}>${esc(c)}</th>`).join('');
    const r2 = two ? cols.filter(Array.isArray).flatMap(c => c[1]).map(x => `<th>${esc(x)}</th>`).join('') : '';
    return `<thead><tr>${r1}</tr>${two ? `<tr>${r2}</tr>` : ''}</thead>`;
  }
  const ncol = cols => cols.reduce((n, c) => n + (Array.isArray(c) ? c[1].length : 1), 0);
  function tableHtml(t, m) {
    const n = ncol(t.cols), extra = (m.extra || {})[t.id] || 0;
    const rows = t.rows.concat(Array.from({ length: extra }, () => Array(n).fill(D.IN)));
    const body = rows.map((r, ri) => `<tr>${Array.from({ length: n }, (_, ci) => {
      const k = `${t.id}:${ri}:${ci}`, has = Object.prototype.hasOwnProperty.call(m.cells || {}, k), v = has ? m.cells[k] : (r[ci] == null ? '' : r[ci]);
      const long = String(v).length > 18;
      return `<td contenteditable="true" data-k="${k}" class="${has ? 'edited' : v === D.IN ? 'need' : ''}${long ? ' l' : ''}">${esc(v)}</td>`; }).join('')}</tr>`).join('');
    const title = t.no ? `${t.no}. ${t.title}` : t.title;
    return `<h3>${esc(title)}</h3><table>${headHtml(t.cols)}<tbody>${body}</tbody></table>${t.note ? `<p class="tnote">※ ${esc(t.note)}</p>` : ''}${t.id === 'consult' || t.id === 'common' || t.id === 'facOther' || t.id === 'dline' || t.id === 'detc' ? `<button class="addrow" data-t="${t.id}">+ 행 더하기</button>` : ''}`;
  }

  /* ---------- 도면(정비구역·토지이용·정비계획·지구단위계획 결정도) ---------- */
  function figSvg(kind) {
    const F = built.F; if (!F.ring) return '<svg viewBox="0 0 100 60"><text x="50" y="30" text-anchor="middle" font-size="5">구역계 없음</text></svg>';
    const pr = F.pr, zone = F.ring.map(pr), ex = ((site.arch || {}).exclude || []).map(q => q.map(pr)), kinds = (site.arch || {}).exKinds || [];
    const blds = ((F.ch || {}).buildings || []).map(b => ({ f: b.floors, parts: (b.parts && b.parts.length ? b.parts : [b.poly]).map(q => q.map(pr)) }));
    const xs = zone.map(p => p[0]), ys = zone.map(p => p[1]), pad = Math.max(10, (Math.max(...xs) - Math.min(...xs)) * 0.08);
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad, W = x1 - x0, H = y1 - y0, u = Math.max(W, H) / 300;
    const P = q => 'M' + q.map(p => `${(p[0] - x0).toFixed(1)},${(y1 - p[1]).toFixed(1)}`).join('L') + 'Z';
    const col = k => (/공원|녹지/.test(k) ? '#7cc58a' : /도로/.test(k) ? '#c4c9cf' : /학교|공공|종교/.test(k) ? '#c9b8e8' : '#b9d3b4');
    let g = '';
    if (kind === 'zone') g += `<path d="${P(zone)}" fill="#fdecea"/>`;
    else g += `<path d="${P(zone)}" fill="${kind === 'land' ? '#f6e7b4' : '#f4f2ec'}"/>`;
    if (kind !== 'zone') ex.forEach((q, i) => { g += `<path d="${P(q)}" fill="${col(kinds[i] || '')}" stroke="#555" stroke-width="${0.3 * u}"/>`; });
    if (kind === 'plan' || kind === 'district') blds.forEach(b => b.parts.forEach(q => { g += `<path d="${P(q)}" fill="#3b4754"/>`; }));
    if (kind === 'plan') blds.forEach(b => { const pts = b.parts.flat(), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length; g += `<text x="${(cx - x0).toFixed(1)}" y="${(y1 - cy + 1.2 * u).toFixed(1)}" font-size="${3.4 * u}" text-anchor="middle" fill="#fff" font-weight="700">${b.f}F</text>`; });
    if (kind === 'district') {
      const sb = +(((site.arch || {}).params || {}).roadSb) || 0;
      if (sb > 0) g += `<path d="${P(inset(zone, sb))}" fill="none" stroke="#d6336c" stroke-width="${0.6 * u}" stroke-dasharray="${3 * u} ${1.5 * u}"/>`;
    }
    g += `<path d="${P(zone)}" fill="none" stroke="${kind === 'district' ? '#1c7ed6' : '#d00'}" stroke-width="${1 * u}" stroke-dasharray="${4 * u} ${2 * u}"/>`;
    const nx = W - 10 * u, ny = 12 * u;
    g += `<path d="M${nx},${ny - 7 * u}L${nx + 3 * u},${ny + 3 * u}L${nx},${ny + 1 * u}L${nx - 3 * u},${ny + 3 * u}Z" fill="#222"/><text x="${nx}" y="${ny - 8.5 * u}" font-size="${4 * u}" text-anchor="middle">N</text>`;
    return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }
  // 볼록·단순 다각형 안쪽으로 d m 평행 이동(건축한계선 개략 표시용)
  function inset(q, d) {
    let a = 0; q.forEach((p, i) => { const r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; }); const s = a > 0 ? 1 : -1, n = q.length - (q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1] ? 1 : 0), Q = q.slice(0, n);
    const L = Q.map((p, i) => { const r = Q[(i + 1) % n], dx = r[0] - p[0], dy = r[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * s, ny = dx / l * s; return [[p[0] + nx * d, p[1] + ny * d], [r[0] + nx * d, r[1] + ny * d]]; });
    return L.map((e, i) => { const f = L[(i + n - 1) % n], x1 = f[0][0], y1 = f[0][1], x2 = f[1][0], y2 = f[1][1], x3 = e[0][0], y3 = e[0][1], x4 = e[1][0], y4 = e[1][1], den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) < 1e-9) return e[0]; const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den; return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]; });
  }

  /* ---------- 문서 ---------- */
  function render() {
    const doc = $('#doc'); if (!site) { doc.innerHTML = '<p class="note">공통 구역이 없습니다. /arch에서 구역을 열고 [이 안으로 확정]을 먼저 누르세요.</p>'; return; }
    const m = mine(), meta = m.meta || {};
    built = D.build(site, { name: meta.name || $('#name').value || '', location: meta.loc || $('#loc').value || D.IN, feas: window.JbsFeas, assume: window.JbsFeas ? JbsFeas.get() : null });
    const F = built.F, org = meta.org || '인천광역시';
    const ttl = `${F.fullName} 정비구역 지정 및 정비계획 결정(안), 지구단위계획구역 지정 및 지구단위계획 결정(안)`;
    let h = `<h1>${esc(ttl)}</h1><p class="gosi">${esc(org)} 고시 제　　　　호 (안)</p>`;
    h += `<p class="lead">「도시 및 주거환경정비법」 제8조 및 제16조에 따라 정비구역을 지정하고 정비계획을 결정하며, 같은 법 제17조 및 「국토의 계획 및 이용에 관한 법률」 제30조·제50조에 따라 지구단위계획구역 지정 및 지구단위계획을 결정하고, 「토지이용규제 기본법」 제8조에 따라 지형도면을 고시합니다.</p>`;
    built.parts.forEach(p => { h += `<h2>${p.no}. ${esc(p.title)}</h2>`; p.tables.forEach(t => { h += tableHtml(t, m); }); });
    h += `<h2>Ⅳ. 관련 도면</h2><div class="figs">${[['zone', '정비구역 결정도'], ['land', '토지이용계획 결정도'], ['plan', '정비계획(건축물 배치) 결정도'], ['district', '지구단위계획 결정도']].map(([k, n]) => `<figure>${figSvg(k)}<figcaption>${n}</figcaption></figure>`).join('')}</div>`;
    h += `<p class="tnote">※ 도면은 개략도이며, 고시용 지형도면은 지적도 위에 작성해야 합니다(토지이용규제 기본법 제8조). 지구단위계획 결정도의 분홍 점선은 건축한계선(개략).</p>`;
    h += `<div class="foot">Ⅴ. 관계 도서 열람: ${esc(org)} 및 관할 구청 정비사업 담당 부서 · 이 문서는 jbslab 정비계획 검토로 만든 초안이며, 계획 내용과 숫자는 인허가 및 심의 과정에서 변동될 수 있습니다.</div>`;
    doc.innerHTML = h;
    const ch = F.ch; $('#siteInfo').textContent = ch ? `확정안: ${ch.label || ''} · ${(+ch.units).toLocaleString('ko-KR')}세대${ch.stageName ? ' · ' + ch.stageName : ''}` : '건축계획 확정안이 없어 건축·분담금 칸이 비어 있습니다(/arch에서 확정).';
  }
  // 칸 고치기
  document.addEventListener('input', e => { const td = e.target.closest && e.target.closest('td[data-k]'); if (!td) return; const m = mine(); m.cells = m.cells || {}; m.cells[td.dataset.k] = td.innerText.trim(); td.classList.add('edited'); td.classList.remove('need'); save(m); });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.addrow'); if (!b) return; const m = mine(); m.extra = m.extra || {}; m.extra[b.dataset.t] = (m.extra[b.dataset.t] || 0) + 1; save(m); render(); });
  ['name', 'loc', 'org'].forEach(id => $('#' + id).addEventListener('change', () => { const m = mine(); m.meta = Object.assign({}, m.meta, { name: $('#name').value.trim(), loc: $('#loc').value.trim(), org: $('#org').value.trim() }); save(m); render(); }));
  $('#reset').addEventListener('click', () => { if (!site || !confirm('이 구역에서 고친 칸과 더한 행을 모두 되돌릴까요? 기본 사항(명칭·위치)은 남깁니다.')) return; const m = mine(); save({ meta: m.meta || {}, cells: {}, extra: {} }); render(); });
  $('#print').addEventListener('click', () => window.print());
  $('#word').addEventListener('click', () => {
    if (!site) return; const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:'맑은 고딕';font-size:10pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:3px;font-size:9pt;text-align:center}th{background:#eef1f4}h1{font-size:15pt;text-align:center}h2{font-size:12.5pt;border-bottom:1.5pt solid #222}h3{font-size:10.5pt}.addrow{display:none}</style></head><body>${$('#doc').innerHTML.replace(/ contenteditable="true"/g, '')}</body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + html], { type: 'application/msword' })); a.download = `${(built.F.fullName || '정비계획').replace(/[\\/:*?"<>|]/g, '')}_정비계획·지구단위계획 결정(안).doc`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  function pick(id) {
    site = id ? JbsSite.get(id) : null;
    const meta = (mine().meta) || {};
    $('#name').value = meta.name || ''; $('#loc').value = meta.loc || ''; $('#org').value = meta.org || '인천광역시';
    if (site) { try { localStorage.setItem('jbs.sites.current', site.id); } catch (e) { /* 무시 */ } }
    render();
  }
  const list = (window.JbsSite ? JbsSite.list() : []).filter(s => D.ringOf(s));
  $('#siteSel').innerHTML = list.length ? list.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${(s.arch || {}).chosen ? ' (확정안)' : ''}</option>`).join('') : '<option value="">공통 구역 없음</option>';
  const q = new URLSearchParams(location.search); let id = q.get('site'); if (!id) { try { id = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { id = ''; } }
  if (!list.find(s => s.id === id)) id = (list[0] || {}).id || '';
  if (id) $('#siteSel').value = id;
  $('#siteSel').addEventListener('change', e => pick(e.target.value));
  pick(id);
})();
