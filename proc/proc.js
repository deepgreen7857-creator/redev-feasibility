/* /proc 정비구역 지정 절차 서류 화면(2026-11-08) — 문서 내용은 shared/proc.js(JbsProc.docs)
   저장: localStorage 'jbs-proc-v1' { [siteId]: { m:{입력값}, edits:{ 문서id: 고친 HTML } } } — 고친 문서는 다시 계산하지 않음(되돌리기 전까지) */
(() => {
  const $ = s => document.querySelector(s), P = window.JbsProc, KEY = 'jbs-proc-v1';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let site = null, R = null;
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const mine = () => (site && all()[site.id]) || { m: {}, edits: {} };
  const save = x => { if (!site) return; const a = all(); a[site.id] = x; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* 저장 공간 */ } };
  const TXT = ['name', 'loc', 'proposer', 'council', 'designator', 'dept', 'tel', 'place', 'briefPlace', 'briefTime', 'gosiNo', 'docNo', 'open', 'days', 'notice', 'brief', 'consult', 'apply', 'committee', 'gosi'];
  const decMeta = () => { try { return ((JSON.parse(localStorage.getItem('jbs-decision-v1') || '{}')[site.id] || {}).meta) || {}; } catch (e) { return {}; } };
  function input() {   // 화면 칸 → JbsProc 입력(의회 통지일 칸 id는 council_d → councilDate)
    const m = Object.assign({}, mine().m), d = decMeta();
    if (!m.name) m.name = d.name || ''; if (!m.loc) m.loc = d.loc || '';
    m.councilDate = m.council_d || ''; m.hol = String(m.hol || '').split(/\s+/).filter(Boolean);
    return m;
  }
  function render() {
    const box = $('#docs');
    if (!site) { box.innerHTML = '<p class="note">공통 구역이 없습니다. /arch에서 구역을 열고 [이 안으로 확정]을 먼저 누르세요.</p>'; $('#docTabs').innerHTML = ''; return; }
    const x = mine(); R = P.docs(site, input(), window.JbsDecision, window.JbsFeas);
    box.innerHTML = R.list.map(d => { const ed = (x.edits || {})[d.id];
      return `<section class="pdoc${ed ? ' edited' : ''}" id="d-${d.id}"><div class="bar">${esc(d.title)}${ed ? ' · 고친 문서 <button data-undo="' + d.id + '">자동으로 되돌리기</button>' : ''}</div><div class="body" contenteditable="true" data-id="${d.id}">${ed || d.html}</div></section>`; }).join('');
    $('#docTabs').innerHTML = R.list.map(d => `<a href="#d-${d.id}">${esc(d.title)}</a>`).join('');
    const ch = (site.arch || {}).chosen; $('#siteInfo').textContent = (R.S.ok ? `서면 통보 ${P.ds(R.S.notice)} → 고시 ${P.ds(R.S.gosi)} (약 ${R.S.total}일)` : '공람 시작일을 넣으세요.') + (ch ? ` · 확정안 ${(+ch.units || 0).toLocaleString('ko-KR')}세대` : ' · 건축계획 확정안 없음');
  }
  document.addEventListener('input', e => { const b = e.target.closest && e.target.closest('.body[data-id]'); if (!b) return; const x = mine(); x.edits = x.edits || {}; x.edits[b.dataset.id] = b.innerHTML; save(x); b.parentElement.classList.add('edited'); });
  document.addEventListener('click', e => { const u = e.target.closest && e.target.closest('[data-undo]'); if (!u) return; const x = mine(); delete (x.edits || {})[u.dataset.undo]; save(x); render(); });
  TXT.concat(['council_d', 'hol']).forEach(id => { const el = $('#' + id); if (el) el.addEventListener('change', () => { const x = mine(); x.m = x.m || {}; x.m[id] = el.value.trim(); save(x); render(); }); });
  $('#reset').addEventListener('click', () => { if (!site || !confirm('이 구역에서 고친 문서를 모두 자동 내용으로 되돌릴까요? 입력한 기관·일정은 남깁니다.')) return; const x = mine(); x.edits = {}; save(x); render(); });
  $('#print').addEventListener('click', () => window.print());
  $('#word').addEventListener('click', () => {
    if (!site || !R) return; const body = [...document.querySelectorAll('.pdoc .body')].map(b => b.innerHTML).join('<br style="page-break-before:always">');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:'맑은 고딕';font-size:10.5pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:3px 5px;text-align:center}h1{text-align:center;font-size:15pt}.sign{text-align:center}.need{background:#fff3bf}</style></head><body>${body}</body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + html], { type: 'application/msword' })); a.download = `${(R.zoneName || '정비구역').replace(/[\\/:*?"<>|]/g, '')}_지정 절차 서류.doc`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  function pick(id) {
    site = id ? JbsSite.get(id) : null;
    if (site) { try { localStorage.setItem('jbs.sites.current', site.id); } catch (e) { /* 무시 */ } const m = mine().m || {}, d = decMeta();
      TXT.concat(['council_d', 'hol']).forEach(k => { const el = $('#' + k); if (el) el.value = m[k] != null ? m[k] : (k === 'name' ? (d.name || '') : k === 'loc' ? (d.loc || '') : k === 'days' ? '30' : ''); }); }
    render();
  }
  const list = (window.JbsSite ? JbsSite.list() : []).filter(s => JbsDecision.ringOf(s));
  $('#siteSel').innerHTML = list.length ? list.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${(s.arch || {}).chosen ? ' (확정안)' : ''}</option>`).join('') : '<option value="">공통 구역 없음</option>';
  const qs = new URLSearchParams(location.search); let id = qs.get('site'); if (!id) { try { id = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { id = ''; } }
  if (!list.find(s => s.id === id)) id = (list[0] || {}).id || '';
  if (id) $('#siteSel').value = id;
  $('#siteSel').addEventListener('change', e => pick(e.target.value));
  pick(id);
})();
