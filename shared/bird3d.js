'use strict';
// 조감도·투시도 그리기(개략, 2판 2026-11-07) — three.js r128 + turf 6.5 (+ 있으면 EffectComposer·UnrealBloomPass·ShaderPass·CopyShader·LuminosityHighPassShader)
// JbsBird.render(el, data, opt)
//  data = { aerialFar(같은 꼴, 넓은 범위 바탕), site:[[x,y]..], blds:[{ring:[[x,y]..], floors, top}], labels:[{label,c:[x,y],top}], parks:[ring..], ctx:[{poly,floors}], roads:[ring..], aerial:{img, x0,y0,x1,y1} }
//  opt  = { look:'dusk'|'day', mode:'model'(주변 낮춤)|'review'(주변 실제 높이), view:'wide'|'semi'|'bird'|'persp', w, h, pr, labels }
// 좌표: x 동, y 북(m). three는 (x, 높이, -y)
(function (g) {
  const FH = 2.9, Z00 = 1.5;
  let rnd = Math.random;
  const seed = s => { rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

  /* ---------- 입면 그림(한 장에 4칸 × 4층) ---------- */
  // kind: 'front'(거실·발코니 면), 'side'(측벽 — 색 띠), 'base'(저층 석재), 'crown'(꼭대기 2층)
  function facade(kind, accent, lit) {
    const BW = 64, BH = 56, NB = 4, NF = 4;
    const [c, x] = cv(BW * NB, BH * NF), [e, y] = cv(BW * NB, BH * NF);
    y.fillStyle = '#000'; y.fillRect(0, 0, e.width, e.height);
    if (kind === 'side') {
      x.fillStyle = '#e9e6df'; x.fillRect(0, 0, c.width, c.height);
      // 세로 색 띠(동마다 포인트 색)
      x.fillStyle = accent; x.fillRect(c.width * 0.36, 0, c.width * 0.28, c.height);
      x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(c.width * 0.36, 0, 6, c.height);
      for (let f = 0; f < NF; f++) { // 측창
        x.fillStyle = '#4a5866'; x.fillRect(c.width * 0.12, f * BH + 16, 18, 26); x.fillRect(c.width * 0.8, f * BH + 16, 18, 26);
        if (rnd() < lit * 0.6) { y.fillStyle = '#ffcf8a'; y.fillRect(c.width * 0.12, f * BH + 16, 18, 26); }
      }
      for (let f = 0; f <= NF; f++) { x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(0, f * BH - 1, c.width, 2); }
      return [c, e];
    }
    if (kind === 'base') {
      x.fillStyle = '#b9ad98'; x.fillRect(0, 0, c.width, c.height);
      for (let r = 0; r < 16; r++) for (let k = 0; k < 8; k++) { x.fillStyle = `rgba(${90 + rnd() * 40},${80 + rnd() * 30},${60 + rnd() * 30},.18)`; x.fillRect(k * 32 + (r % 2) * 16, r * 14, 31, 13); }
      for (let b = 0; b < NB; b++) { x.fillStyle = '#3d4650'; x.fillRect(b * BW + 10, 10, BW - 20, c.height - 20); y.fillStyle = rnd() < 0.7 ? '#ffd9a0' : '#000'; y.fillRect(b * BW + 10, 10, BW - 20, c.height - 20); }
      return [c, e];
    }
    // front / crown
    x.fillStyle = kind === 'crown' ? '#f6f4ef' : '#efece6'; x.fillRect(0, 0, c.width, c.height);
    for (let f = 0; f < NF; f++) for (let b = 0; b < NB; b++) {
      const X = b * BW, Y = f * BH;
      // 유리(하늘 반사)
      const gr = x.createLinearGradient(0, Y + 6, 0, Y + 44); gr.addColorStop(0, '#8fa7bd'); gr.addColorStop(1, '#3c4c5c');
      x.fillStyle = gr; x.fillRect(X + 4, Y + 6, BW - 8, 38);
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(X + 6, Y + 8, (BW - 8) * 0.35, 14);
      x.fillStyle = '#dcd8d0'; x.fillRect(X + BW / 2 - 1, Y + 6, 2, 38); // 창틀
      // 발코니 난간 유리 + 슬래브 띠
      x.fillStyle = 'rgba(205,220,228,.45)'; x.fillRect(X + 2, Y + 30, BW - 4, 14);
      x.fillStyle = '#d6d1c7'; x.fillRect(X, Y + 46, BW, 10);
      // 켜진 창(따뜻한 불빛), 일부는 커튼 친 듯 약하게
      const r = rnd();
      if (r < lit) { y.fillStyle = r < lit * 0.35 ? '#ffe2b0' : '#f2a95a'; y.fillRect(X + 4, Y + 6, BW - 8, 38); y.fillStyle = 'rgba(0,0,0,.35)'; y.fillRect(X + 4, Y + 30, BW - 8, 14); }
    }
    for (let b = 0; b <= NB; b++) { x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(b * BW - 1, 0, 2, c.height); } // 세대 경계 세로줄
    if (kind === 'crown') { y.fillStyle = '#fff3d6'; y.fillRect(0, 0, c.width, 5); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, 5); }
    return [c, e];
  }
  function tex(canvas, rx, ry, srgb = true) {
    const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
    if (srgb) t.encoding = THREE.sRGBEncoding; return t;
  }

  /* ---------- 나무 그림(사진풍 2D, 위에서 비스듬히 보는 조감도용) ---------- */
  // type: round(활엽), tall(가로수·느티), cone(침엽), flower(벚꽃), bush(관목)
  function treeCanvas(type) {
    const W = 256, H = type === 'bush' ? 128 : 256; const [c, x] = cv(W, H);
    const cx0 = W / 2, base = H - 6;
    const pal = { round: ['#2e4a22', '#4f7a34', '#86ad55'], tall: ['#2a4420', '#4b7331', '#7da24c'], cone: ['#1f3a22', '#35573a', '#5d7f52'], flower: ['#b98a95', '#e7b9c4', '#fbe6ea'], bush: ['#2f4b24', '#4e7a35', '#8ab25a'] }[type];
    // 줄기
    if (type !== 'bush') { x.strokeStyle = '#4a3a2c'; x.lineWidth = 7; x.beginPath(); x.moveTo(cx0, base); x.lineTo(cx0, H * 0.55); x.stroke(); x.lineWidth = 3; x.beginPath(); x.moveTo(cx0, H * 0.62); x.lineTo(cx0 - 22, H * 0.45); x.moveTo(cx0, H * 0.6); x.lineTo(cx0 + 20, H * 0.42); x.stroke(); }
    // 잎 덩어리 모양 안에 작은 잎 뭉치를 여러 겹
    const inside = (px, py) => {
      if (type === 'cone') { const t = (py - H * 0.06) / (H * 0.78); return t > 0 && t < 1 && Math.abs(px - cx0) < 14 + t * 78; }
      if (type === 'tall') { const dx = (px - cx0) / 78, dy = (py - H * 0.4) / 98; return dx * dx + dy * dy < 1; }
      if (type === 'bush') { const dx = (px - cx0) / 118, dy = (py - H * 0.6) / 52; return dx * dx + dy * dy < 1; }
      const dx = (px - cx0) / 104, dy = (py - H * 0.42) / 92; return dx * dx + dy * dy < 1;
    };
    const N = type === 'bush' ? 520 : 900;
    for (let i = 0; i < N; i++) {
      const px = rnd() * W, py = rnd() * H; if (!inside(px, py)) continue;
      // 빛: 왼쪽 위가 밝고 오른쪽 아래가 어두움 + 얼룩
      const lx = (cx0 - px) / W + (H * 0.3 - py) / H + (rnd() - .5) * 0.7;
      const k = lx > 0.25 ? 2 : lx > -0.2 ? 1 : 0;
      const r = (type === 'bush' ? 4 : 5) + rnd() * (type === 'cone' ? 7 : 11);
      x.globalAlpha = 0.85; x.fillStyle = pal[k]; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      if (rnd() < 0.25) { x.globalAlpha = 0.5; x.fillStyle = pal[Math.min(2, k + 1)]; x.beginPath(); x.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, Math.PI * 2); x.fill(); }
    }
    // 잎 사이 그늘 점
    x.globalAlpha = 0.35; x.fillStyle = '#132010';
    for (let i = 0; i < 160; i++) { const px = rnd() * W, py = rnd() * H; if (inside(px, py) && rnd() < 0.6) { x.beginPath(); x.arc(px, py, 1.5 + rnd() * 3, 0, Math.PI * 2); x.fill(); } }
    x.globalAlpha = 1;
    return c;
  }

  /* ---------- 하늘 ---------- */
  function skyCanvas(look) {
    const [c, x] = cv(1024, 512);
    const gr = x.createLinearGradient(0, 0, 0, 512);
    if (look === 'dusk') { gr.addColorStop(0, '#16244a'); gr.addColorStop(0.42, '#2f4c80'); gr.addColorStop(0.62, '#6f86ad'); gr.addColorStop(0.73, '#b9a7a0'); gr.addColorStop(0.78, '#eab07a'); gr.addColorStop(0.81, '#f6cf98'); gr.addColorStop(1, '#6b5a48'); } // 하늘 구가 천정~0.62π라 지평선 ≈ 0.81
    else { gr.addColorStop(0, '#3f78bd'); gr.addColorStop(0.58, '#8fb9e2'); gr.addColorStop(0.76, '#cfe0ec'); gr.addColorStop(0.81, '#eef3f4'); gr.addColorStop(1, '#c9c9c2'); }
    x.fillStyle = gr; x.fillRect(0, 0, 1024, 512);
    // 구름(흐린 타원 여러 겹)
    for (let i = 0; i < 38; i++) {
      const cx = rnd() * 1024, cy = 250 + rnd() * 160, rw = 80 + rnd() * 220, rh = 7 + rnd() * 14;
      const gg = x.createRadialGradient(cx, cy, 0, cx, cy, rw);
      const lightUnder = look === 'dusk' ? `rgba(255,${170 + rnd() * 50},${110 + rnd() * 40},` : 'rgba(255,255,255,';
      const dark = look === 'dusk' ? 'rgba(70,80,110,' : 'rgba(255,255,255,';
      const col = cy > 370 ? lightUnder : (rnd() < 0.5 ? lightUnder : dark);
      gg.addColorStop(0, col + (0.12 + rnd() * 0.14) + ')'); gg.addColorStop(1, col + '0)');
      x.save(); x.translate(cx, cy); x.scale(1, rh / rw); x.translate(-cx, -cy); x.fillStyle = gg; x.beginPath(); x.arc(cx, cy, rw, 0, Math.PI * 2); x.fill(); x.restore();
    }
    return c;
  }

  /* ---------- 본 함수 ---------- */
  function render(el, data, opt) {
    seed(11);
    opt = Object.assign({ look: 'dusk', mode: 'model', view: 'bird', w: 1600, h: 1000, pr: 1, labels: false }, opt || {});
    const dusk = opt.look === 'dusk';
    const W = opt.w, H = opt.h;
    if (g.__jbsBirdR) { try { g.__jbsBirdR.dispose(); } catch (e) { /* 무시 */ } }
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); g.__jbsBirdR = renderer;
    renderer.setPixelRatio(opt.pr); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = dusk ? 0.95 : 0.82;
    renderer.physicallyCorrectLights = false;
    el.innerHTML = ''; el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();

    const clean = r => { const o = []; (r || []).forEach(p => { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) o.push(p); }); while (o.length > 3 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.3) o.pop(); return o; };
    const D = Object.assign({}, data, { site: clean(data.site), parks: (data.parks || []).map(clean), blds: (data.blds || []).map(b => Object.assign({}, b, { ring: clean(b.ring) })) });
    const S = D.site, xs = S.map(p => p[0]), ys = S.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const V = (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]);
    const tp = ring => turf.polygon([[...ring, ring[0]]]);
    const K = 111320, deg = r => [...r, r[0]].map(p => [p[0] / K, p[1] / K]);
    const mBuf = (ring, m) => { try { const f = turf.buffer(turf.polygon([deg(ring)]), m / 1000, { units: 'kilometers' }); if (!f) return null; const g2 = f.geometry; const c = g2.type === 'Polygon' ? g2.coordinates[0] : g2.coordinates.sort((a, b) => b[0].length - a[0].length)[0][0]; return c.slice(0, -1).map(p => [p[0] * K, p[1] * K]); } catch (e) { return null; } };
    const inPoly = (x, y, f) => turf.booleanPointInPolygon([x, y], f);
    const siteF = tp(S);
    // 모형 받침: 모형 모드에서는 단지 바닥을 경계를 따라 LIFT만큼 들어 올림(구역 경계가 보이고 단지가 도드라지게)
    const LIFT = opt.mode === 'model' ? (opt.lift != null ? opt.lift : 1.8) : 0, Z0 = Z00 + LIFT;
    const liftAt = (x, y) => (LIFT && inPoly(x, y, siteF) ? LIFT : 0);

    // 하늘(큰 구 안쪽에 그림) + 안개
    const skyC = skyCanvas(opt.look);
    const skyT = new THREE.CanvasTexture(skyC); skyT.encoding = THREE.sRGBEncoding;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(span * 30, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.set(cx, -span * 0.3, -cy); sky.rotation.y = -0.9; scene.add(sky);
    // 반사용 환경(하늘 그림)
    const pm = new THREE.PMREMGenerator(renderer); const envRT = pm.fromEquirectangular((() => { const t = new THREE.CanvasTexture(skyC); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding; return t; })());
    const ENV = envRT.texture; // 유리 반사에만 씀(땅·잔디까지 하늘빛으로 뜨지 않게)
    const fogCol = dusk ? 0x46506a : 0xd5dee6; scene.background = new THREE.Color(fogCol);
    scene.fog = new THREE.Fog(fogCol, span * 3, span * 10); // 카메라 정한 뒤 다시 맞춤

    // 빛
    const hemi = new THREE.HemisphereLight(dusk ? 0x8a9cc6 : 0xdfeaf5, dusk ? 0x2e2620 : 0x8a8270, dusk ? 0.42 : 0.3); scene.add(hemi);
    const sun = new THREE.DirectionalLight(dusk ? 0xffa868 : 0xfff1dc, dusk ? 1.0 : 1.45); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.5;
    const sc = sun.shadow.camera, R = span * 1.3; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = span * 12;
    const tgt = new THREE.Vector3(cx, 0, -cy), dd = span * 4;
    const sAz = dusk ? 1.15 : -0.6, sAlt = dusk ? 0.2 : 0.75; // 해질녘: 서쪽 낮게 / 낮: 남동 높게(방위: 남=0, 서=+)
    sun.position.set(tgt.x - dd * Math.cos(sAlt) * Math.sin(sAz), dd * Math.sin(sAlt), tgt.z + dd * Math.cos(sAlt) * Math.cos(sAz));
    sun.target.position.copy(tgt); scene.add(sun); scene.add(sun.target);

    // 땅: 항공사진(있으면) — 구역 밖은 어둡게
    const groundSize = span * 30;
    const aerTex = a => { const [c, x] = cv(a.img.width, a.img.height); x.filter = dusk ? 'brightness(0.55) saturate(0.7) contrast(1.05)' : 'brightness(0.9) saturate(0.85)'; x.drawImage(a.img, 0, 0); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
    let aerialT = null, aB = null;
    if (D.aerial && D.aerial.img) { aB = D.aerial; aerialT = aerTex(aB); }
    const groundMat = new THREE.MeshStandardMaterial({ color: dusk ? 0x4a4b45 : 0xb3b1a6, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -2.5, -cy); ground.receiveShadow = true; scene.add(ground);
    const worldUV = (geo, flatY, B) => { // 항공사진 좌표로 UV
      B = B || aB; const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = flatY ? -p.getZ(i) : p.getY(i); uv[i * 2] = (X - B.x0) / (B.x1 - B.x0); uv[i * 2 + 1] = (Y - B.y0) / (B.y1 - B.y0); }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    };
    const aerPlane = (B, T, y) => {
      const pg = new THREE.PlaneGeometry(B.x1 - B.x0, B.y1 - B.y0, 1, 1); pg.rotateX(-Math.PI / 2); pg.translate((B.x0 + B.x1) / 2, y, -(B.y0 + B.y1) / 2);
      worldUV(pg, true, B); const m = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: T, roughness: 1 })); m.receiveShadow = true; scene.add(m);
    };
    if (D.aerialFar && D.aerialFar.img) aerPlane(D.aerialFar, aerTex(D.aerialFar), -1.2); // 바깥: 넓은 저해상도
    if (aerialT) aerPlane(aB, aerialT, 0);
    const flat = (ring, mat, y, holes) => {
      const sh = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], p[1])));
      (holes || []).forEach(h => sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1])))));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
    };
    const STD = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0 }, o || {}));

    // 도로(항공사진이 없을 때만 회색으로 칠함)
    if (!aerialT) { const rm = STD(dusk ? 0x3d3f44 : 0x8d9094); (D.roads || []).forEach(r => { if (r.length > 2) flat(r, rm, 0.02); }); }

    // 주변 건물: 모형 = 낮고 어두운 블록(지붕은 항공사진), 검토 = 실제 높이
    const ctxSide = STD(dusk ? 0x3a3a3c : 0xc4c0b6), ctxTop = aerialT ? new THREE.MeshStandardMaterial({ map: aerialT, roughness: 1 }) : STD(dusk ? 0x56565a : 0xd6d2c8);
    const ctxReview = STD(dusk ? 0x5b6068 : 0xb7bcbd);
    const EYE = opt.view === 'persp' ? (opt.eye || [cx - span * 0.2, cy - span * 1.05]) : null;
    let fore = null;
    if (EYE) { // 눈 위치 ~ 단지 남쪽 끝까지 부채꼴: 비워서 앞마당(잔디·나무)으로
      const ang = Math.atan2(cy - EYE[1], cx - EYE[0]), L = Math.hypot(cx - EYE[0], cy - EYE[1]) * 0.8, wd = 0.62;
      fore = [EYE, [EYE[0] + L * Math.cos(ang - wd), EYE[1] + L * Math.sin(ang - wd)], [EYE[0] + L * Math.cos(ang), EYE[1] + L * Math.sin(ang)], [EYE[0] + L * Math.cos(ang + wd), EYE[1] + L * Math.sin(ang + wd)]];
      fore = [[EYE[0] - 40 * Math.cos(ang), EYE[1] - 40 * Math.sin(ang)], ...fore.slice(1)];
    }
    const foreF = fore ? tp(fore) : null;
    (D.ctx || []).forEach(c => {
      if (!c.poly || c.poly.length < 3) return;
      if (foreF) { const q = c.poly[0]; if (inPoly(q[0], q[1], foreF)) return; }
      const fl = c.floors || 1;
      const h = opt.mode === 'model' ? Math.min(6, 1.2 + fl * 0.9) : Math.max(3, fl * 3);
      const sh = new THREE.Shape(c.poly.map(p => new THREE.Vector2(p[0], p[1])));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      if (aerialT && opt.mode === 'model') worldUV(geo, true);
      const m = new THREE.Mesh(geo, opt.mode === 'model' ? [ctxTop, ctxSide] : ctxReview);
      m.castShadow = opt.mode !== 'model'; m.receiveShadow = true; scene.add(m);
      if (opt.mode === 'review' && dusk && fl >= 4) { // 주변 고층 창 불빛 조금
        const t = facade('front', '#888', 0.25); const mm = new THREE.MeshStandardMaterial({ color: 0x555a62, emissive: 0xffffff, emissiveMap: tex(t[1], 2, fl / 4), emissiveIntensity: 0.5, roughness: 0.8 });
        m.material = [STD(0x4a4e55), mm];
      }
    });

    /* ----- 단지 바닥: 잔디 + 순환로 + 보행로 ----- */
    const lawnC = (() => { const [c, x] = cv(256, 256); x.fillStyle = dusk ? '#4f6b3a' : '#5f8a40'; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${30 + rnd() * 40},${60 + rnd() * 50},${20 + rnd() * 30},.35)`; x.fillRect(rnd() * 256, rnd() * 256, 2, 2); } return c; })();
    const lawn = new THREE.MeshStandardMaterial({ map: tex(lawnC, span / 20, span / 20), roughness: 1 });
    const pave = STD(dusk ? 0x9b8a72 : 0xc2b49a);
    if (LIFT) {
      const sh0 = new THREE.Shape(S.map(p => new THREE.Vector2(p[0], p[1])));
      const pg0 = new THREE.ExtrudeGeometry(sh0, { depth: LIFT, bevelEnabled: false }); pg0.rotateX(-Math.PI / 2);
      const plinth = new THREE.Mesh(pg0, [STD(dusk ? 0x8d877c : 0xd8d0c0), STD(dusk ? 0x6e675c : 0xa89d88)]); plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
      // 경계 테두리선(해질녘엔 은은한 조명선)
      for (let i = 0; i < S.length; i++) { const a = S[i], b = S[(i + 1) % S.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) continue; const e = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: dusk ? 0xffe2ae : 0xffffff })); e.position.set((a[0] + b[0]) / 2, LIFT + 0.12, -(a[1] + b[1]) / 2); e.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]); scene.add(e); }
    }
    flat(S, pave, 0.05 + LIFT);
    if (fore) flat(fore, lawn, 0.03);
    const ring1 = mBuf(S, -4), ring2 = mBuf(S, -11), ring3 = mBuf(S, -14);
    if (ring1) flat(ring1, lawn, 0.07 + LIFT);
    // 단지 순환로(붉은 포장)
    if (ring2 && ring3) flat(ring2, STD(dusk ? 0x6d4a3e : 0xa8735f), 0.09 + LIFT, [ring3]);
    if (ring3) flat(ring3, lawn, 0.1 + LIFT);
    // 공원
    (D.parks || []).forEach(pk => flat(pk, lawn, 0.11));
    // 구역 경계선(검토 모드만)
    if (opt.mode === 'review') scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(S.map(p => V(p, 0.4))), new THREE.LineBasicMaterial({ color: 0xc8322b })));

    /* ----- 동 ----- */
    const accents = ['#9b7a52', '#6b4e3d', '#b08d57', '#566876', '#8a5a44'];
    const accentHex = accents.map(a => parseInt(a.slice(1), 16));
    const ccw = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? r : r.slice().reverse(); };
    const lit = dusk ? 0.42 : 0;
    const fk = (k, a, l) => { const r = facade(k, a, l); r.kind = k; return r; };
    const sets = accents.map(a => ({ front: fk('front', a, lit), side: fk('side', a, lit), base: fk('base', a, dusk ? 1 : 0), crown: fk('crown', a, lit * 0.6) }));
    const foot = [], baseShrub = []; // 동 바깥 벽 앞 관목(안쪽 벽은 빼고)
    const roofG = STD(dusk ? 0x5f7a48 : 0x8fb36a), roofP = STD(0xd9d5cc), parap = STD(0xeeebe4, { roughness: 0.6 });
    const glow = []; // 빛 점(가로등·옥탑)
    // 동 번호로 묶기(가장 가까운 라벨) → 같은 동은 같은 색
    const dongOf = b => { const c = turf.centroid(tp(b.ring)).geometry.coordinates; let bi = 0, bd = 1e9; (D.labels || []).forEach((l, i) => { const d = Math.hypot(l.c[0] - c[0], l.c[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const WB = {}, PIL = { P: [], I: [] };
    D.blds.forEach(b => {
      const di = dongOf(b), set = sets[di % sets.length], F = b.floors || 15;
      const zB = Z0 + 2 * FH, zC = Z0 + (F - 2) * FH, zT = Z0 + F * FH;
      const Rg = ccw(b.ring); foot.push(Rg);
      // 같은 동의 다른 세대 조각과 맞닿은 안쪽 벽은 안 그림(조각들을 합치지 않고 세움 — 합치기 계산은 맞닿은 사각형이 많으면 매우 느림)
      const others = (b.grp || []).filter(r => r !== b.ring);
      const inR2 = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], q = r[j]; if ((a[1] > y) !== (q[1] > y) && x < (q[0] - a[0]) * (y - a[1]) / (q[1] - a[1]) + a[0]) c = !c; } return c; };
      const innerWall = (p, q, L) => { if (!others.length) return false; const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L, mx = (p[0] + q[0]) / 2 + nx * 0.35, my = (p[1] + q[1]) / 2 + ny * 0.35; return others.some(o => inR2(mx, my, o)); };
      const band = (p, q, L, z0, z1, pair, nF, side) => {
        // 벽마다 재질·텍스처를 새로 만들지 않고, (색 묶음·종류)별 버킷에 모아 한 덩어리로 그림 — 반복은 UV에 담음
        const nB = Math.max(1, Math.round(L / 3.3));
        const key = di % sets.length + '|' + pair.kind + '|' + (side ? 1 : 0);
        const bk = WB[key] || (WB[key] = { pair, side, P: [], U: [], N: [], C: [], I: [] });
        const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L, ox = nx * 0.02, oy = ny * 0.02;
        const base = bk.P.length / 3, ru = nB / 4, rv = nF / 4, SEG = 4;
        for (let r = 0; r <= SEG; r++) {
          const z = z0 + (z1 - z0) * r / SEG, f = 0.62 + 0.38 * Math.min(1, z / 45); // 아래층일수록 어둡게(땅 가까운 그늘)
          [[p, 0], [q, 1]].forEach(([w, u]) => { bk.P.push(w[0] + ox, z, -(w[1] + oy)); bk.U.push(u * ru, r / SEG * rv); bk.N.push(nx, 0, -ny); bk.C.push(f, f, f); });
        }
        for (let r = 0; r < SEG; r++) { const a = base + r * 2; bk.I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      };
      for (let i = 0; i < Rg.length; i++) {
        const p = Rg[i], q = Rg[(i + 1) % Rg.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.4 || innerWall(p, q, L)) continue;
        const side = L < 7.5;
        band(p, q, L, Z0, zB, set.base, 2, false);
        band(p, q, L, zB, zC, side ? set.side : set.front, F - 4, side);
        band(p, q, L, zC, zT, side ? set.side : set.crown, 2, side);
        // 필로티 그늘
        { const b0 = PIL.P.length / 3; PIL.P.push(p[0], 0, -p[1], q[0], 0, -q[1], p[0], Z0, -p[1], q[0], Z0, -q[1]); PIL.I.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2); }
      }
      const sh = new THREE.Shape(Rg.map(p => new THREE.Vector2(p[0], p[1])));
      const body = new THREE.ExtrudeGeometry(sh, { depth: zT - 0.05, bevelEnabled: false }); body.rotateX(-Math.PI / 2);
      const bm = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); bm.castShadow = true; scene.add(bm); // 그림자 전용
      const eg = new THREE.EdgesGeometry(body, 25); const el = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: dusk ? 0x2a2e36 : 0x5d636b, transparent: true, opacity: 0.75 })); el.position.y = 0.02; scene.add(el); // 또렷한 윤곽
      // 옥상: 녹화(가운데) + 난간
      const roof = new THREE.Mesh(new THREE.ShapeGeometry(sh), roofP); roof.rotation.x = -Math.PI / 2; roof.position.y = zT; roof.receiveShadow = true; scene.add(roof);
      const inner = mBuf(Rg, -1.6); if (inner && inner.length > 2) flat(inner, roofG, zT + 0.15);
      const par = new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false }); par.rotateX(-Math.PI / 2);
      const pm2 = new THREE.Mesh(par, parap); pm2.position.y = zT; pm2.castShadow = true; scene.add(pm2);
      // 가장 높은 날개: 옥탑 구조물(포인트 색 + 테두리 조명)
      if (b.top) {
        const c = turf.centroid(tp(Rg)).geometry.coordinates;
        const e1 = Rg.reduce((a, p, i) => { const q = Rg[(i + 1) % Rg.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); return L > a.L ? { L, ang: Math.atan2(q[1] - p[1], q[0] - p[0]) } : a; }, { L: 0, ang: 0 });
        const fr = new THREE.Mesh(new THREE.BoxGeometry(Math.min(16, e1.L * 0.55), 7, 1.2), STD(accentHex[di % accentHex.length], { emissive: dusk ? 0xffd9a0 : 0, emissiveIntensity: dusk ? 0.15 : 0 }));
        fr.position.set(c[0], zT + 4.6, -c[1]); fr.rotation.y = e1.ang; fr.castShadow = true; scene.add(fr);
        const box = new THREE.Mesh(new THREE.BoxGeometry(Math.min(12, e1.L * 0.4), 4.5, 6), STD(0xe6e2da)); box.position.set(c[0], zT + 2.3, -c[1]); box.rotation.y = e1.ang; box.castShadow = true; scene.add(box);
        if (dusk) { const s = new THREE.Mesh(new THREE.BoxGeometry(Math.min(16, e1.L * 0.55) + 0.2, 0.35, 1.3), new THREE.MeshBasicMaterial({ color: 0xfff1d0 })); s.position.set(c[0], zT + 8.1, -c[1]); s.rotation.y = e1.ang; scene.add(s); }
      }
    });
    // 모아 둔 벽을 버킷마다 한 덩어리로(재질·텍스처는 버킷당 한 벌)
    Object.values(WB).forEach(bk => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bk.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(bk.C, 3)); g.setIndex(bk.I);
      const side = bk.side, pair = bk.pair;
      if (!pair.T) pair.T = [tex(pair[0], 1, 1), tex(pair[1], 1, 1)];
      const mat = new THREE.MeshStandardMaterial({ map: pair.T[0], emissive: 0xffffff, emissiveMap: pair.T[1], emissiveIntensity: dusk ? 1.0 : 0, envMap: ENV, roughness: side ? 0.85 : 0.5, metalness: side ? 0 : 0.15, envMapIntensity: dusk ? (side ? 0.15 : 0.45) : (side ? 0.3 : 0.6), color: dusk ? 0xdcd8d0 : 0xe6e6e6, vertexColors: true, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    });
    if (PIL.I.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(PIL.P, 3)); g.setIndex(PIL.I); g.computeVertexNormals(); scene.add(new THREE.Mesh(g, STD(0x2e3439, { side: THREE.DoubleSide }))); }
    // 동 번호(검토용)
    if (opt.labels) (D.labels || []).forEach(l => {
      const [c, x] = cv(300, 90); x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(0, 0, 300, 90); x.fillStyle = '#2b2f33'; x.font = 'bold 46px sans-serif'; x.textAlign = 'center'; x.fillText(l.label, 150, 62);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); sp.position.set(l.c[0], Z0 + l.top * FH + 16, -l.c[1]); sp.scale.set(20, 6, 1); scene.add(sp);
    });

    /* ----- 나무·관목 ----- */
    const bufFoot = foot.map(q => tp(mBuf(q, 4.5) || q)), fb = bufFoot.map(f => turf.bbox(f));
    const nearB = (x, y) => bufFoot.some((f, i) => x >= fb[i][0] && x <= fb[i][2] && y >= fb[i][1] && y <= fb[i][3] && inPoly(x, y, f));
    const r2f = ring2 ? tp(ring2) : null, r3f = ring3 ? tp(ring3) : null;
    const onLoop = (x, y) => r2f && r3f && inPoly(x, y, r2f) && !inPoly(x, y, r3f);
    const trees = [], shrubs = [];
    const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30;
    const parkF = (D.parks || []).map(tp);
    for (let x = x0; x <= x1; x += 6) for (let y = y0; y <= y1; y += 6) {
      const px = x + (rnd() - .5) * 4.5, py = y + (rnd() - .5) * 4.5;
      const inSite = inPoly(px, py, siteF), inPark = parkF.some(f => inPoly(px, py, f));
      if (!inSite && !inPark) continue; if (nearB(px, py) || onLoop(px, py)) continue;
      if (rnd() < (inPark ? 0.7 : 0.62)) trees.push([px, py, 0.7 + rnd() * 0.7]);
      else if (rnd() < 0.6) shrubs.push([px, py, 0.6 + rnd() * 0.8]);
    }
    if (fore) { const fb2 = turf.bbox(foreF); for (let x = fb2[0]; x <= fb2[2]; x += 7) for (let y = fb2[1]; y <= fb2[3]; y += 7) { const px = x + (rnd() - .5) * 6, py = y + (rnd() - .5) * 6; if (!inPoly(px, py, foreF)) continue; const de = Math.hypot(px - EYE[0], py - EYE[1]); if (de < 30) continue; const rr = rnd(); if (rr < (de < 110 ? 0.04 : 0.3)) trees.push([px, py, 0.8 + rnd() * 0.9]); else if (rr < 0.6) shrubs.push([px, py, 0.8 + rnd() * 1.2]); } }
    // 동 둘레 관목
    baseShrub.forEach(t => shrubs.push(t));
    // 단지 안쪽 둘레 나무
    for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 6) continue;
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
      for (let t = 3; t < L - 2; t += 8) { const qx = a[0] + (b[0] - a[0]) * t / L - nx * 2, qy = a[1] + (b[1] - a[1]) * t / L - ny * 2; if (inPoly(qx, qy, siteF)) trees.push([qx, qy, 0.95]); }
    }
    /* ----- 경계 가로(정비기반시설): 변마다 바깥 도로 폭을 재서 보도·차도·차선·가로수·가로등 ----- */
    const roadF = (D.roads || []).filter(r => r.length > 2).map(r => { try { return tp(r); } catch (e) { return null; } }).filter(Boolean);
    const rbb = roadF.map(f => turf.bbox(f));
    const inRoad = (x, y) => roadF.some((f, i) => x >= rbb[i][0] && x <= rbb[i][2] && y >= rbb[i][1] && y <= rbb[i][3] && inPoly(x, y, f));
    const streetLamps = [], streetRings = [], streets = [];
    const sideM = STD(dusk ? 0x5f5a54 : 0x6f6a62), curbM = STD(dusk ? 0x8a847c : 0xbdb8ae), asphM = STD(dusk ? 0x0b0b0c : 0x0c0d0e, { roughness: 0.95 });
    const yelM = new THREE.MeshBasicMaterial({ color: dusk ? 0xa8851a : 0xe3b21c }), whM = new THREE.MeshBasicMaterial({ color: dusk ? 0xb8b8b8 : 0xf4f4f4 });
    const lineBuf = { y: [], w: [] }; // 차선 사각형을 모았다가 한 덩어리로 그림(조각마다 그리면 수천 개 → 느려짐)
    const addLine = (kind, ring) => lineBuf[kind].push(ring);
    const quad = (A, B, n, o1, o2, t1, t2) => { const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L; const P0 = [A[0] + ux * t1, A[1] + uy * t1], P1 = [A[0] + ux * t2, A[1] + uy * t2]; return [[P0[0] + n[0] * o1, P0[1] + n[1] * o1], [P1[0] + n[0] * o1, P1[1] + n[1] * o1], [P1[0] + n[0] * o2, P1[1] + n[1] * o2], [P0[0] + n[0] * o2, P0[1] + n[1] * o2]]; };
    for (let i = 0; i < S.length; i++) {
      const A = S[i], B = S[(i + 1) % S.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 3) continue;
      let n = [(B[1] - A[1]) / L, -(B[0] - A[0]) / L]; const mx0 = (A[0] + B[0]) / 2, my0 = (A[1] + B[1]) / 2;
      if (inPoly(mx0 + n[0] * 1.5, my0 + n[1] * 1.5, siteF)) n = [-n[0], -n[1]];
      const widthAt = t => { const px = A[0] + (B[0] - A[0]) * t, py = A[1] + (B[1] - A[1]) * t; let w = 0; for (let d = 1; d <= 60; d++) { if (inRoad(px + n[0] * d, py + n[1] * d)) w = d; else if (d - w > 3) break; } return w; };
      const ws = [0.25, 0.5, 0.75].map(widthAt).sort((x, y) => x - y), w = ws[1];
      if (w < 4) continue;
      streets.push({ A, B, L, n, w });
    }
    roadF.forEach((f, i) => { const c = [(rbb[i][0] + rbb[i][2]) / 2, (rbb[i][1] + rbb[i][3]) / 2]; if (Math.hypot(c[0] - cx, c[1] - cy) < span * 1.3) { const r = f.geometry.coordinates[0].slice(0, -1); flat(r, asphM, 0.1); streetRings.push(r); } });
    streets.forEach(({ A, B, L, n, w }) => {
      const sw = w >= 25 ? 5 : w >= 12 ? 3.5 : 2, far = w >= 12, cw0 = sw, cw1 = far ? w - sw : w, ext = Math.min(6, sw + 2), lx = L >= 25 ? Math.min(40, L * 0.6) : ext;
      const inR = (t, o) => inRoad(A[0] + (B[0] - A[0]) * t / L + n[0] * o, A[1] + (B[1] - A[1]) * t / L + n[1] * o);
      const r1 = quad(A, B, n, 0, sw, -ext, L + ext), r2 = quad(A, B, n, cw0, cw1, -ext, L + ext);
      flat(r1, sideM, 0.16); flat(quad(A, B, n, sw - 0.25, sw, -ext, L + ext), curbM, 0.2); flat(r2, asphM, 0.12);
      streetRings.push(r1, r2);
      if (far) { flat(quad(A, B, n, w - sw, w, -ext, L + ext), sideM, 0.16); flat(quad(A, B, n, w - sw, w - sw + 0.25, -ext, L + ext), curbM, 0.2); streetRings.push(quad(A, B, n, w - sw, w, -ext, L + ext)); }
      const cwW = cw1 - cw0, mid = cw0 + cwW / 2;
      if (cwW >= 9) for (let t = -lx; t < L + lx; t += 6) if (inR(t + 3, mid)) { addLine('y', quad(A, B, n, mid - 0.3, mid - 0.15, t, t + 6)); addLine('y', quad(A, B, n, mid + 0.15, mid + 0.3, t, t + 6)); }
      const dashAt = o => { for (let t = -lx; t < L + lx; t += 8) if (inR(t + 1.5, o)) addLine('w', quad(A, B, n, o - 0.08, o + 0.08, t, t + 3)); };
      if (cwW < 9) dashAt(mid);
      else for (let k = 1; cw0 + k * 3.3 < mid - 1.2; k++) { dashAt(cw0 + k * 3.3); dashAt(cw1 - k * 3.3); }
      // 보도 가로수·가로등
      for (let t = 2; t < L; t += 8) { const px = A[0] + (B[0] - A[0]) * t / L, py = A[1] + (B[1] - A[1]) * t / L; trees.push([px + n[0] * sw * 0.45, py + n[1] * sw * 0.45, 0.85]); if (far && w < 40) trees.push([px + n[0] * (w - sw * 0.45), py + n[1] * (w - sw * 0.45), 0.85]); }
      for (let t = 6; t < L; t += 24) { const px = A[0] + (B[0] - A[0]) * t / L, py = A[1] + (B[1] - A[1]) * t / L; streetLamps.push([px + n[0] * (sw - 0.5), py + n[1] * (sw - 0.5), 9]); if (far) streetLamps.push([px + n[0] * (w - sw + 0.5), py + n[1] * (w - sw + 0.5), 9]); }
    });
    [['y', yelM], ['w', whM]].forEach(([k, mat]) => {
      const L = lineBuf[k]; if (!L.length) return; const pos = new Float32Array(L.length * 18);
      L.forEach((q, i) => { const v = [q[0], q[1], q[2], q[0], q[2], q[3]]; v.forEach((p, j) => { pos[i * 18 + j * 3] = p[0]; pos[i * 18 + j * 3 + 1] = 0.19; pos[i * 18 + j * 3 + 2] = -p[1]; }); });
      const g3 = new THREE.BufferGeometry(); g3.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mm = new THREE.Mesh(g3, mat); mm.material.side = THREE.DoubleSide; scene.add(mm);
    });
    // 화면 위 동 윤곽(투시도에서 나무가 건물 가리는지 볼 때·초점 판에 씀)
    const hullOf = pts => { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; pts.forEach(p => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }); pts.slice().reverse().forEach(p => { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }); return lo.slice(0, -1).concat(up.slice(0, -1)); };
    const ndc = (cam, x, h, y) => { const v = new THREE.Vector3(x, h, -y).project(cam); return [v.x, v.y]; };
    const inHull = (H2, p) => { let c = false; for (let i = 0, j = H2.length - 1; i < H2.length; j = i++) { const a = H2[i], b = H2[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    // 그림자만 드리우는 보이지 않는 덩어리(그림 나무는 카메라를 정한 뒤 세움)
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3(), col = new THREE.Color();
    const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const caster = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 1), ghost, Math.max(1, trees.length));
    trees.forEach((t, i) => { const s2 = t[2] * 1.15; M.compose(P.set(t[0], 5 * s2 + liftAt(t[0], t[1]), -t[1]), Q, Sc.set(s2 * 1.1, s2, s2 * 1.1)); caster.setMatrixAt(i, M); });
    caster.count = trees.length; caster.castShadow = true; scene.add(caster);
    // 짙은 무리·옅은 무리: 느린 물결 무늬로 나무를 묶어 대비를 줌
    const toneAt = (x, y) => Math.sin(x / 23 + 1.3) + Math.cos(y / 29) + Math.sin((x + y) / 17 + 0.5) * 0.7;
    const plantTrees = cam => {
      const types = { round: [], tall: [], cone: [], flower: [], bush: [] };
      if (opt.view === 'persp' || opt.view === 'semi') {
        // 동 앞(카메라 쪽)에 서서 화면에서 동을 가리는 나무는 뺌
        const camP = cam.position, bh = D.blds.map(b => { const zT = Z0 + (b.floors || 15) * FH; const c = turf.centroid(tp(b.ring)).geometry.coordinates; return { H: hullOf(b.ring.map(p => ndc(cam, p[0], Z0 + 3, p[1])).concat(b.ring.map(p => ndc(cam, p[0], zT, p[1])))), d: Math.hypot(c[0] - camP.x, c[1] + camP.z) }; });
        const keep = t => { const h = (t.length > 3 ? 2 : 9) * t[2] * 1.15, top = ndc(cam, t[0], h, t[1]), d = Math.hypot(t[0] - camP.x, t[1] + camP.z); return !bh.some(b => d < b.d - 3 && inHull(b.H, top)); };
        for (let i = trees.length - 1; i >= 0; i--) if (!keep(trees[i])) trees.splice(i, 1);
      }
      trees.forEach(t => {
        const inSite = inPoly(t[0], t[1], siteF), r = rnd();
        const ty = !inSite ? (r < 0.75 ? 'tall' : 'round') : r < 0.07 ? 'flower' : r < 0.2 ? 'cone' : r < 0.42 ? 'tall' : 'round';
        types[ty].push(t);
      });
      shrubs.forEach(t => types.bush.push(t));
      const q = cam.quaternion;
      Object.keys(types).forEach(ty => {
        const list = types[ty]; if (!list.length) return;
        const T = new THREE.CanvasTexture(treeCanvas(ty)); T.encoding = THREE.sRGBEncoding; T.anisotropy = 4;
        const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
        const mat = new THREE.MeshLambertMaterial({ map: T, alphaTest: 0.5, side: THREE.DoubleSide });
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((t, i) => {
          const sz = t[2] * 1.15;
          const [w, h] = ty === 'bush' ? [3.2 * t[2], 1.6 * t[2]] : ty === 'cone' ? [5.5 * sz, 9.5 * sz] : ty === 'tall' ? [7 * sz, 9.5 * sz] : [7.5 * sz, 8.2 * sz];
          M.compose(P.set(t[0], liftAt(t[0], t[1]), -t[1]), q, Sc.set(w, h, 1)); im.setMatrixAt(i, M);
          // 색조: 무리별 짙음/옅음 + 나무마다 조금씩
          const v = toneAt(t[0], t[1]);
          let k = v > 0.9 ? 1.28 : v < -0.6 ? 0.62 : 0.95; k *= 0.9 + rnd() * 0.22; if (dusk) k *= 0.82;
          const warm = v > 0.9 ? 1.06 : 1;
          im.setColorAt(i, col.setRGB(k * warm, k * (v > 0.9 ? 1.04 : 1), k * (v < -0.6 ? 0.92 : 0.86)));
        });
        im.receiveShadow = true; scene.add(im);
      });
    };

    /* ----- 가로등·조명 점 ----- */
    const lampPts = [];
    if (ring2) { const rr = mBuf(S, -12.5) || ring2; let acc = 0; for (let i = 0; i < rr.length; i++) { const a = rr[i], b = rr[(i + 1) % rr.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 1) { acc += 1; if (acc >= 14) { acc = 0; lampPts.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L, 4.5]); } } } }
    streetLamps.forEach(l => lampPts.push(l));
    // 단지 안 보행등(나무 사이)
    trees.forEach(t => { if (rnd() < 0.08 && inPoly(t[0], t[1], siteF)) lampPts.push([t[0] + 1.5, t[1] + 1.5, 1.2]); });
    const poleG = new THREE.CylinderGeometry(0.08, 0.1, 1, 5);
    const poles = new THREE.InstancedMesh(poleG, STD(0x2b2d30), lampPts.length);
    lampPts.forEach((l, i) => { M.compose(P.set(l[0], l[2] / 2 + liftAt(l[0], l[1]), -l[1]), Q, Sc.set(1, l[2], 1)); poles.setMatrixAt(i, M); }); scene.add(poles);
    if (dusk) {
      const [gc, gx] = cv(64, 64); const gg = gx.createRadialGradient(32, 32, 0, 32, 32, 32); gg.addColorStop(0, 'rgba(255,240,200,1)'); gg.addColorStop(0.25, 'rgba(255,200,120,.55)'); gg.addColorStop(1, 'rgba(255,180,90,0)'); gx.fillStyle = gg; gx.fillRect(0, 0, 64, 64);
      const gt = new THREE.CanvasTexture(gc);
      const pos = new Float32Array(lampPts.length * 3); lampPts.forEach((l, i) => { pos[i * 3] = l[0]; pos[i * 3 + 1] = l[2] + 0.2 + liftAt(l[0], l[1]); pos[i * 3 + 2] = -l[1]; });
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ map: gt, size: 5.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false })));
      // 바닥에 번지는 불빛(가로등 아래 둥근 빛)
      const [pc, px] = cv(64, 64); const pg2 = px.createRadialGradient(32, 32, 0, 32, 32, 32); pg2.addColorStop(0, 'rgba(255,190,110,.55)'); pg2.addColorStop(1, 'rgba(255,190,110,0)'); px.fillStyle = pg2; px.fillRect(0, 0, 64, 64);
      const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), lampPts.length);
      const qd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      lampPts.forEach((l, i) => { const r = l[2] > 3 ? 9 : 4; M.compose(P.set(l[0], 0.2 + liftAt(l[0], l[1]), -l[1]), qd, Sc.set(r, r, 1)); pool.setMatrixAt(i, M); }); scene.add(pool);
    }

    /* ----- 사람·차 ----- */
    const people = [];
    if (ring3) for (let i = 0; i < ring3.length; i++) { const a = ring3[i], b = ring3[(i + 1) % ring3.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 4) if (rnd() < 0.35) people.push([a[0] + (b[0] - a[0]) * t / L + (rnd() - .5) * 2, a[1] + (b[1] - a[1]) * t / L + (rnd() - .5) * 2]); }
    const body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.22, 1.2, 6), STD(0xffffff), Math.max(1, people.length));
    const cloth = [0x2f4b7c, 0xc0392b, 0xe8c547, 0x2e8b57, 0x34495e, 0xe67e22, 0xf2f2f2, 0x8e44ad];
    people.forEach((p, i) => { M.compose(P.set(p[0], 0.75 + liftAt(p[0], p[1]), -p[1]), Q, Sc.set(1, 1, 1)); body.setMatrixAt(i, M); body.setColorAt(i, col.setHex(cloth[Math.floor(rnd() * cloth.length)])); });
    body.count = people.length; body.castShadow = true; scene.add(body);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 5), STD(0xd9b08c), Math.max(1, people.length));
    people.forEach((p, i) => { M.compose(P.set(p[0], 1.55 + liftAt(p[0], p[1]), -p[1]), Q, Sc.set(1, 1, 1)); heads.setMatrixAt(i, M); }); heads.count = people.length; scene.add(heads);
    const cars = [], carLights = [];
    (D.roads || []).forEach(r => {
      if (r.length < 3) return; let best = 0, ang = 0;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
      let f; try { f = tp(r); } catch (e) { return; }
      const area = turf.area(turf.polygon([deg(r)])); const n = Math.min(10, Math.floor(area / 500));
      const bb = turf.bbox(f);
      for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
        const px = bb[0] + rnd() * (bb[2] - bb[0]), py = bb[1] + rnd() * (bb[3] - bb[1]);
        if (Math.hypot(px - cx, py - cy) > span * 1.6 || !inPoly(px, py, f)) continue;
        const a2 = ang + (rnd() < 0.5 ? 0 : Math.PI); cars.push([px, py, a2]); k++;
        if (dusk) { const dx = Math.cos(a2) * 2.3, dy = Math.sin(a2) * 2.3; carLights.push([px + dx, py + dy, 1], [px - dx, py - dy, 0]); }
      }
    });
    const car = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 1.35, 1.85), STD(0xffffff, { roughness: 0.3, metalness: 0.5 }), Math.max(1, cars.length));
    const carC = [0xf2f2f2, 0x1c1c1c, 0x8f979c, 0x1f3b6b, 0x7d1d1d, 0xcfcfcf];
    cars.forEach((c, i) => { Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c[2]); M.compose(P.set(c[0], 0.75, -c[1]), Q, Sc.set(1, 1, 1)); car.setMatrixAt(i, M); car.setColorAt(i, col.setHex(carC[Math.floor(rnd() * carC.length)])); });
    Q.identity(); car.count = cars.length; car.castShadow = true; scene.add(car);
    if (carLights.length) {
      const pos = new Float32Array(carLights.length * 3), colr = new Float32Array(carLights.length * 3);
      carLights.forEach((l, i) => { pos.set([l[0], 0.8, -l[1]], i * 3); colr.set(l[2] ? [1, 0.95, 0.8] : [1, 0.15, 0.1], i * 3); });
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    }

    /* ----- 카메라(네 시점) ----- */
    const views = {
      wide: { fov: 35, el: 0.62, d: 4.2, az: -0.35, y: 0 },      // 광역조감도: 동네 전체
      semi: { fov: 32, el: 0.36, d: 1.75, az: -0.5, y: 25 },     // 반조감도: 낮은 비스듬
      bird: { fov: 30, el: 0.78, d: 1.6, az: -0.45, y: 20 },     // 조감도: 높은 비스듬, 단지가 화면 가득
    };
    const camera = new THREE.PerspectiveCamera(30, W / H, 3, span * 40);
    if (opt.view === 'persp') {
      // 투시도: 남쪽 멀리(구역 폭의 1.5배) 높이 12m에서, 하늘이 화면 절반
      const ep = EYE;
      camera.fov = 40; camera.position.set(ep[0], 16, -ep[1]);
      camera.lookAt(new THREE.Vector3(cx, 52, -cy));
    } else {
      const v = views[opt.view] || views.bird, look = new THREE.Vector3(cx, v.y, -cy), dist = span * v.d;
      camera.fov = v.fov; camera.position.set(look.x + dist * Math.cos(v.el) * Math.sin(v.az), look.y + dist * Math.sin(v.el), look.z + dist * Math.cos(v.el) * Math.cos(v.az)); camera.lookAt(look);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(); plantTrees(camera);
    { const cd = camera.position.distanceTo(new THREE.Vector3(cx, 0, -cy)); scene.fog.near = cd * (opt.view === 'persp' ? 1.3 : 0.95); scene.fog.far = cd * (opt.view === 'wide' ? 2.6 : 4); }

    /* ----- 후처리: 빛 번짐 + 가장자리 어둡게 ----- */
    let draw = () => renderer.render(scene, camera);
    if (THREE.EffectComposer && THREE.UnrealBloomPass) {
      const rt = new THREE.WebGLMultisampleRenderTarget(W * opt.pr, H * opt.pr, { format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding });
      const comp = new THREE.EffectComposer(renderer, rt); comp.setPixelRatio(opt.pr); comp.setSize(W, H);
      comp.addPass(new THREE.RenderPass(scene, camera));
      if (dusk) comp.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.3, 0.985));
      if (THREE.ShaderPass) {
        // 단지 범위(바닥 + 동 기둥 + 옥탑)를 화면에 비춘 그림 → 흐릿한 경계의 '초점 판'
        const [mc, mx] = cv(Math.round(W / 2), Math.round(H / 2)), sx = mc.width, sy = mc.height;
        const prj = (x, h, y) => { const v = new THREE.Vector3(x, h, -y).project(camera); return [(v.x + 1) / 2 * sx, (1 - v.y) / 2 * sy]; };
        const fillPts = (pts, grow) => { if (pts.length < 3) return; mx.beginPath(); pts.forEach((p, i) => i ? mx.lineTo(p[0], p[1]) : mx.moveTo(p[0], p[1])); mx.closePath(); mx.fill(); if (grow) { mx.lineJoin = 'round'; mx.lineWidth = grow; mx.strokeStyle = mx.fillStyle; mx.stroke(); } };
        mx.fillStyle = '#000'; mx.fillRect(0, 0, sx, sy); mx.fillStyle = '#fff';
        const inFront = (x, h, y) => new THREE.Vector3(x, h, -y).applyMatrix4(camera.matrixWorldInverse).z < 0;
        fillPts(S.map(p => prj(p[0], 0, p[1]))); fillPts(S.map(p => prj(p[0], 10, p[1])));
        mx.fillStyle = '#ccc'; streetRings.forEach(r => fillPts(r.map(p => prj(p[0], 0, p[1])))); mx.fillStyle = '#fff';
        D.blds.forEach(b => { const zT = Z0 + (b.floors || 15) * FH + 9; fillPts(hullOf(b.ring.map(p => prj(p[0], 0, p[1])).concat(b.ring.map(p => prj(p[0], zT, p[1])))), Math.max(6, sx / 45)); });
        if (fore) fillPts(fore.filter(p => inFront(p[0], 0, p[1])).map(p => prj(p[0], 0, p[1])));
        if (opt.view === 'persp') { const by = Math.min(...D.blds.map(b => Math.min(...b.ring.map(p => prj(p[0], 0, p[1])[1])))); mx.fillStyle = '#fff'; mx.fillRect(0, by - sy * 0.02, sx, sy); } // 투시도: 앞마당까지 또렷하게
        const [bc, bx] = cv(sx, sy); bx.filter = `blur(${Math.max(2, Math.round(sx / 160))}px)`; bx.drawImage(mc, 0, 0);
        const maskT = new THREE.CanvasTexture(bc);
        const taps = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; taps.push([Math.cos(a), Math.sin(a), 1.0], [Math.cos(a + 0.26) * 2.1, Math.sin(a + 0.26) * 2.1, 0.7]); }
        const blurSrc = taps.map(t => `s += texture2D(tDiffuse, vUv + vec2(${t[0].toFixed(3)}, ${t[1].toFixed(3)}) * px * rad).rgb * ${t[2].toFixed(2)};`).join('\n');
        const wsum = taps.reduce((a, t) => a + t[2], 0) + 1;
        comp.addPass(new THREE.ShaderPass({
          uniforms: { tDiffuse: { value: null }, tMask: { value: maskT }, px: { value: new THREE.Vector2(1 / (W * opt.pr), 1 / (H * opt.pr)) }, rad: { value: (opt.view === 'persp' ? 2.0 : 2.6) * opt.pr }, amt: { value: dusk ? 0.55 : 0.35 }, dark: { value: dusk ? 0.78 : 0.9 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tMask; uniform vec2 px; uniform float rad; uniform float amt; uniform float dark; varying vec2 vUv;
            void main(){
              vec4 c = texture2D(tDiffuse, vUv); float m = clamp(texture2D(tMask, vUv).r * 1.15, 0.0, 1.0);
              vec3 s = c.rgb; ${blurSrc}
              vec3 bl = s / ${wsum.toFixed(2)};
              vec3 nb = (texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25;
              vec3 sh = c.rgb + (c.rgb - nb) * 0.9;                       // 단지: 또렷하게
              float l = dot(sh, vec3(0.299, 0.587, 0.114)); sh = mix(vec3(l), sh, 1.12); sh = (sh - 0.5) * 1.06 + 0.5;
              float lo = dot(bl, vec3(0.299, 0.587, 0.114)); vec3 ou = mix(vec3(lo), bl, 0.7) * dark;   // 밖: 흐리고 옅고 어둡게
              float det = smoothstep(0.012, 0.07, length(c.rgb - bl));   // 하늘처럼 밋밋한 곳은 효과 없음
              sh = mix(c.rgb, sh, det); ou = mix(bl, ou, det);
              vec3 o = mix(ou, sh, m);
              vec2 d = vUv - 0.5; o *= 1.0 - amt * dot(d, d) * 1.6;
              gl_FragColor = vec4(clamp(o, 0.0, 1.0), c.a);
            }`,
        }));
      }
      draw = () => comp.render();
    }
    draw();
    return { png: () => renderer.domElement.toDataURL('image/png'), counts: { trees: trees.length, shrubs: shrubs.length, people: people.length, cars: cars.length, lamps: lampPts.length } };
  }
  g.JbsBird = { render };
})(typeof window !== 'undefined' ? window : globalThis);
