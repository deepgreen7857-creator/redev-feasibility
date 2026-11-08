// /urban 정비계획 화면 코드 5/12 — 기반시설 배치 방식 화면 FITUI(감싸기·이어 붙이기·스케치 — 계산은 placefit.js)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 기반시설 배치 방식 화면 (urban/placefit.js 계산) =====
 z.infra.fit[kind] = { mode: 'auto'|'wrap'|'clean'|'sketch'|'upload', anchor: 'rel'|'park', dir: 'N'|'S'|'E'|'W', sketch: GeoJSON, keepSize, sheet: 용지 meta }
 - 자동: 지금처럼 정사각형 블록을 끌어 옮김(INFRA.block)
 - 감싸기·곧게: 기준 시설(종교용지·공원)과 방향을 고르면 그쪽 빈 땅을 구역 모양대로 채움(모자라면 감싸기/ㄱ자로 이어 붙임)
 - 스케치: 지도에 마우스·손가락으로 대충 그은 모양 → 구역 안 빈 땅으로 자르고 필요 면적에 맞춤
 - 손그림: 스케치 용지(PNG) 내려받기 → 색 펜으로 그리기 → 올리기. 올린 그림 파일은 화면에서 모양만 읽고 어디에도 저장·전송하지 않음 */
const FITUI = {
  KIND: { park: '공원·녹지', school: '학교용지' },
  MODES: [['auto', '자동(끌어 옮기기)'], ['wrap', '감싸기'], ['clean', '깔끔하게(곧게)'], ['sketch', '마우스 스케치'], ['upload', '손그림 올리기']],
  get(key, kind) { const z = Z.zones[key]; return ((z && z.infra && z.infra.fit) || {})[kind] || { mode: 'auto' }; },
  set(kind, f) { const z = Z.zones[S.region]; if (!z) return; z.infra = z.infra || {}; z.infra.fit = z.infra.fit || {}; z.infra.fit[kind] = z.infra.fit[kind] || { mode: 'auto' }; f(z.infra.fit[kind]); saveZ(); INFRA.memo = {}; render(); },
  panel(key, inf) {
    if (!window.PlaceFit) return '';
    const kinds = ['park'].concat(inf.szSchool && inf.szSchool.A > 0 ? ['school'] : []);
    return `<div class="fit-wrap" style="margin-top:10px">` + kinds.map(k => {
      const o = this.get(key, k), m = o.mode || 'auto', fm = (inf.fitMsg || {})[k];
      const anchors = [['edge', '구역 경계'], ['rel', '종교용지']].concat(k === 'school' ? [['park', '공원·녹지']] : []);
      const hasAnc = { edge: true, rel: !!inf.relGeom, park: !!inf.parkGeom };
      let sub = '';
      if (m === 'wrap' || m === 'clean') {
        sub = `<div style="margin-top:6px">기준 시설 <select data-fitanchor="${k}">${anchors.map(([v, t]) => `<option value="${v}" ${(o.anchor || (inf.relGeom ? 'rel' : 'edge')) === v ? 'selected' : ''} ${hasAnc[v] ? '' : 'disabled'}>${t}${hasAnc[v] ? '' : '(없음)'}</option>`).join('')}</select>
          &nbsp;방향 <span class="seg" role="group" aria-label="붙일 방향">${[['N', '북'], ['E', '동'], ['S', '남'], ['W', '서']].map(([d, t]) => `<button type="button" data-fitdir="${k}:${d}" aria-pressed="${(o.dir || 'N') === d}">${t}</button>`).join('')}</span></div>
          <span class="u">${m === 'wrap' ? '그 방향 빈 땅을 구역 모양대로 먼저 채우고, 모자라면 기준 시설 옆으로 감싸 이어 붙입니다.' : '기준 시설 변 폭 그대로 곧은 띠로 붙이고, 막히면 채울 만큼 채운 뒤 옆으로 곧게 꺾습니다(ㄱ자).'}</span>`;
      } else if (m === 'sketch') {
        sub = `<div style="margin-top:6px"><button type="button" class="btn sm" data-fitpoly="${k}">꼭짓점 찍어 그리기(반듯하게)</button>
          <button type="button" class="btn ghost sm" data-fitdraw="${k}">손으로 그리기</button>
          ${o.sketch ? `<button type="button" class="btn ghost sm" data-fitclear="${k}">그린 모양 지우기</button>` : ''}
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitkeep="${k}" ${o.keepSize ? 'checked' : ''}> 그린 크기 그대로(면적 맞추지 않음)</label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitstraight="${k}" ${o.straight !== false ? 'checked' : ''}> 가르는 선은 곧게 펴기</label></div>
          <span class="u"><b>꼭짓점 찍어 그리기</b>: 지도에서 모서리를 차례로 누르고, 첫 점을 다시 누르거나 두 번 눌러 끝냅니다(되돌리기 Backspace, 취소 Esc). 직선으로 이어져 반듯한 모양이 됩니다. <b>점 두 개만 찍고 두 번 누르면</b> 구역을 가르는 곧은 선이 됩니다(선 바깥쪽이 시설). <b>손으로 그리기</b>: 누른 채 한 바퀴(또는 구역을 가로지르는 선 한 줄 — 선 바깥쪽 작은 쪽이 시설). 구역 밖·도로·다른 시설에 걸린 부분은 잘라 내고, 모양은 그대로 둔 채 같은 비율로 키우거나 줄여 필요 면적에 맞춥니다.</span>`;
      } else if (m === 'upload') {
        sub = `<div style="margin-top:6px"><button type="button" class="btn ghost sm" data-fitsheet="${k}">① 스케치 용지 내려받기</button>
          <label class="btn ghost sm" style="cursor:pointer">② 그린 그림 올리기<input type="file" accept="image/*" data-fitupload="${k}" hidden></label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitkeep="${k}" ${o.keepSize ? 'checked' : ''}> 그린 크기 그대로</label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitstraight="${k}" ${o.straight !== false ? 'checked' : ''}> 가르는 선은 곧게 펴기</label></div>
          <span class="u">용지(구역·시설이 회색으로 그려진 그림)를 그림판·휴대폰·태블릿에서 열어 빨강·파랑 같은 색 펜으로 원하는 자리를 그린 뒤 그대로 올리세요. 끝이 덜 닫혀도 됩니다. <b>구역을 가로지르는 선 한 줄</b>만 그으면 그 선 바깥쪽(작은 쪽)을 시설로 씁니다(면적을 맞출 때는 선을 평행으로 옮김, 선 자리 그대로 쓰려면 '그린 크기 그대로'). 자르거나 돌리면 위치가 맞지 않습니다. 종이에 출력해 그린 사진은 아직 안 되고 스캔본은 됩니다. 올린 그림은 모양만 읽고 저장하지 않습니다.${o.sheet ? '' : ' <b>먼저 ①로 용지를 내려받으세요.</b>'}</span>`;
      }
      const msg = m !== 'auto' && fm ? `<div class="${fm.ok ? '' : 'warn'}" style="margin-top:6px"><b>${fm.ok ? '배치 결과' : '확인 필요'}</b> ${esc(fm.msg)}</div>`
        : (m === 'sketch' && !o.sketch) || (m === 'upload' && !o.sketch) ? '<div class="u" style="margin-top:6px">아직 그린 모양이 없어 자동 배치로 보이고 있습니다.</div>' : '';
      return `<div class="fit-box" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin-top:6px"><b>${this.KIND[k]} 배치 방식</b>
        <div class="seg" role="group" aria-label="${this.KIND[k]} 배치 방식" style="margin-top:4px;flex-wrap:wrap">${this.MODES.map(([v, t]) => `<button type="button" data-fitmode="${k}:${v}" aria-pressed="${m === v}">${t}</button>`).join('')}</div>${sub}${msg}</div>`;
    }).join('') + `</div>`;
  },
  bind(side) {
    side.querySelectorAll('[data-fitmode]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.fitmode.split(':'); this.set(k, o => { o.mode = v; if (!o.anchor) o.anchor = (INFRA.memo && Object.values(INFRA.memo).some(x => x && x.relGeom)) ? 'rel' : 'edge'; if (!o.dir) o.dir = 'N'; }); });
    side.querySelectorAll('[data-fitdir]').forEach(b => b.onclick = () => { const [k, d] = b.dataset.fitdir.split(':'); this.set(k, o => { o.dir = d; }); });
    side.querySelectorAll('[data-fitanchor]').forEach(el => el.onchange = () => this.set(el.dataset.fitanchor, o => { o.anchor = el.value; }));
    side.querySelectorAll('[data-fitkeep]').forEach(el => el.onchange = () => this.set(el.dataset.fitkeep, o => { o.keepSize = el.checked; }));
    side.querySelectorAll('[data-fitstraight]').forEach(el => el.onchange = () => this.set(el.dataset.fitstraight, o => { o.straight = el.checked; }));
    side.querySelectorAll('[data-fitdraw]').forEach(b => b.onclick = () => this.draw(b.dataset.fitdraw));
    side.querySelectorAll('[data-fitclear]').forEach(b => b.onclick = () => this.set(b.dataset.fitclear, o => { o.sketch = null; }));
    side.querySelectorAll('[data-fitpoly]').forEach(b => b.onclick = () => this.drawPoly(b.dataset.fitpoly));
    side.querySelectorAll('[data-fitsheet]').forEach(b => b.onclick = () => this.sheet(b.dataset.fitsheet));
    side.querySelectorAll('[data-fitupload]').forEach(el => el.onchange = () => { const f = el.files && el.files[0]; el.value = ''; if (f) this.upload(el.dataset.fitupload, f); });
  },
  // 꼭짓점 찍어 그리기: 누를 때마다 점을 더해 직선으로 이음 → 첫 점 다시 누르기·두 번 누르기·Enter로 끝(반듯한 공원·녹지용)
  drawPoly(kind) {
    if (!LM) return;
    const el = LM.getContainer(); let pts = [], shape = null, guide = null, lastT = 0, downAt = null;
    LM.doubleClickZoom.disable(); el.classList.add('picking');
    toast('모서리를 차례로 누르세요 — 첫 점을 다시 누르거나 두 번 눌러 끝냅니다 (Backspace 되돌리기 · Esc 취소)', 6000);
    const ll = e => LM.mouseEventToLatLng(e);
    const redraw = hover => {
      const all = hover ? pts.concat([hover]) : pts;
      if (shape) shape.remove(); if (guide) guide.remove();
      shape = all.length >= 3 ? L.polygon(all, { color: '#d6336c', weight: 3, fillOpacity: 0.12, interactive: false }).addTo(LM) : L.polyline(all, { color: '#d6336c', weight: 3, interactive: false }).addTo(LM);
      guide = L.layerGroup(pts.map((p, i) => L.circleMarker(p, { radius: i ? 4 : 6, color: '#d6336c', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }))).addTo(LM);
    };
    const end = save => {
      el.removeEventListener('pointerdown', pd, true); el.removeEventListener('pointerup', pu, true); el.removeEventListener('pointermove', pm, true); window.removeEventListener('keydown', kd);
      el.classList.remove('picking'); LM.doubleClickZoom.enable(); if (shape) shape.remove(); if (guide) guide.remove();
      setTimeout(() => { if (this._polyOff) this._polyOff(); }, 0);
      if (save && pts.length >= 3) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'Polygon', coordinates: [[...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]]] }; });
      else if (save && pts.length === 2) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }; });   // 점 두 개 = 곧은 나누는 선
      else if (save) toast('점을 2개(가르는 직선) 또는 3개 이상(모양) 찍어 주세요');
    };
    // 누르고 거의 움직이지 않고 떼면 '점 찍기', 끌면 지도 이동(그대로 둠)
    const pd = e => { if (e.button !== 0) return; downAt = [e.clientX, e.clientY]; e.stopPropagation(); };
    const pu = e => {
      if (!downAt) return; const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
      if (moved > 5) return;
      e.stopPropagation(); e.preventDefault();
      const p = ll(e), now = Date.now();
      if (pts.length >= 3 && LM.latLngToContainerPoint(p).distanceTo(LM.latLngToContainerPoint(pts[0])) < 12) { end(true); return; }
      if (now - lastT < 350 && pts.length >= 2) { end(true); return; }
      lastT = now; pts.push(p); redraw();
    };
    const pm = e => { if (pts.length && !downAt) redraw(ll(e)); };
    const kd = e => { if (e.key === 'Escape') end(false); else if (e.key === 'Enter') end(true); else if (e.key === 'Backspace' && pts.length) { e.preventDefault(); pts.pop(); redraw(); } };
    const ck = e => { e.stopPropagation(); };   // 점 찍는 동안 지도 클릭(필지 넣기 등)이 같이 일어나지 않게
    el.addEventListener('pointerdown', pd, true); el.addEventListener('pointerup', pu, true); el.addEventListener('pointermove', pm, true); el.addEventListener('click', ck, true); window.addEventListener('keydown', kd);
    this._polyOff = () => el.removeEventListener('click', ck, true);
  },
  // 지도에 손으로 긋기(마우스·터치 모두 — pointer 이벤트)
  draw(kind) {
    if (!LM) return;
    const el = LM.getContainer(); let pts = [], line = null, down = false;
    LM.dragging.disable(); el.classList.add('picking'); el.style.touchAction = 'none';
    toast('지도에서 누른 채로 원하는 자리를 한 바퀴 그리세요 — 손을 떼면 끝납니다 (Esc: 취소)', 4000);
    const ll = e => LM.mouseEventToLatLng(e);
    const end = save => {
      el.removeEventListener('pointerdown', pd, true); el.removeEventListener('pointermove', pm, true);
      window.removeEventListener('pointerup', pu, true); window.removeEventListener('pointercancel', pu, true); window.removeEventListener('keydown', kd);
      LM.dragging.enable(); el.classList.remove('picking'); el.style.touchAction = ''; if (line) line.remove();
      if (save && pts.length >= 6) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }; });
      else if (save) toast('너무 짧게 그렸습니다 — 다시 그려 주세요');
    };
    // 한 번 누른 채 그린 한 획만 씀. 손 뗌은 창 전체에서 먼저(capture) 받음 — 지도 프로그램이 중간에 가로채면 획이 끝나지 않고 다음 누름이 새 획이 되던 문제
    const pd = e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); if (down) return; down = true; pts = [ll(e)]; if (line) line.remove(); line = L.polyline(pts, { color: '#d6336c', weight: 3, dashArray: '6 4', interactive: false }).addTo(LM); try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ } };
    const pm = e => { if (!down) return; e.preventDefault(); const p = ll(e), q = pts[pts.length - 1]; if (LM.latLngToContainerPoint(p).distanceTo(LM.latLngToContainerPoint(q)) >= 4) { pts.push(p); line.setLatLngs(pts); } };
    const pu = () => { if (down) { down = false; end(true); } };
    const kd = e => { if (e.key === 'Escape') end(false); };
    el.addEventListener('pointerdown', pd, true); el.addEventListener('pointermove', pm, true);
    window.addEventListener('pointerup', pu, true); window.addEventListener('pointercancel', pu, true); window.addEventListener('keydown', kd);
  },
  // 스케치 용지(PNG) 내려받기 — 구역·도로 확폭·다른 시설을 회색으로
  sheet(kind) {
    const z = Z.zones[S.region]; if (!z) return;
    const inf = INFRA.curInf || {};
    const feats = [['도로', inf.roadGeom], ['종교', inf.relGeom], ['공원', kind !== 'park' && inf.parkGeom], ['학교', kind !== 'school' && inf.schoolGeom]].filter(f => f[1]).map(([name, geom]) => ({ name, geom }));
    const { svg, meta } = PlaceFit.makeSheet({ zone: z.geojson, features: feats });
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = meta.width; c.height = meta.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(b => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `스케치용지_${(z.name || S.region)}_${this.KIND[kind]}.png`.replace(/[\\/:*?"<>|]/g, '_');
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }, 'image/png');
      this.set(kind, o => { o.mode = 'upload'; o.sheet = meta; });
      toast('용지를 내려받았습니다 — 색 펜으로 그린 뒤 ②로 올리세요', 4000);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },
  upload(kind, file) {
    const o = this.get(S.region, kind);
    if (!o.sheet) { toast('먼저 ① 스케치 용지를 내려받아 그 위에 그려 주세요', 4000); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 1600 / img.naturalWidth), w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let r; try { r = PlaceFit.readSheet(cx.getImageData(0, 0, w, h), o.sheet); } catch (er) { r = { shapes: [], msg: '그림을 읽지 못했습니다' }; }
      if (!r.shapes.length && r.lines && r.lines.length) { this.set(kind, oo => { oo.mode = 'upload'; oo.sketch = r.lines[0].geometry; }); toast(r.msg, 5000); return; }
      if (!r.shapes.length) { toast(r.msg, 5000); return; }
      this.set(kind, oo => { oo.mode = 'upload'; oo.sketch = r.shapes[0].geometry; });
      toast(r.shapes.length > 1 ? `그린 모양 ${r.shapes.length}개 중 가장 큰 것을 썼습니다` : '그린 모양을 읽어 배치했습니다', 4000);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('그림 파일을 열지 못했습니다(PNG·JPG를 올려 주세요)'); };
    img.src = url;
  },
};

