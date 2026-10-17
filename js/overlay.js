'use strict';

// 참고 도면(구역도 그림·PDF)을 지도 위에 반투명으로 겹치고, 두 점으로 위치·크기·방향을 맞춤.
// 변환: 도면 픽셀 q → 지도 투영 좌표(줌 Z0 기준) P = s·R(θ)·q + t  (닮음 변환)
const RefOverlay = {
  img: null, W: 0, H: 0, Z0: 20,
  s: 1, th: 0, tx: 0, ty: 0,
  opacity: 0.55, visible: true,
  step: 0, q1: null, P1: null, q2: null, marks: null, bound: false,

  say(t) {
    $('#refMsg').innerHTML = t;
    $('#pickMsg').textContent = $('#refMsg').textContent;   // 전체 화면에서도 보이게 지도 안 알림에도
  },

  pane() {
    const m = MapView.map;
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

  // PDF 첫 페이지를 긴 변 약 3,000px 그림으로
  async pdfToUrl(file) {
    if (!window.pdfjsLib) {
      await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 3000 / Math.max(v1.width, v1.height) });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), 'image/png'));
  },

  async load() {
    const file = await this.pickFile();
    if (file) await this.useFile(file);
  },

  async useFile(file) {
    if (!MapView.map) MapView.init();
    this.say('도면을 불러오는 중…');
    let url;
    try { url = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await this.pdfToUrl(file) : URL.createObjectURL(file); }
    catch (e) { this.say('도면을 열지 못했습니다: ' + e.message); return; }
    const img = new Image();
    try { await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); }
    catch (e) { this.say('그림 파일을 읽지 못했습니다.'); return; }
    this.remove(true);
    this.img = img;
    this.W = img.naturalWidth;
    this.H = img.naturalHeight;
    img.className = 'ref-img';
    this.pane().append(img);

    // 처음엔 지금 보이는 화면 가운데에 화면의 80% 크기로
    const m = MapView.map, b = m.getPixelBounds(), k = Math.pow(2, this.Z0 - m.getZoom());
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
    this.say(`<b>${esc(file.name)}</b>를 겹쳤습니다. 이제 <b>두 점으로 맞추기</b>를 눌러 위치를 맞추세요.`);
  },

  render() {
    if (!this.img) return;
    const m = MapView.map, k = Math.pow(2, m.getZoom() - this.Z0), o = m.getPixelOrigin();
    const a = this.s * Math.cos(this.th) * k, b = this.s * Math.sin(this.th) * k;
    this.img.style.transform = `matrix(${a},${b},${-b},${a},${this.tx * k - o.x},${this.ty * k - o.y})`;
    this.img.style.opacity = this.opacity;
    this.img.style.visibility = this.visible ? 'visible' : 'hidden';
  },

  // 지도 좌표 → 도면 픽셀
  toImage(latlng) {
    const P = MapView.map.project(latlng, this.Z0);
    const dx = P.x - this.tx, dy = P.y - this.ty, c = Math.cos(-this.th), s = Math.sin(-this.th);
    return { x: (c * dx - s * dy) / this.s, y: (s * dx + c * dy) / this.s };
  },

  mark(latlng, color, label) {
    if (!this.marks) this.marks = L.layerGroup().addTo(MapView.map);
    L.circleMarker(latlng, { radius: 7, color, weight: 3, fillOpacity: 0.4 }).bindTooltip(label, { permanent: true, direction: 'right', className: 'ref-tip' }).addTo(this.marks);
  },

  startAlign() {
    if (!this.img) { this.say('먼저 <b>도면 불러오기</b>로 구역도를 겹쳐 주세요.'); return; }
    if (MapView.picking) MapView.setPicking(false);
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
      this.P1 = MapView.map.project(e.latlng, this.Z0);
      this.mark(e.latlng, '#2563eb', '지도 1');
      this.step = 3;
      this.say('③ <b>도면 위</b>에서 첫 점과 <b>멀리 떨어진</b> 두 번째 기준점을 누르세요.');
    } else if (this.step === 3) {
      this.q2 = this.toImage(e.latlng);
      this.mark(e.latlng, '#d40000', '도면 2');
      this.step = 4;
      this.say('④ <b>실제 지도</b>에서 두 번째 기준점과 같은 곳을 누르세요.');
    } else if (this.step === 4) {
      const P2 = MapView.map.project(e.latlng, this.Z0);
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
      this.step = 0;
      this.render();
      this.refreshUi();
      // 맞춘 도면의 축척 (도면 1px이 몇 m인지)
      const mPerPx = this.s * 40075016.7 * Math.cos(e.latlng.lat * Math.PI / 180) / (256 * Math.pow(2, this.Z0));
      const deg = ((this.th * 180 / Math.PI) % 360 + 360) % 360;
      this.say(`맞췄습니다. 도면 1px ≈ ${fmt(mPerPx, 3)}m, 회전 ${fmt(deg > 180 ? deg - 360 : deg, 1)}°. 어긋나 보이면 기준점을 바꿔 다시 맞추세요. 이제 다각형 도구로 빨간 경계를 따라 그리고 <b>그린 구역을 필지에 맞추기</b>를 누르세요.`);
      setTimeout(() => { if (this.marks && this.step === 0) this.marks.clearLayers(); }, 6000);
    }
  },

  setOpacity(v) { this.opacity = v; this.render(); },

  toggle() { this.visible = !this.visible; this.render(); this.refreshUi(); },

  remove(silent) {
    if (this.img) { this.img.remove(); URL.revokeObjectURL(this.img.src); }
    this.img = null;
    this.step = 0;
    if (this.marks) this.marks.clearLayers();
    this.refreshUi();
    if (!silent) this.say('도면을 지웠습니다.');
  },

  refreshUi() {
    const has = !!this.img;
    $('#btnRefAlign').disabled = !has;
    $('#btnRefToggle').disabled = !has;
    $('#btnRefRemove').disabled = !has;
    $('#refOpacity').disabled = !has;
    $('#btnRefToggle').textContent = this.visible ? '도면 숨기기' : '도면 보이기';
    $('#btnRefAlign').classList.toggle('on', this.step > 0);
    if (MapView.map) MapView.map.getContainer().classList.toggle('picking', this.step > 0 || MapView.picking);
  },
};
