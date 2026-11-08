// /urban 정비계획 화면 코드 11/12 — 구역계 만들기 도구 ZK(지번·조서·필지 맞추기·도면) + 구역계 자르기
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 구역계 만들기 도구 (계산은 ../js/zonekit.js — 사업성 검토와 같은 코드) ===== */
const ZK = {
  picking: false,
  rough: {},   // 안별 '대략 그린 범위' (필지에 맞추기 전 선, 점선으로 비교용)
  opts() { return { fillHoles: $id('zkFill').checked, bridge: $id('zkBridge').checked, edgeRoad: $id('zkEdge').value, threshold: num($id('zkTh').value) || 0.5 }; },
  base() { return $id('zkBase').value.trim(); },
  list() { return $id('zkList').value.split(/[\n,;\t]+/); },
  msg(h) { $id('zkMsg').innerHTML = h; },
  say(t) { $id('zkMsg').textContent = t; if (!$id('zkTools').open) statusMsg(t); },
  ready() {
    if (!LM) return false;
    if (!VWorld.enabled) { this.say('브이월드 인증키가 있어야 합니다.'); return false; }
    if (busy || this.working) { toast('다른 작업을 하는 중입니다. 끝난 뒤 눌러 주세요'); return false; }
    return true;
  },
  setPicking(on) {
    this.picking = on;
    const b = $id('pickBtn'); mtLabel(b, on ? '넣고 빼기 끝내기' : '필지 넣고 빼기'); b.classList.toggle('on', on);
    $id('lmap').classList.toggle('picking', on);
    if (!on && LM) LM.closePopup();
    if (on) toast('지도에서 필지를 누르면 넣을지 뺄지 고를 수 있습니다');
    drawLeaflet();
  },
  // 필지 클릭: 구역 밖이면 넣고, 반 이상 구역 안이면 뺌. 연달아 고를 수 있게 판정은 마지막 클릭 2.5초 뒤에 새로 고침
  async pick(latlng) {
    const id = S.region, R = D.regions[id];
    this.say('필지 정보를 불러오는 중…');
    try {
      const f = await VWorld.parcelAt(latlng.lat, latlng.lng);
      if (!f) { this.say('이 위치에서 필지를 찾지 못했습니다.'); return; }
      const no = splitJibun(f.properties.jibun).no, fa = turf.area(f);
      // 작은 필지는 옆 필지를 잘못 누르기 쉬워서, 먼저 크게 확대해 보여 주고 다시 누르게 함
      if (fa < smallLimit('주거') && LM.getZoom() < 19) {
        LM.fitBounds(L.geoJSON(f).getBounds(), { padding: [80, 80], maxZoom: 21 });
        if (LM.getZoom() < 20) LM.setView(L.geoJSON(f).getBounds().getCenter(), 20);
        const mark = L.geoJSON(f, { style: { color: cssVar('--redline'), weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(LM);
        setTimeout(() => mark.remove(), 6000);
        this.msg(`<b>작은 필지(${esc(no)}, ${ZoneKit.f1(fa)}㎡)라 크게 확대했습니다.</b> 빨간 점선이 맞는 필지면 다시 눌러 주세요.`);
        return;
      }
      // 필지 정보와 함께 '넣기 / 빼기'를 고르게 함 (ZoneUI.choose — 사업성 검토와 같은 창)
      //  비율 대신 면적으로 판단: 구역 밖으로 1㎡ 넘게 나간 필지는 '걸침'으로 보고 넣기(나머지까지 채우기)도 할 수 있게
      const ratio = ZoneKit.inRatio(R.geojson, f), inA = fa * ratio, outA = fa - inA;
      const jm = splitJibun(f.properties.jibun).jimok;
      const full = R.geojson && outA <= 1, none = !R.geojson || inA <= 1;
      const now = !R.geojson ? '구역계가 아직 없습니다' : full ? '지금 구역 안' : none ? '지금 구역 밖'
        : `경계에 걸침 · 구역 안 ${ZoneKit.f1(inA)}㎡ / 밖 ${ZoneKit.f1(outA)}㎡ (${Math.round(ratio * 100)}% 편입)`;
      this.say(`${no} 필지를 골랐습니다. 넣을지 뺄지 선택해 주세요.`);
      const act = await ZoneUI.choose(LM, latlng, f, {
        title: `${no} ${jm} · ${ZoneKit.f1(fa)}㎡`, sub: now, color: cssVar('--accent'),
        canIn: !full, canOut: !none,
        inLabel: !none && !full ? '필지 전체 넣기' : '구역에 넣기', outLabel: !none && !full ? '걸친 부분까지 빼기' : '구역에서 빼기',
      });
      if (!act) { this.say(`${no} 필지: 그대로 두었습니다.`); return; }
      const add = act === 'in';
      const next = ZoneKit.toggle(D.regions[id].geojson, f, add);
      setZoneGeom(id, next, 2500, `${no} 필지 ${add ? '넣기' : '빼기'}`);
      this.say(`${no} 필지를 ${id}안 구역계${add ? '에 넣었습니다' : '에서 뺐습니다'}. 고치기를 멈추면 판정을 새로 고칩니다.`);
      return;

    } catch (e) { this.say('필지 조회에 실패했습니다: ' + e.message); }
  },
  // 고른 필지 → 구역계 (도로 잇기·갇힌 필지·자투리 정리) → 지금 안에 넣고 공부 조회
  async build(found, report, intro) {
    const id = S.region;
    if (!found.size) { this.say('구역에 넣을 필지가 없습니다.'); this.showReport(report); return; }
    const res = await ZoneKit.assemble(found, report, this.opts(), t => this.say(t));
    this.showReport(report);
    setZoneGeom(id, res.merged, 0, intro.replace(/ → $/, '') + '로 구역 만들기');
    fitZone(id);
    this.msg(ZoneKit.summary(report, res.merged, intro) + ' 이어서 필지·건축물을 불러옵니다.');
  },
  async fromJibuns() {
    if (!this.ready()) return;
    if (!ZoneKit.items(this.list()).length) { this.say('지번이 없습니다. 한 줄에 하나씩 넣어 주세요. 예: 387, 388-1, 산12'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요. 예: 인천광역시 미추홀구 용현동'); $id('zkBase').focus(); return; }
    const R = D.regions[S.region];
    if (R.geojson && !confirm(`${R.name} 구역계를 지번 목록의 필지로 바꿀까요?`)) return;
    this.working = true;
    try {
      delete this.rough[S.region];
      const { found, report, count } = await ZoneKit.findByJibuns(this.list(), this.base(), t => this.say(t));
      await this.build(found, report, `지번 ${count}개 → `);
    } catch (e) { this.say('실패했습니다: ' + e.message); } finally { this.working = false; }
  },
  // 제출 토지조서 폐합 검토: 조서 지번만 그대로 합쳐(자동 채우기 없음) 구역계로 두고, 떨어진 덩어리·빠진 필지·틈을 알려 줌
  async closure() {
    if (!this.ready()) return;
    if (!ZoneKit.items(this.list()).length) { this.say('토지조서 지번을 넣거나 "엑셀·CSV에서 지번 읽기"로 조서 파일을 고르세요.'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요. 예: 인천광역시 미추홀구 용현동'); $id('zkBase').focus(); return; }
    const id = S.region, R = D.regions[id];
    if (R.geojson && !confirm(`${R.name} 구역계를 제출 조서의 필지 경계로 바꿔 검토할까요?`)) return;
    this.working = true;
    try {
      delete this.rough[id];
      const { found, report, count } = await ZoneKit.findByJibuns(this.list(), this.base(), t => this.say(t));
      const r = await ZoneKit.closure(found, t => this.say(t));
      if (!r) { this.say('조서 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'); this.showReport(report); return; }
      this.showReport(report);
      if (this.closeLayer) this.closeLayer.remove();
      setZoneGeom(id, r.merged, 0, `제출 조서 ${count}필지로 구역계`);
      fitZone(id);
      this.closeLayer = ZoneUI.closureLayer(LM, r);
      $id('zkMsg').innerHTML = ZoneKit.closureHtml(r, report);
      statusMsg(`${id}안: 제출 조서 폐합 검토 ${r.ok ? '이상 없음' : '— 확인할 곳이 있습니다(아래 목록·지도 빨강/주황/보라)'}`, !r.ok);
    } catch (e) { this.say('실패했습니다: ' + e.message); } finally { this.working = false; }
  },
  async snap() {
    if (!this.ready()) return;
    const id = S.region, R = D.regions[id];
    if (!R.geojson) { this.say('먼저 구역계 그리기로 범위를 대략 그려 주세요.'); return; }
    this.working = true;
    try {
      const rough = JSON.parse(JSON.stringify(R.geojson));
      const r = await ZoneKit.snapPick(rough, this.opts().threshold, t => this.say(t));
      this.rough[id] = rough;
      await this.build(r.found, r.report, `그린 범위에 걸친 필지 ${r.report.length}개 → `);
    } catch (e) { this.say('필지를 불러오지 못했습니다: ' + e.message); } finally { this.working = false; }
  },
  async fromAnchors() {
    if (!this.ready()) return;
    const target = num($id('zkTarget').value);
    if (!ZoneKit.items(this.list()).length || !(target > 0)) { this.say('위치 지번(한 줄에 하나)과 목표 면적(㎡)을 넣어 주세요.'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요.'); return; }
    this.working = true;
    try {
      const a = await ZoneKit.roughFromAnchors(this.list(), this.base(), target, this.opts().threshold, t => this.say(t));
      if (!a.rough) { this.say('위치 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'); return; }
      const r = await ZoneKit.snapPick(a.rough, this.opts().threshold, t => this.say(t));
      this.rough[S.region] = a.rough;
      await this.build(r.found, r.report, `위치 지번 ${a.pts.length}개를 감싼 범위를 ${Math.round(a.d)}m 넓혀 목표 ${ZoneKit.f1(target)}㎡에 맞춤 → `);
      if (a.miss.length) $id('zkMsg').insertAdjacentHTML('beforeend', `<br>못 찾은 지번: ${a.miss.map(esc).join(', ')}`);
    } catch (e) { this.say('실패했습니다: ' + e.message); } finally { this.working = false; }
  },
  // 손으로 그리거나 불러온 구역계가 지적 경계와 많이 어긋나면 알림
  async checkFit(gj, what) {
    const r = await ZoneKit.fit(gj);
    if (!r) return;
    $id('zkTools').open = true;
    this.msg(`<b class="warn">${esc(what)}가 지적도 필지 경계와 맞지 않습니다.</b> 필지를 가로지르는 곳 ${r.cut}필지, 어긋난 면적 약 ${ZoneKit.f1(r.dev)}㎡(구역의 ${r.pct.toFixed(1)}%)`
      + (r.cutList.length ? ` · 예: ${r.cutList.map(esc).join(', ')}` : '') + '. <b>그린 구역을 필지에 맞추기</b>를 누르면 필지 경계로 정리합니다.');
  },
  showReport(report) {
    this.report = report;
    const rows = ZoneKit.reportRows(report);
    if (!rows.length) { $id('zkReport').innerHTML = ''; return; }
    const cls = r => ({ good: 'ok', auto: 'info', warn: 'bad' }[ZoneKit.reportClass(r)] || '');
    $id('zkReport').innerHTML = `<div class="zk-head"><b>필지 대조표</b> ${rows.length}건 <button class="btn ghost sm" type="button" id="zkCopy">표 복사(엑셀 붙여넣기용)</button></div>
      <div class="tscroll"><table><thead><tr><th>입력</th><th>결과</th><th>필지</th><th>지목</th><th class="r">면적㎡</th><th>비고</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.input || '–')}</td><td><span class="pill ${cls(r.result)}">${esc(r.result)}</span></td><td>${esc(r.jibun)}</td><td>${esc(r.jimok)}</td><td class="r">${r.area === '' ? '' : ZoneKit.f1(r.area)}</td><td>${esc(r.note)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $id('zkCopy').onclick = async () => {
      const text = ['입력\t결과\t필지\t지목\t면적(㎡)\t비고', ...rows.map(r => [r.input, r.result, r.jibun, r.jimok, r.area, r.note].join('\t'))].join('\n');
      try { await navigator.clipboard.writeText(text); toast('대조표를 복사했습니다'); } catch (e) { toast('복사가 막혀 있습니다. 표를 직접 선택해 복사해 주세요'); }
    };
  },
  // 파일 → 지번 목록 → 바로 구역 만들기 (읽기 규칙은 js/zonekit.js, 사업성 검토 화면과 같음)
  async readFile(f) {
    this.say(`${f.name} 읽는 중…`);
    let r;
    try { r = await ZoneKit.readJibunFile(f); }
    catch (e) { this.say(`${f.name}을(를) 읽지 못했습니다: ${e.message}`); return; }
    if (!r.list.length) { this.say(`${f.name}${r.sheet ? ` (${r.sheet} 시트)` : ''}에서 지번을 찾지 못했습니다. '지번' 제목이 있는 열이나 지번만 있는 열을 넣어 주세요.`); return; }
    $id('zkList').value = r.list.join('\n');
    const full = ZoneKit.fullBase(r.base, this.base(), '');
    const head = `${f.name}${r.sheet ? ` · ${r.sheet} 시트` : ''} ${r.how}에서 지번 ${r.list.length}개를 읽었습니다${r.skipped ? ` (지번 꼴이 아닌 칸 ${r.skipped}개 제외)` : ''}.`;
    if (!full) {
      if (!this.base() && r.base) $id('zkBase').value = r.base;
      this.say(head + ` 기준 동 주소를 시·구까지 넣고(예: 인천광역시 미추홀구 ${r.base || '용현동'}) 지번으로 구역 만들기를 누르세요. 같은 동 이름이 다른 시에도 있을 수 있어서입니다.`);
      $id('zkBase').focus(); return;
    }
    $id('zkBase').value = full;
    this.say(head + ' 구역계를 만드는 중…');
    await this.fromJibuns();
  },
  toggleFull() {
    const m = $id('mapWrap'); m.classList.toggle('full');
    document.body.style.overflow = m.classList.contains('full') ? 'hidden' : '';
    setTimeout(() => LM && LM.invalidateSize(), 60);
  },
};

/* ===== 구역계 자르기 (계산은 ZoneKit.split — 사업성 검토와 같은 코드) ===== */
const CUT = {
  active: false, pieces: null, layer: null, handler: null,
  start() {
    if (!LM) return;
    const R = D.regions[S.region];
    if (!R.geojson) { toast('먼저 구역계를 그려 주세요'); return; }
    if (drawH || editH) { toast('그리기·고치기를 먼저 마쳐 주세요'); return; }
    if (ZK.picking) ZK.setPicking(false);
    this.active = true; this.pieces = null;
    mtLabel($id('cutBtn'), '자르기 그만두기'); $id('cutBtn').classList.add('on');
    // 필지 꼭짓점·구역 경계에 붙는 선 긋기 (ZoneUI.lineTool — 공통)
    const id = S.region;
    this.handler = ZoneUI.lineTool(LM, {
      color: cssVar('--redline'),
      features: () => {
        const fs = [R.geojson];
        Object.keys(R.inArea || {}).forEach(k => { const p = D.byPnu.get(k); if (p && p.geom) fs.push({ type: 'Feature', properties: {}, geometry: p.geom }); });
        const z = Z.zones[id]; if (z && z.roads) z.roads.edge.forEach(r => fs.push({ type: 'Feature', properties: {}, geometry: r.geom }));
        const nb = this.near[id]; if (nb && nb.key === this.zoneKey(R)) nb.feats.forEach(f => fs.push(f));
        return fs;
      },
      say: t => statusMsg(`${id}안 자르기: ${t}`),
      onDone: line => this.onLine(line),
      onCancel: () => { this.stop(); statusMsg(''); },
    });
    this.loadNear(id);
  },
  // 맞은편 도로 필지까지 붙도록 구역 둘레 60m 안 필지 경계를 불러 둠(안별로 한 번)
  near: {},
  zoneKey(R) { return JSON.stringify(turf.bbox(R.geojson)); },
  async loadNear(id) {
    const R = D.regions[id], key = this.zoneKey(R);
    if (!VWorld.enabled || (this.near[id] && this.near[id].key === key)) return;
    const [x0, y0, x1, y1] = turf.bbox(R.geojson), e = 60 / 88000, n = 60 / 111000;
    try {
      statusMsg(`${id}안 자르기: 맞은편 필지 경계 불러오는 중…`);
      const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 20);
      this.near[id] = { key, feats: fs.map(f => ({ type: 'Feature', properties: {}, geometry: f.geometry })) };
      if (this.active && this.handler && S.region === id) { this.handler.reload(); statusMsg(`${id}안 자르기: 둘레 필지 ${fs.length}개 경계에도 붙습니다. 끝점(□)·중간점(△)·수직점(⊥)·근처점(⧗)`); }
    } catch (er) { if (this.active) statusMsg(`${id}안 자르기: 둘레 필지를 못 불러와 구역 안 필지에만 붙습니다.`, true); }
  },
  stop() {
    this.active = false; this.pieces = null;
    if (this.handler) { try { this.handler.stop(); } catch (e) { /* 무시 */ } this.handler = null; }
    if (this.layer) { this.layer.remove(); this.layer = null; }
    LM && LM.closePopup();
    const b = $id('cutBtn'); if (b) { mtLabel(b, '구역계 자르기'); b.classList.remove('on'); }
  },
  onLine(line) {
    const id = S.region, R = D.regions[id];
    const pieces = ZoneKit.split(R.geojson, line);
    this.handler = null;
    if (!pieces.length) { statusMsg(`${id}안: 선이 구역계를 끝까지 가로지르지 않아 나뉘지 않았습니다. 구역 밖에서 시작해 구역 밖에서 끝나게 그어 주세요.`, true); this.stop(); return; }
    this.pieces = pieces;
    const cols = ['--accent', '--warn', '--ok', '--small', '--old'];
    this.layer = L.featureGroup().addTo(LM);
    pieces.forEach((pc, i) => {
      const col = cssVar(cols[i % cols.length]);
      const lyr = L.geoJSON(pc, { style: { color: col, weight: 2, fillColor: col, fillOpacity: 0.35 } }).addTo(this.layer);
      lyr.bindTooltip(`조각 ${i + 1} · ${fmt(turf.area(pc))}㎡`, { permanent: pieces.length <= 6, direction: 'center', className: 'cut-tip' });
      lyr.on('click', ev => { L.DomEvent.stop(ev); this.choose(pc, i, ev.latlng); });
    });
    statusMsg(`${id}안: ${pieces.length}조각으로 나뉘었습니다. 뺄 조각이나 도로로 지정할 조각을 누르세요.`);
  },
  choose(pc, i, latlng) {
    const id = S.region, A = turf.area(pc);
    const box = document.createElement('div');
    box.className = 'pick-pop';
    box.innerHTML = `<div><b>조각 ${i + 1}</b> · ${ZoneKit.f1(A)}㎡</div>
      <div class="pick-btns" style="flex-direction:column"><button type="button" class="btn sm" data-act="out">이 조각 구역에서 빼기</button><button type="button" class="btn ghost sm" data-act="road">이 조각을 도로(기반시설)로 지정</button><button type="button" class="btn ghost sm" data-act="no">그만두기</button></div>`;
    L.popup({ closeButton: true, maxWidth: 260 }).setLatLng(latlng).setContent(box).openOn(LM);
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act; LM.closePopup();
      if (act === 'no') { this.stop(); statusMsg(''); return; }
      if (act === 'out') {
        const next = ZoneKit.removePiece(D.regions[id].geojson, pc);
        this.stop();
        setZoneGeom(id, next, 0, `구역계 자르기(${ZoneKit.f1(A)}㎡ 빼기)`);
        statusMsg(`${id}안: ${ZoneKit.f1(A)}㎡를 구역에서 뺐습니다. 실행 취소로 되돌릴 수 있습니다.`);
      } else {
        const z = zoneOf(id); z.infra = z.infra || {}; z.infra.manualRoads = z.infra.manualRoads || [];
        z.infra.manualRoads.push(pc.geometry); saveZ(); INFRA.memo = {};
        this.stop();
        if (S.mode !== 'infra') { S.mode = 'infra'; syncMode(); }
        render();
        statusMsg(`${id}안: ${ZoneKit.f1(A)}㎡를 도로(기반시설)로 지정했습니다. 정비계획 탭 기반시설 제안표에 들어갑니다. 지도에서 누르면 지정을 취소합니다.`);
      }
    });
  },
};

