/* /panel 판넬·사업 단계별 팸플릿(2026-11-07, 사용자 목록 8·9 'A0 판넬·팸플릿 자료', '사업 단계별 팸플릿 — 설문조사·주민제안·주민설명회·추진위·조합설립·재건축진단')
   공통 구역(JbsSite)의 /arch 확정안(동 모양·층수·세대·평형·주차)·건축 불가 영역(토지이용)·교통·환경·경관 검토 결과를 읽어
   A0 판넬(세로·가로)과 A4 3단 접지 팸플릿(앞·뒤 2쪽)을 실제 크기(mm)로 그림 → 브라우저 인쇄로 PDF
   법정 요건·문안은 shared/criteria/pamphlet.json에만(숫자를 여기 넣지 말 것). 사용자 화면 원칙: 결과와 주요 숫자만 + '인허가 및 심의 과정에서 변동될 수 있습니다' */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 0) => (n == null || !isFinite(+n) ? '-' : (+n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const MM = 96 / 25.4;
  let CR = null, site = null, birdURL = '';
  const SAVE = 'jbs-panel-v1';
  const saved = () => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}'); } catch (e) { return {}; } };
  const store = () => { if (!site) return; const all = saved(); all[site.id] = { title: $('#title').value, subtitle: $('#subtitle').value, contact: $('#contact').value, when: $('#when').value, showFeas: $('#showFeas').checked }; try { localStorage.setItem(SAVE, JSON.stringify(all)); } catch (e) { /* 저장 공간 */ } };

  /* ---------- 구역 자료 ---------- */
  const ringOf = s => { const g = s && s.geojson; const geo = g && (g.geometry || g); if (!geo) return null; return geo.type === 'Polygon' ? geo.coordinates[0] : geo.type === 'MultiPolygon' ? geo.coordinates[0][0] : null; };
  function projector(ring) {
    const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length, lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    return p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
  }
  const areaXY = q => Math.abs(q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]; return a + p[0] * r[1] - r[0] * p[1]; }, 0) / 2);
  const isRecon = s => /recon|재건축/.test(String(((s || {}).v || {}).type || '') + ' ' + String((s || {}).name || ''));
  function facts(s) {
    const ring = ringOf(s), pr = ring ? projector(ring) : null, ch = (s.arch || {}).chosen || null, v = s.v || {};
    const zoneA = ring ? areaXY(ring.map(pr)) : +v.siteArea || null;
    const ex = ((s.arch || {}).exclude || []), kinds = ((s.arch || {}).exKinds || []), land = {};
    if (pr) ex.forEach((q, i) => { const k = kinds[i] || '기반시설'; land[k] = (land[k] || 0) + areaXY(q.map(pr)); });
    const exSum = Object.values(land).reduce((a, b) => a + b, 0);
    return { ring, pr, ch, v, zoneA, land, lot: ch && ch.lot ? ch.lot : (zoneA ? zoneA - exSum : null), exSum };
  }

  /* ---------- 배치도 SVG(경위도 → m, 북쪽 위) ---------- */
  function planSvg(s, F, o) {
    o = o || {};
    if (!F.ring) return `<svg viewBox="0 0 100 60"><text x="50" y="32" text-anchor="middle" font-size="5" fill="#888">구역계가 없습니다</text></svg>`;
    const pr = F.pr, zone = F.ring.map(pr), ex = ((s.arch || {}).exclude || []).map(q => q.map(pr)), kinds = (s.arch || {}).exKinds || [];
    const blds = ((F.ch || {}).buildings || []).map(b => ({ id: b.id, floors: b.floors, parts: (b.parts && b.parts.length ? b.parts : [b.poly]).map(q => q.map(pr)) }));
    const all = zone.concat(...blds.map(b => b.parts.flat()));
    let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
    const pad = Math.max(12, (x1 - x0 + y1 - y0) * 0.07); x0 -= pad; x1 += pad; y0 -= pad * 2.2; y1 += pad;
    const W = x1 - x0, H = y1 - y0, u = Math.max(W, H) / 400, X = x => (x - x0), Y = y => (y1 - y);
    const path = q => 'M' + q.map(p => `${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('L') + 'Z';
    const col = k => (/공원|녹지/.test(k) ? ['#6fbf7e', '#2f7d4a'] : /도로/.test(k) ? ['#c9cdd2', '#6b7280'] : /학교|공공|종교/.test(k) ? ['#c9b8e8', '#6b5aa6'] : ['#b9d3b4', '#5d7f5a']);
    let g = `<path d="${path(zone)}" fill="#f6f4ee" stroke="none"/>`;
    ex.forEach((q, i) => { const [f, st] = col(kinds[i] || ''); g += `<path d="${path(q)}" fill="${f}" stroke="${st}" stroke-width="${0.5 * u}"/>`; });
    blds.forEach(b => {
      b.parts.forEach(q => { g += `<path d="${path(q)}" fill="#3b4754" stroke="#1f2933" stroke-width="${0.35 * u}"/>`; });
      if (o.labels !== false) { const pts = b.parts.flat(), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        g += `<text x="${X(cx).toFixed(1)}" y="${(Y(cy) + 1.6 * u).toFixed(1)}" font-size="${4.4 * u}" text-anchor="middle" fill="#fff" font-weight="700" paint-order="stroke" stroke="#1f2933" stroke-width="${0.8 * u}">${b.floors}층</text>`; }
    });
    g += `<path d="${path(zone)}" fill="none" stroke="#d00" stroke-width="${1.1 * u}" stroke-dasharray="${4 * u} ${2.4 * u}"/>`;
    // 방위표·축척
    const nx = W - 14 * u, ny = 16 * u;
    g += `<g><path d="M${nx},${ny - 9 * u}L${nx + 4 * u},${ny + 4 * u}L${nx},${ny + 1.5 * u}L${nx - 4 * u},${ny + 4 * u}Z" fill="#1f2933"/><text x="${nx}" y="${ny - 11 * u}" font-size="${5 * u}" text-anchor="middle" font-weight="700" fill="#1f2933">N</text></g>`;
    const sb = [10, 20, 50, 100, 200].find(v => v > W * 0.18) || 200, sx = 10 * u, sy = H - 8 * u;
    g += `<g font-size="${6 * u}" fill="#1f2933"><rect x="${sx}" y="${sy}" width="${sb / 2}" height="${2.4 * u}" fill="#1f2933"/><rect x="${sx + sb / 2}" y="${sy}" width="${sb / 2}" height="${2.4 * u}" fill="#fff" stroke="#1f2933" stroke-width="${0.3 * u}"/><text x="${sx}" y="${sy - 2 * u}">0</text><text x="${sx + sb}" y="${sy - 2 * u}" text-anchor="end">${sb}m</text></g>`;
    // 범례
    const lg = [['구역계', 'none', '#d00'], ['건축물', '#3b4754', '#1f2933']].concat([...new Set(kinds)].slice(0, 4).map(k => [k, col(k)[0], col(k)[1]]));
    let lx = sx + sb + 10 * u;
    lg.forEach(([n, f, st]) => { g += `<rect x="${lx}" y="${sy - 3 * u}" width="${8 * u}" height="${5 * u}" fill="${f}" stroke="${st}" stroke-width="${0.4 * u}"${f === 'none' ? ` stroke-dasharray="${1.5 * u} ${1 * u}"` : ''}/><text x="${lx + 10 * u}" y="${sy + 1.4 * u}" font-size="${6 * u}" fill="#1f2933">${esc(n)}</text>`; lx += (n.length * 6.2 + 18) * u; });
    return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }

  /* ---------- 표 ---------- */
  function overviewRows(F) {
    const ch = F.ch, v = F.v, rows = [['구역 면적', F.zoneA ? `${fmt(F.zoneA)}㎡` : '-']];
    { const infra = F.lot && F.zoneA ? F.zoneA - F.lot : F.exSum; if (infra > 1) rows.push(['정비기반시설 등', `${fmt(infra)}㎡ (${fmt(infra / F.zoneA * 100, 1)}%)`]); }
    if (F.lot) rows.push(['획지(건축 대지)', `${fmt(F.lot)}㎡`]);
    if (ch) {
      rows.push(['용적률 / 건폐율', `${fmt(ch.far, 1)}% / ${fmt(ch.bcr, 1)}%`], ['동 수 / 최고 층수', `${fmt((ch.buildings || []).length)}개동 / ${fmt(ch.maxFloors)}층`], ['세대수', `${fmt(ch.units)}세대`]);
      const bt = ch.byType || {}, ks = Object.keys(bt).filter(k => bt[k] > 0).sort((a, b) => a - b);
      if (ks.length) rows.push(['평형별(전용)', ks.map(k => `${k}㎡형 ${fmt(bt[k])}세대`).join(' · ')]);
      if (ch.ex && ch.ex.plan) rows.push(['주차(계획)', `${fmt(ch.ex.plan)}대${ch.ex.legal ? ` (법정 ${fmt(ch.ex.legal)}대)` : ''}`]);
    } else {
      if (v.far) rows.push(['계획 용적률', `${fmt(v.far, 1)}%`]);
      if (v.units) rows.push(['세대수(개략)', `${fmt(v.units)}세대`]);
      rows.push(['건축계획', '확정 전 — /arch에서 [이 안으로 확정]을 누르면 채워집니다']);
    }
    return rows;
  }
  function landRows(F) {
    if (!F.zoneA) return [];
    const rows = Object.entries(F.land).sort((a, b) => b[1] - a[1]).map(([k, a]) => [k, `${fmt(a)}㎡`, `${fmt(a / F.zoneA * 100, 1)}%`]);
    const rest = F.lot ? F.zoneA - F.exSum - F.lot : 0;   // 기반시설을 위치 없이 비율로 잡은 경우(건축계획 기반시설 비율)
    if (rest > F.zoneA * 0.005) rows.push(['정비기반시설 등(비율 가정)', `${fmt(rest)}㎡`, `${fmt(rest / F.zoneA * 100, 1)}%`]);
    if (F.lot) rows.push(['획지(공동주택 등)', `${fmt(F.lot)}㎡`, `${fmt(F.lot / F.zoneA * 100, 1)}%`]);
    rows.push(['합계', `${fmt(F.zoneA)}㎡`, '100%']);
    return rows;
  }
  // 교통·환경·경관 검토에서 계획에 반영한 것(결과만)
  function reviewLines(s) {
    const c = s.constraints || {}, out = [], j = a => (Array.isArray(a) ? a.join(', ') : a);
    if (c.traffic) { const t = c.traffic; out.push(`교통: ${t.진입_가능_도로 && t.진입_가능_도로.length ? `진입 도로 ${esc(j(t.진입_가능_도로))}` : '진입 도로 검토'}${t.확폭_검토_도로 && t.확폭_검토_도로.length ? ` · 진입도로 확폭(${esc(t.확폭_검토_도로.map(r => (r && r.도로) || r).join(', '))}${t.진입도로_필요폭_m ? ` → ${fmt(t.진입도로_필요폭_m, 1)}m` : ''})` : ''}${t.법정_주차대수 ? ` · 법정 주차 ${fmt(t.법정_주차대수)}대` : ''}`); }
    if (c.env) { const e = c.env; out.push(`환경: ${e.소음_검토_도로 && e.소음_검토_도로.length ? `소음 고려 도로 ${esc(j(e.소음_검토_도로))}에서 띄어 배치` : '소음 영향 검토'}${e.북측_일조_높이제한 ? ' · 북측 주거지 일조 고려' : ''}`); }
    if (c.landscape) { const l = c.landscape; out.push(`경관: ${l.통경축_개방률_퍼센트 != null ? `통경축 개방률 ${fmt(l.통경축_개방률_퍼센트, 1)}%` : '높이·통경축 검토'}${(l.경계부_층수_점감_대상동 || []).length ? ' · 구역 경계부 층수 점감' : ''}`); }
    return out;
  }
  const tbl = (rows, cls) => `<table class="${cls || ''}">${rows.map(r => `<tr><th>${esc(r[0])}</th>${r.slice(1).map((x, i) => `<td${i && r.length > 2 ? ' class="n"' : ''}>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
  const reqHtml = st => (st.요건 || []).filter(r => !r.대상 || r.대상 === '공통' || (isRecon(site) ? r.대상 === '재건축' : r.대상 === '재개발')).map(r => `<div class="req"><b>${esc(r.항목)}</b><br>${esc(r.기준)}<br><span class="small">근거: ${esc(r.근거)}${r.상태 !== 'verified' ? ' ※ 기준 확인 필요' : ''}</span></div>`).join('');

  /* ---------- 판넬 ---------- */
  function panelHtml(F, orient) {
    const ttl = esc($('#title').value || site.name || '정비사업'), sub = esc($('#subtitle').value || '정비계획(안)'), contact = esc($('#contact').value);
    const flow = CR.판넬.단계_흐름, curIdx = Math.max(0, flow.findIndex(x => sub.includes(x.slice(0, 4))));
    const flowH = `<div class="flow">${flow.map((x, i) => `${i ? '<i>›</i>' : ''}<span class="${i === curIdx && curIdx > 0 ? 'on' : ''}">${esc(x)}</span>`).join('')}</div>${isRecon(site) ? `<p class="note" style="font-size:6mm;margin:3mm 0 0">${esc(CR.판넬.재건축_추가)}</p>` : ''}`;
    const bird = `<div class="bird">${birdURL ? `<img src="${birdURL}" alt="조감도">` : '조감도 그림이 없습니다 — /arch 조감도 탭에서 [판넬로 보내기]'}</div>`;
    const rv = reviewLines(site), lr = landRows(F);
    const feas = $('#showFeas').checked && site.quick && site.quick.ratio ? `<div class="box"><h3>개략 사업성</h3>${tbl([['비례율(1회차 개략)', `${fmt(site.quick.ratio, 1)}%`]])}<p class="note" style="font-size:5.5mm;margin:2mm 0 0">공사비·분양가 등 가정값으로 계산한 참고값입니다.</p></div>` : '';
    const boxes = `<div class="box"><h3>건축 개요</h3>${tbl(overviewRows(F))}</div>${lr.length > 1 ? `<div class="box"><h3>토지이용계획</h3>${tbl(lr)}</div>` : ''}${rv.length ? `<div class="box"><h3>검토 반영 사항</h3><ul>${rv.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}${feas}`;
    const hd = `<div class="hd"><div><h1>${ttl}</h1><div class="st">${sub}</div></div><div class="mark">jbslab 정비계획 검토<br>${new Date().toLocaleDateString('ko-KR')}</div></div>`;
    const ft = `<div class="ft"><span>${contact ? '문의: ' + contact : ''}</span><span>${esc(CR._meta.공통_안내)}</span></div>`;
    const plan = `<div class="box" style="padding:4mm"><h3 style="margin:2mm 3mm 3mm">배치 계획(개략)</h3><div style="height:calc(100% - 16mm)">${planSvg(site, F)}</div></div>`;
    if (orient === 'P') return `<div class="panel P">${hd}${bird}<div class="row2">${plan}<div class="colR">${boxes}</div></div><div class="box"><h3>사업 추진 단계</h3>${flowH}</div>${ft}</div>`;
    return `<div class="panel L">${hd}<div class="colL">${bird}${plan}</div><div class="colR">${boxes}<div class="box"><h3>사업 추진 단계</h3>${flowH}</div></div>${ft}</div>`;
  }

  /* ---------- 팸플릿(앞: 안쪽 접힘 · 뒷면 · 표지 / 뒤: 안쪽 세 칸) ---------- */
  function pamphletHtml(F, st) {
    const ttl = esc($('#title').value || site.name || '정비사업'), when = esc($('#when').value), contact = esc($('#contact').value);
    const ul = a => `<ul>${(a || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const ov = overviewRows(F).slice(0, 7);
    const cover = `<div class="pn cover"><div><div class="stg">${esc(st.이름)}</div><h1>${ttl}</h1><p class="one">${esc(st.표지_한줄)}</p></div><div>${when ? `<div class="when">${when}</div>` : ''}<p class="mk">jbslab 정비계획 검토 · ${new Date().toLocaleDateString('ko-KR')}</p></div></div>`;
    const back = `<div class="pn"><h2>대상 구역과 개략 계획</h2><div class="plan">${planSvg(site, F, { labels: false })}</div>${tbl(ov)}<p class="warn">${esc(CR._meta.공통_안내)}</p></div>`;
    const flap = `<div class="pn"><h2>다음 단계</h2><p>${esc(st.다음)}</p><h2>사업 추진 단계</h2><ul>${CR.판넬.단계_흐름.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${isRecon(site) ? `<p class="small">${esc(CR.판넬.재건축_추가)}</p>` : ''}<h2>문의</h2><p>${contact || '문의처를 입력하세요'}</p></div>`;
    const in1 = `<div class="pn"><h2>왜 하나요?</h2>${ul(st.왜)}<h2>무엇을 하나요?</h2>${ul(st.무엇)}</div>`;
    let in2, in3;
    if (st.설문) {
      const qs = st.설문.map((q, i) => `<div class="q">${i + 1}. ${esc(q.q)}</div><div class="a">${q.a.map(a => `<span><span class="chk"></span>${esc(a)}</span>`).join('')}</div>`).join('');
      in2 = `<div class="pn survey"><h2>설문지</h2>${qs}</div>`;
      in3 = `<div class="pn"><h2>응답자</h2>${tbl([['소유 지번', ''], ['성명', ''], ['연락처(선택)', '']])}<p class="small">응답 내용은 통계로만 쓰며 개인을 알아볼 수 있게 공개하지 않습니다.</p><h2>자주 묻는 질문</h2><div class="qa">${(st.묻고답하기 || []).map(([q, a]) => `<p class="q">Q. ${esc(q)}</p><p>${esc(a)}</p>`).join('')}</div></div>`;
    } else {
      in2 = `<div class="pn"><h2>법에서 정한 요건</h2>${reqHtml(st)}</div>`;
      in3 = `<div class="pn"><h2>준비하실 것</h2>${ul(st.준비)}<h2>자주 묻는 질문</h2><div class="qa">${(st.묻고답하기 || []).map(([q, a]) => `<p class="q">Q. ${esc(q)}</p><p>${esc(a)}</p>`).join('')}</div><p class="warn">${esc(CR._meta.공통_안내)} 법령 내용은 개정될 수 있으니 구청에 확인하십시오.</p></div>`;
    }
    return [`<div class="pam">${flap}${back}${cover}</div>`, `<div class="pam">${in1}${in2}${in3}</div>`];
  }

  /* ---------- 그리기·미리보기 ---------- */
  function render() {
    const box = $('#sheets'); if (!CR || !site) { box.innerHTML = '<p class="note">구역을 고르세요. 공통 구역이 없으면 /arch에서 구역을 열고 [이 안으로 확정]을 먼저 누르세요.</p>'; return; }
    const F = facts(site), k = $('#kind').value; let sheets, size;
    if (k === 'panelP' || k === 'panelL') { sheets = [panelHtml(F, k === 'panelP' ? 'P' : 'L')]; size = k === 'panelP' ? [841, 1189] : [1189, 841]; $('#pageSize').textContent = `@page{size:${size[0]}mm ${size[1]}mm;margin:0}`; }
    else { const st = CR.stages.find(s => s.id === k); sheets = pamphletHtml(F, st); size = [297, 210]; $('#pageSize').textContent = '@page{size:297mm 210mm;margin:0}'; }
    const avail = Math.max(300, $('.stage').clientWidth - 40), sc = Math.min(1, avail / (size[0] * MM));
    box.innerHTML = sheets.map(h => `<div class="wrapS" style="width:${size[0] * MM * sc}px;height:${size[1] * MM * sc}px"><div class="sheet" style="width:${size[0]}mm;height:${size[1]}mm;transform:scale(${sc})">${h}</div></div>`).join('');
    const ch = (site.arch || {}).chosen;
    $('#siteInfo').textContent = ch ? `확정안: ${ch.label || ''} · ${fmt(ch.units)}세대 · ${(ch.buildings || []).length}개동${ch.stageName ? ' · ' + ch.stageName : ''}` : '건축계획 확정안이 없습니다 — 배치도·건축 개요가 비어 있습니다(/arch에서 확정).';
  }
  function pickSite(id) {
    site = id ? JbsSite.get(id) : null; if (!site) { render(); return; }
    const sv = saved()[site.id] || {}, recon = isRecon(site);
    $('#title').value = sv.title || `${site.name || ''}${site.name && !/정비사업|재개발|재건축/.test(site.name) ? (recon ? ' 주택재건축 정비사업' : ' 주택재개발 정비사업') : ''}`;
    $('#subtitle').value = sv.subtitle || '정비계획(안)'; $('#contact').value = sv.contact || ''; $('#when').value = sv.when || ''; $('#showFeas').checked = !!sv.showFeas;
    try { localStorage.setItem('jbs.sites.current', site.id); } catch (e) { /* 무시 */ }
    if (birdURL) { URL.revokeObjectURL(birdURL); birdURL = ''; }
    render();
    // /arch [판넬로 보내기]로 보낸 조감도(이 브라우저 IndexedDB)
    if (window.JbsPanelImg) { const id0 = site.id; JbsPanelImg.get(id0).then(r => { if (r && r.blob && site && site.id === id0 && !birdURL) { birdURL = URL.createObjectURL(r.blob); render(); } }); }
  }
  function init() {
    const list = (typeof JbsSite !== 'undefined' ? JbsSite.list() : []).filter(s => ringOf(s));
    $('#siteSel').innerHTML = list.length ? list.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${(s.arch || {}).chosen ? ' (확정안)' : ''}</option>`).join('') : '<option value="">공통 구역 없음</option>';
    $('#stageOpts').innerHTML = CR.stages.map(s => `<option value="${s.id}">${esc(s.이름)}${s.대상 === '재건축' ? ' (재건축)' : ''}</option>`).join('');
    const q = new URLSearchParams(location.search); let id = q.get('site'); if (!id) { try { id = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { id = ''; } }
    if (!list.find(s => s.id === id)) id = (list[0] || {}).id || '';
    if (id) $('#siteSel').value = id;
    if (q.get('kind')) $('#kind').value = q.get('kind');
    pickSite(id);
  }
  ['#title', '#subtitle', '#contact', '#when'].forEach(s => $(s).addEventListener('input', () => { store(); render(); }));
  $('#showFeas').addEventListener('change', () => { store(); render(); });
  $('#kind').addEventListener('change', render);
  $('#siteSel').addEventListener('change', e => pickSite(e.target.value));
  $('#birdFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (!f) return; if (birdURL) URL.revokeObjectURL(birdURL); birdURL = URL.createObjectURL(f); render(); });
  $('#print').addEventListener('click', () => window.print());
  window.addEventListener('resize', () => { clearTimeout(window.__pr); window.__pr = setTimeout(render, 150); });
  fetch('../shared/criteria/pamphlet.json?v=' + Date.now()).then(r => r.json()).then(j => { CR = j; init(); }).catch(e => { $('#sheets').textContent = '기준표(pamphlet.json)를 읽지 못했습니다: ' + e.message; });
})();
