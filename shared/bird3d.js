'use strict';
// 조감도·투시도 그리기(개략, 2판 2026-11-07) — three.js r128 + turf 6.5 (+ 있으면 EffectComposer·UnrealBloomPass·ShaderPass·CopyShader·LuminosityHighPassShader)
// JbsBird.render(el, data, opt)
//  data = { aerialFar(같은 꼴, 넓은 범위 바탕), site:[[x,y]..], blds:[{ring:[[x,y]..], floors, top}], labels:[{label,c:[x,y],top}], parks:[ring..], ctx:[{poly,floors}], roads:[ring..], aerial:{img, x0,y0,x1,y1} }
//  opt  = { look:'dusk'|'day', mode:'model'(주변 낮춤)|'review'(주변 실제 높이), view:'wide'|'semi'|'bird'|'persp', w, h, pr, labels }
// 좌표: x 동, y 북(m). three는 (x, 높이, -y)
(function (g) {
  const FH = 2.9, Z0 = 1.5;
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

  /* ---------- 하늘 ---------- */
  function skyCanvas(look) {
    const [c, x] = cv(1024, 512);
    const gr = x.createLinearGradient(0, 0, 0, 512);
    if (look === 'dusk') { gr.addColorStop(0, '#16244a'); gr.addColorStop(0.5, '#2f4c80'); gr.addColorStop(0.78, '#6f86ad'); gr.addColorStop(0.88, '#b9a7a0'); gr.addColorStop(0.94, '#eab07a'); gr.addColorStop(1, '#f6cf98'); }
    else { gr.addColorStop(0, '#3f78bd'); gr.addColorStop(0.7, '#8fb9e2'); gr.addColorStop(0.92, '#cfe0ec'); gr.addColorStop(1, '#eef3f4'); }
    x.fillStyle = gr; x.fillRect(0, 0, 1024, 512);
    // 구름(흐린 타원 여러 겹)
    for (let i = 0; i < 38; i++) {
      const cx = rnd() * 1024, cy = 330 + rnd() * 160, rw = 80 + rnd() * 220, rh = 7 + rnd() * 14;
      const gg = x.createRadialGradient(cx, cy, 0, cx, cy, rw);
      const lightUnder = look === 'dusk' ? `rgba(255,${170 + rnd() * 50},${110 + rnd() * 40},` : 'rgba(255,255,255,';
      const dark = look === 'dusk' ? 'rgba(70,80,110,' : 'rgba(255,255,255,';
      const col = cy > 440 ? lightUnder : (rnd() < 0.5 ? lightUnder : dark);
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = dusk ? 0.95 : 0.78;
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

    // 하늘(큰 구 안쪽에 그림) + 안개
    const skyC = skyCanvas(opt.look);
    const skyT = new THREE.CanvasTexture(skyC); skyT.encoding = THREE.sRGBEncoding;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(span * 40, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.set(cx, -span * 0.3, -cy); sky.rotation.y = -0.9; scene.add(sky);
    // 반사용 환경(하늘 그림)
    const pm = new THREE.PMREMGenerator(renderer); const envRT = pm.fromEquirectangular((() => { const t = new THREE.CanvasTexture(skyC); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding; return t; })());
    scene.environment = envRT.texture;
    const fogCol = dusk ? 0x46506a : 0xd5dee6;
    scene.fog = new THREE.Fog(fogCol, span * 3, span * 10); // 카메라 정한 뒤 다시 맞춤

    // 빛
    const hemi = new THREE.HemisphereLight(dusk ? 0x8a9cc6 : 0xdfeaf5, dusk ? 0x2e2620 : 0x8a8270, dusk ? 0.55 : 0.5); scene.add(hemi);
    const sun = new THREE.DirectionalLight(dusk ? 0xffa868 : 0xfff1dc, dusk ? 0.75 : 0.95); sun.castShadow = true;
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
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.1, -cy); ground.receiveShadow = true; scene.add(ground);
    const worldUV = (geo, flatY, B) => { // 항공사진 좌표로 UV
      B = B || aB; const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = flatY ? -p.getZ(i) : p.getY(i); uv[i * 2] = (X - B.x0) / (B.x1 - B.x0); uv[i * 2 + 1] = (Y - B.y0) / (B.y1 - B.y0); }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    };
    const aerPlane = (B, T, y) => {
      const pg = new THREE.PlaneGeometry(B.x1 - B.x0, B.y1 - B.y0, 1, 1); pg.rotateX(-Math.PI / 2); pg.translate((B.x0 + B.x1) / 2, y, -(B.y0 + B.y1) / 2);
      worldUV(pg, true, B); const m = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: T, roughness: 1 })); m.receiveShadow = true; scene.add(m);
    };
    if (D.aerialFar && D.aerialFar.img) aerPlane(D.aerialFar, aerTex(D.aerialFar), -0.06); // 바깥: 넓은 저해상도
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
    flat(S, pave, 0.05);
    if (fore) flat(fore, lawn, 0.03);
    const ring1 = mBuf(S, -4), ring2 = mBuf(S, -11), ring3 = mBuf(S, -14);
    if (ring1) flat(ring1, lawn, 0.07);
    // 단지 순환로(붉은 포장)
    if (ring2 && ring3) flat(ring2, STD(dusk ? 0x6d4a3e : 0xa8735f), 0.09, [ring3]);
    if (ring3) flat(ring3, lawn, 0.1);
    // 공원
    (D.parks || []).forEach(pk => flat(pk, lawn, 0.11));
    // 구역 경계선(검토 모드만)
    if (opt.mode === 'review') scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(S.map(p => V(p, 0.4))), new THREE.LineBasicMaterial({ color: 0xc8322b })));

    /* ----- 동 ----- */
    const accents = ['#9b7a52', '#6b4e3d', '#b08d57', '#566876', '#8a5a44'];
    const accentHex = accents.map(a => parseInt(a.slice(1), 16));
    const ccw = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? r : r.slice().reverse(); };
    const lit = dusk ? 0.42 : 0;
    const sets = accents.map(a => ({ front: facade('front', a, lit), side: facade('side', a, lit), base: facade('base', a, dusk ? 1 : 0), crown: facade('crown', a, lit * 0.6) }));
    const foot = [];
    const roofG = STD(dusk ? 0x5f7a48 : 0x8fb36a), roofP = STD(0xd9d5cc), parap = STD(0xeeebe4, { roughness: 0.6 });
    const glow = []; // 빛 점(가로등·옥탑)
    // 동 번호로 묶기(가장 가까운 라벨) → 같은 동은 같은 색
    const dongOf = b => { const c = turf.centroid(tp(b.ring)).geometry.coordinates; let bi = 0, bd = 1e9; (D.labels || []).forEach((l, i) => { const d = Math.hypot(l.c[0] - c[0], l.c[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    D.blds.forEach(b => {
      const di = dongOf(b), set = sets[di % sets.length], F = b.floors || 15;
      const zB = Z0 + 2 * FH, zC = Z0 + (F - 2) * FH, zT = Z0 + F * FH;
      const Rg = ccw(b.ring); foot.push(Rg);
      const band = (p, q, L, z0, z1, pair, nF, side) => {
        const nB = Math.max(1, Math.round(L / 3.3));
        const mat = new THREE.MeshStandardMaterial({ map: tex(pair[0], nB / 4, nF / 4), emissive: 0xffffff, emissiveMap: tex(pair[1], nB / 4, nF / 4), emissiveIntensity: dusk ? 1.0 : 0, roughness: side ? 0.85 : 0.5, metalness: side ? 0 : 0.15, envMapIntensity: dusk ? (side ? 0.15 : 0.45) : (side ? 0.3 : 0.6), color: dusk ? 0xdcd8d0 : 0xe6e6e6 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(L, z1 - z0), mat);
        const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L;
        m.position.set((p[0] + q[0]) / 2 + nx * 0.02, (z0 + z1) / 2, -((p[1] + q[1]) / 2 + ny * 0.02)); m.rotation.y = Math.atan2(nx, -ny);
        m.castShadow = true; m.receiveShadow = true; scene.add(m);
      };
      for (let i = 0; i < Rg.length; i++) {
        const p = Rg[i], q = Rg[(i + 1) % Rg.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.4) continue;
        const side = L < 7.5;
        band(p, q, L, Z0, zB, set.base, 2, false);
        band(p, q, L, zB, zC, side ? set.side : set.front, F - 4, side);
        band(p, q, L, zC, zT, side ? set.side : set.crown, 2, side);
        // 필로티 그늘
        const pmm = new THREE.Mesh(new THREE.PlaneGeometry(L, Z0), STD(0x2e3439)); const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L;
        pmm.position.set((p[0] + q[0]) / 2, Z0 / 2, -(p[1] + q[1]) / 2); pmm.rotation.y = Math.atan2(nx, -ny); scene.add(pmm);
      }
      const sh = new THREE.Shape(Rg.map(p => new THREE.Vector2(p[0], p[1])));
      const body = new THREE.ExtrudeGeometry(sh, { depth: zT - 0.05, bevelEnabled: false }); body.rotateX(-Math.PI / 2);
      const bm = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.BackSide })); bm.castShadow = true; scene.add(bm);
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
    foot.forEach(Rg => { const ring = mBuf(Rg, 2.5); if (!ring) return; for (let i = 0; i < ring.length; i += 2) if (rnd() < 0.7) shrubs.push([ring[i][0], ring[i][1], 0.5 + rnd() * 0.5]); });
    // 둘레 가로수
    for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 6) continue;
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
      for (let t = 3; t < L - 2; t += 8) { const px = a[0] + (b[0] - a[0]) * t / L, py = a[1] + (b[1] - a[1]) * t / L; for (const o of [3, -2]) { const qx = px + nx * o, qy = py + ny * o; if (o < 0 ? inPoly(qx, qy, siteF) : !inPoly(qx, qy, siteF)) trees.push([qx, qy, 0.95]); } }
    }
    const greens = dusk ? [0x3f5a2f, 0x4b6a35, 0x35502a, 0x5a7238, 0x6b6a35, 0x2f4a2a] : [0x5f8a4a, 0x6f9a52, 0x4f7a45, 0x86a85c, 0x9a8a4a, 0x3f6a3a];
    const lobe = new THREE.IcosahedronGeometry(1.6, 1);
    const crown = new THREE.InstancedMesh(lobe, STD(0xffffff, { roughness: 1 }), trees.length * 3);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 3, 5), STD(0x4a3b2e), trees.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3(), col = new THREE.Color();
    trees.forEach((t, i) => {
      const s = t[2] * 1.15, gcol = greens[Math.floor(rnd() * greens.length)];
      M.compose(P.set(t[0], 1.5 * s, -t[1]), Q, Sc.set(s, s, s)); trunk.setMatrixAt(i, M);
      for (let k = 0; k < 3; k++) {
        const ox = (rnd() - .5) * 1.8 * s, oz = (rnd() - .5) * 1.8 * s, oy = (3.4 + rnd() * 1.6) * s, ss = s * (0.9 + rnd() * 0.5);
        M.compose(P.set(t[0] + ox, oy, -t[1] + oz), Q, Sc.set(ss, ss * 0.85, ss)); crown.setMatrixAt(i * 3 + k, M);
        crown.setColorAt(i * 3 + k, col.setHex(gcol).offsetHSL(0, 0, (rnd() - .5) * 0.06));
      }
    });
    crown.castShadow = trunk.castShadow = true; crown.receiveShadow = true; scene.add(trunk); scene.add(crown);
    const shrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), STD(0xffffff, { roughness: 1 }), Math.max(1, shrubs.length));
    shrubs.forEach((t, i) => { M.compose(P.set(t[0], 0.4 * t[2], -t[1]), Q, Sc.set(t[2] * 1.4, t[2] * 0.7, t[2] * 1.4)); shrub.setMatrixAt(i, M); shrub.setColorAt(i, col.setHex(greens[Math.floor(rnd() * greens.length)]).offsetHSL(0.02, 0, 0.03)); });
    shrub.count = shrubs.length; shrub.receiveShadow = true; scene.add(shrub);

    /* ----- 가로등·조명 점 ----- */
    const lampPts = [];
    if (ring2) { const rr = mBuf(S, -12.5) || ring2; let acc = 0; for (let i = 0; i < rr.length; i++) { const a = rr[i], b = rr[(i + 1) % rr.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 1) { acc += 1; if (acc >= 14) { acc = 0; lampPts.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L, 4.5]); } } } }
    for (let i = 0; i < S.length; i++) { const a = S[i], b = S[(i + 1) % S.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; for (let t = 5; t < L; t += 22) lampPts.push([a[0] + (b[0] - a[0]) * t / L + nx * 6, a[1] + (b[1] - a[1]) * t / L + ny * 6, 8]); }
    // 단지 안 보행등(나무 사이)
    trees.forEach(t => { if (rnd() < 0.08 && inPoly(t[0], t[1], siteF)) lampPts.push([t[0] + 1.5, t[1] + 1.5, 1.2]); });
    const poleG = new THREE.CylinderGeometry(0.08, 0.1, 1, 5);
    const poles = new THREE.InstancedMesh(poleG, STD(0x2b2d30), lampPts.length);
    lampPts.forEach((l, i) => { M.compose(P.set(l[0], l[2] / 2, -l[1]), Q, Sc.set(1, l[2], 1)); poles.setMatrixAt(i, M); }); scene.add(poles);
    if (dusk) {
      const [gc, gx] = cv(64, 64); const gg = gx.createRadialGradient(32, 32, 0, 32, 32, 32); gg.addColorStop(0, 'rgba(255,240,200,1)'); gg.addColorStop(0.25, 'rgba(255,200,120,.55)'); gg.addColorStop(1, 'rgba(255,180,90,0)'); gx.fillStyle = gg; gx.fillRect(0, 0, 64, 64);
      const gt = new THREE.CanvasTexture(gc);
      const pos = new Float32Array(lampPts.length * 3); lampPts.forEach((l, i) => { pos[i * 3] = l[0]; pos[i * 3 + 1] = l[2] + 0.2; pos[i * 3 + 2] = -l[1]; });
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ map: gt, size: 5.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false })));
      // 바닥에 번지는 불빛(가로등 아래 둥근 빛)
      const [pc, px] = cv(64, 64); const pg2 = px.createRadialGradient(32, 32, 0, 32, 32, 32); pg2.addColorStop(0, 'rgba(255,190,110,.55)'); pg2.addColorStop(1, 'rgba(255,190,110,0)'); px.fillStyle = pg2; px.fillRect(0, 0, 64, 64);
      const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), lampPts.length);
      const qd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      lampPts.forEach((l, i) => { const r = l[2] > 3 ? 9 : 4; M.compose(P.set(l[0], 0.2, -l[1]), qd, Sc.set(r, r, 1)); pool.setMatrixAt(i, M); }); scene.add(pool);
    }

    /* ----- 사람·차 ----- */
    const people = [];
    if (ring3) for (let i = 0; i < ring3.length; i++) { const a = ring3[i], b = ring3[(i + 1) % ring3.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 4) if (rnd() < 0.35) people.push([a[0] + (b[0] - a[0]) * t / L + (rnd() - .5) * 2, a[1] + (b[1] - a[1]) * t / L + (rnd() - .5) * 2]); }
    const body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.22, 1.2, 6), STD(0xffffff), Math.max(1, people.length));
    const cloth = [0x2f4b7c, 0xc0392b, 0xe8c547, 0x2e8b57, 0x34495e, 0xe67e22, 0xf2f2f2, 0x8e44ad];
    people.forEach((p, i) => { M.compose(P.set(p[0], 0.75, -p[1]), Q, Sc.set(1, 1, 1)); body.setMatrixAt(i, M); body.setColorAt(i, col.setHex(cloth[Math.floor(rnd() * cloth.length)])); });
    body.count = people.length; body.castShadow = true; scene.add(body);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 5), STD(0xd9b08c), Math.max(1, people.length));
    people.forEach((p, i) => { M.compose(P.set(p[0], 1.55, -p[1]), Q, Sc.set(1, 1, 1)); heads.setMatrixAt(i, M); }); heads.count = people.length; scene.add(heads);
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
    const camera = new THREE.PerspectiveCamera(30, W / H, 1, span * 60);
    if (opt.view === 'persp') {
      // 투시도: 남쪽 멀리(구역 폭의 1.5배) 높이 12m에서, 하늘이 화면 절반
      const ep = EYE;
      camera.fov = 42; camera.position.set(ep[0], 6, -ep[1]);
      camera.lookAt(new THREE.Vector3(cx, 48, -cy));
    } else {
      const v = views[opt.view] || views.bird, look = new THREE.Vector3(cx, v.y, -cy), dist = span * v.d;
      camera.fov = v.fov; camera.position.set(look.x + dist * Math.cos(v.el) * Math.sin(v.az), look.y + dist * Math.sin(v.el), look.z + dist * Math.cos(v.el) * Math.cos(v.az)); camera.lookAt(look);
    }
    camera.updateProjectionMatrix();
    { const cd = camera.position.distanceTo(new THREE.Vector3(cx, 0, -cy)); scene.fog.near = cd * (opt.view === 'persp' ? 1.3 : 0.95); scene.fog.far = cd * (opt.view === 'wide' ? 2.6 : 4); }

    /* ----- 후처리: 빛 번짐 + 가장자리 어둡게 ----- */
    let draw = () => renderer.render(scene, camera);
    if (THREE.EffectComposer && THREE.UnrealBloomPass) {
      const rt = new THREE.WebGLMultisampleRenderTarget(W * opt.pr, H * opt.pr, { format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding });
      const comp = new THREE.EffectComposer(renderer, rt); comp.setPixelRatio(opt.pr); comp.setSize(W, H);
      comp.addPass(new THREE.RenderPass(scene, camera));
      if (dusk) comp.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.45, 0.93));
      if (THREE.ShaderPass) {
        comp.addPass(new THREE.ShaderPass({
          uniforms: { tDiffuse: { value: null }, amt: { value: dusk ? 0.55 : 0.35 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader: 'uniform sampler2D tDiffuse; uniform float amt; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); vec2 d=vUv-0.5; float v=1.0-amt*dot(d,d)*1.6; gl_FragColor=vec4(c.rgb*v,c.a); }',
        }));
      }
      draw = () => comp.render();
    }
    draw();
    return { png: () => renderer.domElement.toDataURL('image/png'), counts: { trees: trees.length, shrubs: shrubs.length, people: people.length, cars: cars.length, lamps: lampPts.length } };
  }
  g.JbsBird = { render };
})(typeof window !== 'undefined' ? window : globalThis);
