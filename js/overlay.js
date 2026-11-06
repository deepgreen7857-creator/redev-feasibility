'use strict';

// 참고 도면(구역도 그림·PDF)을 지도 위에 반투명으로 겹치고, 두 점으로 위치·크기·방향을 맞춤.
// 변환: 도면 픽셀 q → 지도 투영 좌표(줌 Z0 기준) P = s·R(θ)·q + t  (닮음 변환)
//  두 화면이 같이 씀: 사업성 검토(js/map.js MapView, 아래 기본 host)와 /urban(urban.js가 RefOverlay.host를 바꿈)
const RefOverlay = {
  host: {
    map: () => MapView.map,
    ensure: () => { if (!MapView.map) MapView.init(); },
    picking: () => !!MapView.picking,
    stopPicking: () => MapView.setPicking(false),
    ids: { msg: 'refMsg', also: 'pickMsg', align: 'btnRefAlign', toggle: 'btnRefToggle', remove: 'btnRefRemove', opacity: 'refOpacity' },
  },
  el(k) { return document.getElementById(this.host.ids[k]); },
  esc(v) { return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  fmt(n, d = 0) { return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  img: null, W: 0, H: 0, Z0: 20,
  s: 1, th: 0, tx: 0, ty: 0,
  opacity: 0.55, visible: true,
  step: 0, q1: null, P1: null, q2: null, marks: null, bound: false,

  say(t) {
    const m = this.el('msg'); if (!m) return;
    m.innerHTML = t;
    const a = this.el('also'); if (a) a.textContent = m.textContent;   // 전체 화면에서도 보이게 지도 안 알림에도
  },

  pane() {
    const m = this.host.map();
    if (!m.getPane('refPane')) {
      const p = m.createPane('refPane');
      p.style.zIndex = 350;              // 배경지도 위, 필지·구역계 선 아래
      p.style.pointerEvents = 'none';    // 도면 위를 눌러도 지도 그리기·필지 선택이 되게
    }
    return m.getPane('refPane');
  },

  pickFile() {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = 'image/*,.pdf,application/pdf';
      i.onchange = () => res(i.files[0] || null);
      i.click();
    });
  },

  loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
  },

  // PDF 한 쪽을 긴 변 약 3,000px 그림으로
  async pdfToUrl(file, pageNo) {
    if (!window.pdfjsLib) {
      await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    // 여러 쪽 PDF(2026-11-06): 쪽을 고를 수 있게 — 고르지 않았으면 도형(경로)이 가장 많은 쪽(표지·개요표보다 도면 쪽)을 먼저
    this.numPages = pdf.numPages; let pn = +pageNo || 0;
    if (!pn) { pn = 1; if (pdf.numPages > 1) { let best = -1; for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) { try { const ol = await (await pdf.getPage(i)).getOperatorList(); const n = ol.fnArray.filter(f => f === pdfjsLib.OPS.constructPath).length; if (n > best) { best = n; pn = i; } } catch (e) { /* 건너뜀 */ } } } }
    this.pageNo = pn;
    const page = await pdf.getPage(pn);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 3000 / Math.max(v1.width, v1.height) });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    try { this.vec = await this.pdfVectors(pdf, page, vp); } catch (e) { this.vec = null; }   // CAD에서 내보낸 PDF면 폴리선(닫힌 도형)도 읽어 둠
    return new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), 'image/png'));
  },

  // PDF 벡터(폴리선) 읽기 — CAD에서 PDF로 내보낸 도면은 선이 그림이 아니라 좌표로 들어 있음
  //  닫힌 도형(closePath·사각형·처음=끝)만 모아 그림 픽셀 좌표로 바꿔 둠: [{layer, color, pts:[[x,y]...]}]
  //  layer = PDF 레이어(선택적 콘텐츠 OCG) 이름, 없으면 '색 #rrggbb'(채우기 색 우선) — /urban '정비기반시설도'에서 종류를 고름
  async pdfVectors(pdf, page, vp) {
    const OPS = pdfjsLib.OPS, ops = await page.getOperatorList();
    let ocNames = {};
    try { const cfg = await pdf.getOptionalContentConfig(); if (cfg && cfg.getOrder) { const walk = o => (Array.isArray(o) ? o : (o && o.order) || []).forEach(x => { if (typeof x === 'string') { const g = cfg.getGroup(x); if (g) ocNames[x] = g.name; } else walk(x); }); walk(cfg.getOrder()); } if (cfg && cfg._groups) cfg._groups.forEach((g, id) => { ocNames[id] = g.name; }); } catch (e) { /* 레이어 없음 */ }
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const hex = a => { const v = Array.from(a || []); if (typeof v[0] === 'string') return v[0]; const big = v.some(x => x > 1); return '#' + v.slice(0, 3).map(x => Math.round(big ? x : x * 255).toString(16).padStart(2, '0')).join(''); };
    let ctm = [1, 0, 0, 1, 0, 0], fill = '#000000', stroke = '#000000';
    const stack = [], mc = [], out = []; let pend = [];
    const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]), STROKE = new Set([OPS.stroke, OPS.closeStroke]);
    const flush = (sub, closed) => {
      if (sub.length < 3) return;
      const f = sub[0], l = sub[sub.length - 1], same = Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.5;
      if (!(closed || same)) return;
      const m = mul(vp.transform, ctm), pts = (same ? sub.slice(0, -1) : sub).map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      if (pts.length < 3) return;
      const oc = [...mc].reverse().find(x => x);
      pend.push({ oc: oc ? (ocNames[oc] || oc) : '', pts });
    };
    for (let i = 0; i < ops.fnArray.length && out.length < 8000; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === OPS.save) stack.push([ctm, fill, stroke]);
      else if (fn === OPS.restore) { const t = stack.pop(); if (t) [ctm, fill, stroke] = t; }
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.setFillRGBColor) fill = hex(a);
      else if (fn === OPS.setStrokeRGBColor) stroke = hex(a);
      else if (fn === OPS.beginMarkedContentProps) mc.push(a && a[0] === 'OC' && a[1] ? (a[1].id || (typeof a[1] === 'string' ? a[1] : '')) : '');
      else if (fn === OPS.beginMarkedContent) mc.push('');
      else if (fn === OPS.endMarkedContent) mc.pop();
      else if (FILL.has(fn) || STROKE.has(fn) || fn === OPS.endPath) {   // 칠하기 명령: 채우기면 채우기 색, 선만이면 선 색으로 묶음
        if (fn !== OPS.endPath) pend.forEach(p => out.push({ layer: p.oc || `색 ${FILL.has(fn) ? fill : stroke}`, color: FILL.has(fn) ? fill : stroke, pts: p.pts }));
        pend = [];
      }
      else if (fn === OPS.constructPath) {
        const sub = a[0], co = a[1]; let k = 0, cur = [];
        for (const op of sub) {
          if (op === OPS.moveTo) { flush(cur, false); cur = [[co[k], co[k + 1]]]; k += 2; }
          else if (op === OPS.lineTo) { cur.push([co[k], co[k + 1]]); k += 2; }
          else if (op === OPS.curveTo) { cur.push([co[k + 4], co[k + 5]]); k += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur.push([co[k + 2], co[k + 3]]); k += 4; }
          else if (op === OPS.closePath) { flush(cur, true); cur = []; }
          else if (op === OPS.rectangle) { flush(cur, false); const [x, y, w, h] = co.slice(k, k + 4); k += 4; flush([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true); cur = []; }
        }
        flush(cur, false);
      }
    }
    return out;
  },
  // 맞춘 PDF 폴리선을 경위도 Polygon으로 — 두 점 맞추기가 끝난 뒤에만
  vectorsLL() {
    if (!this.vec || !this.vec.length || !this.aligned) return null;
    const m = this.host.map(), c = Math.cos(this.th), sn = Math.sin(this.th);
    const toLL = ([x, y]) => { const P = L.point(this.tx + this.s * (c * x - sn * y), this.ty + this.s * (sn * x + c * y)); const ll = m.unproject(P, this.Z0); return [ll.lng, ll.lat]; };
    return this.vec.map(v => { const ring = v.pts.map(toLL); ring.push(ring[0]); return { layer: v.layer, color: v.color, geom: { type: 'Polygon', coordinates: [ring] } }; });
  },

  async load() {
    const file = await this.pickFile();
    if (file) await this.useFile(file);
  },

  async useFile(file, pageNo) {
    this.host.ensure();
    this.say('도면을 불러오는 중…');
    let url; const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name); this.file = file;
    try { url = isPdf ? await this.pdfToUrl(file, pageNo) : URL.createObjectURL(file); }
    catch (e) { this.say('도면을 열지 못했습니다: ' + e.message); return; }
    const img = new Image();
    try { await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); }
    catch (e) { this.say('그림 파일을 읽지 못했습니다.'); return; }
    const vec = this.vec; this.remove(true); this.vec = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? vec : null; this.aligned = false;
    this.img = img;
    this.W = img.naturalWidth;
    this.H = img.naturalHeight;
    img.className = 'ref-img';
    this.pane().append(img);

    // 처음엔 지금 보이는 화면 가운데에 화면의 80% 크기로
    const m = this.host.map(), b = m.getPixelBounds(), k = Math.pow(2, this.Z0 - m.getZoom());
    this.s = Math.min((b.max.x - b.min.x) * k / this.W, (b.max.y - b.min.y) * k / this.H) * 0.8;
    this.th = 0;
    const c = m.project(m.getCenter(), this.Z0);
    this.tx = c.x - this.s * this.W / 2;
    this.ty = c.y - this.s * this.H / 2;
    if (!this.bound) {
      m.on('zoomstart', () => { if (this.img) this.img.style.visibility = 'hidden'; });
      m.on('zoomend viewreset moveend resize', () => this.render());
      this.bound = true;
    }
    this.visible = true;
    this.render();
    this.refreshUi();
    const pages = isPdf && this.numPages > 1 ? ` <span class="ref-pages">쪽 ${Array.from({ length: Math.min(this.numPages, 20) }, (_, i) => `<button type="button" class="btn ghost sm" data-refpage="${i + 1}"${i + 1 === this.pageNo ? ' aria-pressed="true" style="font-weight:700"' : ''}>${i + 1}</button>`).join('')}</span> — 지금 ${this.pageNo}쪽(도형이 가장 많은 쪽을 먼저 골랐습니다)` : '';
    this.say(`<b>${this.esc(file.name)}</b>를 겹쳤습니다.${pages} 이제 <b>두 점으로 맞추기</b>를 눌러 위치를 맞추세요.`);
    const mg = this.el('msg'); if (mg) mg.querySelectorAll('[data-refpage]').forEach(b => b.onclick = () => this.useFile(this.file, +b.dataset.refpage));
  },
  // 맞춤 값을 직접 넣기(두 점을 계산으로 이미 알 때): 도면 픽셀 q1·q2 ↔ 경위도 ll1·ll2
  alignTo(q1, ll1, q2, ll2) {
    const m = this.host.map(), P1 = m.project(L.latLng(ll1[1], ll1[0]), this.Z0), P2 = m.project(L.latLng(ll2[1], ll2[0]), this.Z0);
    const dqx = q2[0] - q1[0], dqy = q2[1] - q1[1], dPx = P2.x - P1.x, dPy = P2.y - P1.y;
    this.s = Math.hypot(dPx, dPy) / Math.hypot(dqx, dqy); this.th = Math.atan2(dPy, dPx) - Math.atan2(dqy, dqx);
    const c = Math.cos(this.th), sn = Math.sin(this.th);
    this.tx = P1.x - this.s * (c * q1[0] - sn * q1[1]); this.ty = P1.y - this.s * (sn * q1[0] + c * q1[1]);
    this.aligned = true; this.step = 0; this.render(); this.refreshUi();
  },

  render() {
    if (!this.img) return;
    const m = this.host.map(), k = Math.pow(2, m.getZoom() - this.Z0), o = m.getPixelOrigin();
    const a = this.s * Math.cos(this.th) * k, b = this.s * Math.sin(this.th) * k;
    this.img.style.transform = `matrix(${a},${b},${-b},${a},${this.tx * k - o.x},${this.ty * k - o.y})`;
    this.img.style.opacity = this.opacity;
    this.img.style.visibility = this.visible ? 'visible' : 'hidden';
  },

  // 지도 좌표 → 도면 픽셀
  toImage(latlng) {
    const P = this.host.map().project(latlng, this.Z0);
    const dx = P.x - this.tx, dy = P.y - this.ty, c = Math.cos(-this.th), s = Math.sin(-this.th);
    return { x: (c * dx - s * dy) / this.s, y: (s * dx + c * dy) / this.s };
  },

  mark(latlng, color, label) {
    if (!this.marks) this.marks = L.layerGroup().addTo(this.host.map());
    L.circleMarker(latlng, { radius: 7, color, weight: 3, fillOpacity: 0.4 }).bindTooltip(label, { permanent: true, direction: 'right', className: 'ref-tip' }).addTo(this.marks);
  },

  startAlign() {
    if (!this.img) { this.say('먼저 <b>도면 불러오기</b>로 구역도를 겹쳐 주세요.'); return; }
    if (this.host.picking()) this.host.stopPicking();
    if (this.marks) this.marks.clearLayers();
    this.visible = true;
    this.render();
    this.step = 1;
    this.refreshUi();
    this.say('① <b>도면 위</b>에서 알아보기 쉬운 곳(교차로 모서리, 큰 건물 모서리 등)을 누르세요.');
  },

  onClick(e) {
    if (this.step === 1) {
      this.q1 = this.toImage(e.latlng);
      this.mark(e.latlng, '#d40000', '도면 1');
      this.step = 2;
      this.say('② 이제 <b>실제 지도</b>에서 같은 곳을 누르세요. (투명도를 낮추면 지도가 잘 보입니다)');
    } else if (this.step === 2) {
      this.P1 = this.host.map().project(e.latlng, this.Z0);
      this.mark(e.latlng, '#2563eb', '지도 1');
      this.step = 3;
      this.say('③ <b>도면 위</b>에서 첫 점과 <b>멀리 떨어진</b> 두 번째 기준점을 누르세요.');
    } else if (this.step === 3) {
      this.q2 = this.toImage(e.latlng);
      this.mark(e.latlng, '#d40000', '도면 2');
      this.step = 4;
      this.say('④ <b>실제 지도</b>에서 두 번째 기준점과 같은 곳을 누르세요.');
    } else if (this.step === 4) {
      const P2 = this.host.map().project(e.latlng, this.Z0);
      this.mark(e.latlng, '#2563eb', '지도 2');
      const dqx = this.q2.x - this.q1.x, dqy = this.q2.y - this.q1.y;
      const dPx = P2.x - this.P1.x, dPy = P2.y - this.P1.y;
      const lq = Math.hypot(dqx, dqy);
      if (lq < 1) { this.say('두 기준점이 너무 가깝습니다. 다시 <b>두 점으로 맞추기</b>를 눌러 주세요.'); this.step = 0; this.refreshUi(); return; }
      this.s = Math.hypot(dPx, dPy) / lq;
      this.th = Math.atan2(dPy, dPx) - Math.atan2(dqy, dqx);
      const c = Math.cos(this.th), s = Math.sin(this.th);
      this.tx = this.P1.x - this.s * (c * this.q1.x - s * this.q1.y);
      this.ty = this.P1.y - this.s * (s * this.q1.x + c * this.q1.y);
      this.step = 0; this.aligned = true;
      this.render();
      this.refreshUi();
      // 맞춘 도면의 축척 (도면 1px이 몇 m인지)
      const mPerPx = this.s * 40075016.7 * Math.cos(e.latlng.lat * Math.PI / 180) / (256 * Math.pow(2, this.Z0));
      const deg = ((this.th * 180 / Math.PI) % 360 + 360) % 360;
      this.say(`${this.vec && this.vec.length ? `PDF 안 닫힌 도형(폴리선) ${this.fmt(this.vec.length)}개를 읽었습니다 — /urban 정비계획 탭 '기반시설도 올리기'에서 [겹쳐 맞춘 PDF에서 가져오기]로 쓸 수 있습니다. ` : ''}맞췄습니다. 도면 1px ≈ ${this.fmt(mPerPx, 3)}m, 회전 ${this.fmt(deg > 180 ? deg - 360 : deg, 1)}°. 어긋나 보이면 기준점을 바꿔 다시 맞추세요. <b>겹친 도면이 옛 고시 도면이면 그 뒤 분할·합병·지적재조사로 지금 지적도와 경계가 다를 수 있습니다</b> – 지도의 지적선이 최신입니다. 이제 다각형 도구로 빨간 경계를 따라 그리고 <b>그린 구역을 필지에 맞추기</b>를 누르세요.`);
      setTimeout(() => { if (this.marks && this.step === 0) this.marks.clearLayers(); }, 6000);
    }
  },

  setOpacity(v) { this.opacity = v; this.render(); },

  toggle() { this.visible = !this.visible; this.render(); this.refreshUi(); },

  remove(silent) {
    if (this.img) { this.img.remove(); URL.revokeObjectURL(this.img.src); }
    this.img = null; this.vec = null; this.aligned = false;
    this.step = 0;
    if (this.marks) this.marks.clearLayers();
    this.refreshUi();
    if (!silent) this.say('도면을 지웠습니다.');
  },

  refreshUi() {
    const has = !!this.img, set = (k, f) => { const e = this.el(k); if (e) f(e); };
    ['align', 'toggle', 'remove', 'opacity'].forEach(k => set(k, e => { e.disabled = !has; }));
    set('toggle', e => { e.textContent = this.visible ? '도면 숨기기' : '도면 보이기'; });
    set('align', e => e.classList.toggle('on', this.step > 0));
    const m = this.host.map(); if (m) m.getContainer().classList.toggle('picking', this.step > 0 || this.host.picking());
  },
};
