'use strict';
// 조감도 그리기(개략, 2026-11-07 첫 판) — three.js r128 + turf 6.5. 모형 모드(주변 낮은 흰 블록)·검토 모드(주변 실제 높이)·눈높이 시점
// 아직 화면에 안 붙음(인계 7번). 용현유원 실제 배치(동 날개별 층수)로 노트북 크롬에서 시험함 — 그 자료는 외부 게시 금지라 저장소에 넣지 않음
// JbsBird.render(el, data, opt)
//  data = { site:[[x,y]...], blds:[{ring:[[x,y]...](동 날개 바닥), floors, top(옥탑 표시)}], labels:[{label,c,top}], parks:[[[x,y]...]], ctx:[{poly,floors}], roads:[[[x,y]...]] }
//  opt  = { mode:'model'(모형: 주변 낮춤) | 'review'(검토: 주변 실제 높이), view:'bird'|'eye', w, h, sunHour, title, note }
(function (g) {
  const FH = 2.9;               // 층고
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7); // 고정 난수(같은 그림이 나오게)

  function facadeTex(kind) {
    // 한 칸(폭 약 3.3m) × 한 층 그림: 벽·유리·난간
    const c = document.createElement('canvas'); c.width = 128; c.height = 112;
    const x = c.getContext('2d');
    if (kind === 'side') {
      x.fillStyle = '#eceae4'; x.fillRect(0, 0, 128, 112);
      x.fillStyle = '#7f909c'; x.fillRect(48, 34, 32, 40);
      x.fillStyle = '#d9d6ce'; x.fillRect(0, 104, 128, 8);
      return c;
    }
    x.fillStyle = '#f3f1ec'; x.fillRect(0, 0, 128, 112);
    // 유리(하늘이 비친 색)
    const gr = x.createLinearGradient(0, 18, 0, 92); gr.addColorStop(0, '#9fb6c6'); gr.addColorStop(1, '#5d7384');
    x.fillStyle = gr; x.fillRect(10, 16, 108, 76);
    x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(12, 18, 40, 30);
    // 창틀
    x.fillStyle = '#e8e6e0'; x.fillRect(62, 16, 4, 76); x.fillRect(10, 52, 108, 3);
    // 난간 유리·띠
    x.fillStyle = 'rgba(210,222,228,.55)'; x.fillRect(6, 70, 116, 22);
    x.fillStyle = '#d4d0c7'; x.fillRect(0, 96, 128, 16);
    return c;
  }
  function roofTex() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#c9cbc6'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#b9bbb5'; x.strokeRect(0.5, 0.5, 63, 63); return c;
  }
  function skyTex() {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#7fa9d6'); gr.addColorStop(0.55, '#c4daec'); gr.addColorStop(1, '#eef2f0');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); return t;
  }

  function render(el, data, opt) {
    opt = Object.assign({ mode: 'model', view: 'bird', w: 1600, h: 1000, sunHour: 10.5, az: -0.55, elev: 0.4, distK: 1.85 }, opt || {});
    const W = opt.w, H = opt.h;
    const scene = new THREE.Scene();
    scene.background = skyTex();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(opt.pr || 1); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    el.innerHTML = ''; el.appendChild(renderer.domElement);

    const clean = r => { const o = []; (r || []).forEach(p => { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) o.push(p); }); while (o.length > 3 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.3) o.pop(); return o; };
    data = Object.assign({}, data, { site: clean(data.site), parks: (data.parks || []).map(clean), blds: (data.blds || []).map(b => Object.assign({}, b, { ring: clean(b.ring) })) });
    const V = (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]);
    const S = data.site, xs = S.map(p => p[0]), ys = S.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    scene.fog = new THREE.Fog(0xe9eef0, span * 2.2, span * 6);
    const turfPoly = ring => turf.polygon([[...ring, ring[0]]]);
    // turf 버퍼는 경위도 기준이라, 미터 좌표를 잠깐 도 단위로 바꿔서 씀
    const K = 111320, mBuf = (ring, m) => {
      try {
        const f = turf.buffer(turf.polygon([[...ring, ring[0]].map(p => [p[0] / K, p[1] / K])]), m / 1000, { units: 'kilometers' });
        if (!f) return null; const g2 = f.geometry; const c = g2.type === 'Polygon' ? g2.coordinates[0] : g2.coordinates.sort((a, b) => b[0].length - a[0].length)[0][0];
        return c.slice(0, -1).map(p => [p[0] * K, p[1] * K]);
      } catch (e) { return null; }
    };
    const siteF = turfPoly(S);

    // 땅
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 30, span * 30), new THREE.MeshLambertMaterial({ color: 0xe7e3da }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.05, -cy); ground.receiveShadow = true; scene.add(ground);
    const flat = (ring, color, y, mat) => {
      const sh = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], p[1])));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat || new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m); return m;
    };
    // 도로
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x8d9094 });
    (data.roads || []).forEach(r => { if (r.length > 2) flat(r, null, 0.02, roadMat); });
    // 단지 바닥: 조경(초록) + 둘레 보행로(베이지)
    flat(S, 0x9fb889, 0.05);
    let inner = mBuf(S, -7); if (inner) inner.push(inner[0]);
    if (inner) {
      // 둘레 산책로 띠: 바깥 9m 안쪽 = 산책로 → 다시 그 안쪽 = 잔디
      flat(S, 0xd9cdb4, 0.06);
      flat(inner.slice(0, -1), 0x9fb889, 0.07);
    }
    // 구역 경계선
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(S.map(p => V(p, 0.3))), new THREE.LineBasicMaterial({ color: opt.mode === 'review' ? 0xc8322b : 0xb07a3a }));
    scene.add(line);

    // 주변 건물: 모형 = 낮은 흰 블록(위치만), 검토 = 실제 높이 회색
    const ctxMat = opt.mode === 'model'
      ? new THREE.MeshLambertMaterial({ color: 0xf7f6f2 })
      : new THREE.MeshLambertMaterial({ color: 0xb7bcbd });
    const edgeMat = new THREE.LineBasicMaterial({ color: opt.mode === 'model' ? 0xc9c6bd : 0x7d8588, transparent: true, opacity: .7 });
    (data.ctx || []).forEach(c => {
      if (!c.poly || c.poly.length < 3) return;
      const h = opt.mode === 'model' ? Math.min(4.5, 1.5 + (c.floors || 1) * 0.8) : Math.max(3, (c.floors || 1) * 3);
      const sh = new THREE.Shape(c.poly.map(p => new THREE.Vector2(p[0], p[1])));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, ctxMat); m.castShadow = opt.mode !== 'model'; m.receiveShadow = true; scene.add(m);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));
    });

    // 우리 단지 동: 세대 칸마다 상자, 정면은 창 무늬
    const fCanvas = facadeTex('front'), sCanvas = facadeTex('side');
    const roofMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(roofTex()) });
    const pilMat = new THREE.MeshLambertMaterial({ color: 0x6f7a80 });
    const accent = [0x8a6a52, 0x5d6f7c, 0x7b7f6a];
    const foot = []; // 나무·사람 피할 자리
    function wallMat(canvas, rx, ry) {
      const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
      t.encoding = THREE.sRGBEncoding;
      return new THREE.MeshLambertMaterial({ map: t });
    }
    // 동 날개(다각형) — 변마다 벽면을 세우고 창 무늬를 변 길이·층수에 맞춰 반복
    const parMat = new THREE.MeshLambertMaterial({ color: 0xe9e6df });
    const ccw = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? r : r.slice().reverse(); };
    (data.blds || []).forEach((b, bi) => {
      const F = b.floors || 15, z0 = 1.5, z1 = z0 + F * FH;
      const R = ccw(b.ring); foot.push(R);
      for (let i = 0; i < R.length; i++) {
        const p = R[i], q = R[(i + 1) % R.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.4) continue;
        const front = L >= 7.5;
        const mat = wallMat(front ? fCanvas : sCanvas, Math.max(1, Math.round(L / 3.3)), F);
        const geo = new THREE.PlaneGeometry(L, z1 - z0);
        const m = new THREE.Mesh(geo, mat);
        // 바깥 법선(시계 반대 둘레 → 오른쪽이 바깥)
        const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L;
        m.position.set((p[0] + q[0]) / 2, (z0 + z1) / 2, -(p[1] + q[1]) / 2);
        m.rotation.y = Math.atan2(nx, -ny);
        m.castShadow = true; m.receiveShadow = true; scene.add(m);
        // 필로티 띠
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(L, z0), pilMat); pm.position.set(m.position.x, z0 / 2, m.position.z); pm.rotation.y = m.rotation.y; scene.add(pm);
      }
      const sh = new THREE.Shape(R.map(p => new THREE.Vector2(p[0], p[1])));
      // 지붕·속채움(그림자용)
      const body = new THREE.ExtrudeGeometry(sh, { depth: z1 - 0.05, bevelEnabled: false }); body.rotateX(-Math.PI / 2);
      const bm = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ color: 0xd8d5ce, side: THREE.BackSide })); bm.castShadow = true; scene.add(bm);
      const roof = new THREE.Mesh(new THREE.ShapeGeometry(sh), roofMat); roof.rotation.x = -Math.PI / 2; roof.position.y = z1; roof.receiveShadow = true; scene.add(roof);
      const par = new THREE.ExtrudeGeometry(sh, { depth: 1.1, bevelEnabled: false }); par.rotateX(-Math.PI / 2);
      const parm = new THREE.Mesh(par, parMat); parm.position.y = z1; parm.scale.set(1, 1, 1); scene.add(parm);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(par, 30), new THREE.LineBasicMaterial({ color: 0xbdb8ad })));
      // 가장 높은 날개 위 옥탑 포인트
      if (b.top) {
        const c = turf.centroid(turfPoly(R)).geometry.coordinates;
        const ot = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6, 8), new THREE.MeshLambertMaterial({ color: accent[bi % accent.length] }));
        ot.position.set(c[0], z1 + 3.5, -c[1]); ot.castShadow = true; scene.add(ot);
      }
      // 동 번호
      if (b.label && opt.labels !== false) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const x = cv.getContext('2d');
        x.fillStyle = 'rgba(255,255,255,.88)'; x.fillRect(0, 0, 256, 96); x.fillStyle = '#333'; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.fillText(b.label, 128, 62);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
        const c = turf.centroid(turfPoly(R)).geometry.coordinates; sp.position.set(c[0], z1 + 12, -c[1]); sp.scale.set(16, 6, 1); scene.add(sp);
      }
    });
    (data.labels || []).forEach(l => {
      if (opt.labels === false) return;
      const cv = document.createElement('canvas'); cv.width = 300; cv.height = 90; const x = cv.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(0, 0, 300, 90); x.fillStyle = '#2b2f33'; x.font = 'bold 46px sans-serif'; x.textAlign = 'center'; x.fillText(l.label, 150, 62);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
      sp.position.set(l.c[0], 1.5 + l.top * FH + 14, -l.c[1]); sp.scale.set(20, 6, 1); scene.add(sp);
    });
    // 공원
    (data.parks || []).forEach(pk => flat(pk, 0x7fa86a, 0.08));

    // 나무(구역 안, 동 바깥 4m, 격자 + 흔들기)
    const bufFoot = foot.map(q => { const r = mBuf(q, 5); return turfPoly(r || q); }); const fb = bufFoot.map(f => turf.bbox(f));
    const nearB = (x, y) => bufFoot.some((f, i) => x >= fb[i][0] && x <= fb[i][2] && y >= fb[i][1] && y <= fb[i][3] && turf.booleanPointInPolygon([x, y], f));
    const trees = [], people = [];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let x = x0; x <= x1; x += 10) for (let y = y0; y <= y1; y += 10) {
      const px = x + (rnd() - .5) * 5, py = y + (rnd() - .5) * 5;
      if (!turf.booleanPointInPolygon([px, py], siteF) || nearB(px, py)) continue;
      if (rnd() < 0.6) trees.push([px, py, 0.75 + rnd() * 0.6]);
    }
    // 둘레 가로수(바깥 4m)
    for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 6) continue;
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; // 바깥(시계 반대 둘레 기준)
      for (let t = 4; t < L - 2; t += 9) { const px = a[0] + (b[0] - a[0]) * t / L + nx * 4, py = a[1] + (b[1] - a[1]) * t / L + ny * 4; if (!turf.booleanPointInPolygon([px, py], siteF)) trees.push([px, py, 0.9]); }
    }
    const trunkG = new THREE.CylinderGeometry(0.18, 0.25, 2.6, 5), crownG = new THREE.IcosahedronGeometry(2.4, 1);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6b5a48 }), trees.length);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const greens = [0x5f8a4a, 0x6f9a52, 0x4f7a45, 0x86a85c, 0x9a8a4a];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3(), P = new THREE.Vector3(), col = new THREE.Color();
    trees.forEach((t, i) => {
      const s = t[2];
      M.compose(P.set(t[0], 1.3 * s, -t[1]), Q, Sc.set(s, s, s)); trunk.setMatrixAt(i, M);
      M.compose(P.set(t[0], (2.6 + 1.8) * s, -t[1]), Q, Sc.set(s, s * 1.15, s)); crown.setMatrixAt(i, M);
      crown.setColorAt(i, col.setHex(greens[Math.floor(rnd() * greens.length)]));
    });
    trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true; scene.add(trunk); scene.add(crown);

    // 사람(산책로·동 앞)
    if (inner) {
      const ring = inner.slice(0, -1);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t < L; t += 5) if (rnd() < 0.45) {
          const k = t / L, o = 2 + rnd() * 5; const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
          people.push([a[0] + (b[0] - a[0]) * k - nx * o, a[1] + (b[1] - a[1]) * k - ny * o]);
        }
      }
    }
    foot.forEach(q => { if (rnd() < 0.5) { const c = turf.centroid(turfPoly(q)).geometry.coordinates; for (let k = 0; k < 2; k++) people.push([c[0] + (rnd() - .5) * 14, c[1] - 9 - rnd() * 4]); } });
    const bodyG = new THREE.CylinderGeometry(0.28, 0.24, 1.15, 6), headG = new THREE.SphereGeometry(0.2, 6, 5);
    const body = new THREE.InstancedMesh(bodyG, new THREE.MeshLambertMaterial({ color: 0xffffff }), people.length);
    const head = new THREE.InstancedMesh(headG, new THREE.MeshLambertMaterial({ color: 0xe0b896 }), people.length);
    const cloth = [0x2f4b7c, 0xc0392b, 0xf1c40f, 0x2e8b57, 0x34495e, 0xe67e22, 0xecf0f1, 0x8e44ad];
    people.forEach((p, i) => {
      M.compose(P.set(p[0], 0.75, -p[1]), Q, Sc.set(1, 1, 1)); body.setMatrixAt(i, M); body.setColorAt(i, col.setHex(cloth[Math.floor(rnd() * cloth.length)]));
      M.compose(P.set(p[0], 1.55, -p[1]), Q, Sc.set(1, 1, 1)); head.setMatrixAt(i, M);
    });
    body.castShadow = true; scene.add(body); scene.add(head);

    // 차(도로 위)
    const cars = [];
    (data.roads || []).forEach(r => {
      if (r.length < 3) return; let best = 0, ang = 0;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
      const area = Math.abs(turf.area(turfPoly(r))); const n = Math.min(6, Math.floor(area / 900));
      const bb = turf.bbox(turfPoly(r));
      for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
        const px = bb[0] + rnd() * (bb[2] - bb[0]), py = bb[1] + rnd() * (bb[3] - bb[1]);
        if (Math.hypot(px - cx, py - cy) > span * 1.4) continue;
        if (turf.booleanPointInPolygon([px, py], turfPoly(r))) { cars.push([px, py, ang]); k++; }
      }
    });
    const carG = new THREE.BoxGeometry(4.4, 1.4, 1.85);
    const car = new THREE.InstancedMesh(carG, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, cars.length));
    const carC = [0xf5f5f5, 0x222222, 0x9aa3a8, 0x1f3b6b, 0x8b1e1e, 0xd9d9d9];
    cars.forEach((c, i) => { Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c[2]); M.compose(P.set(c[0], 0.8, -c[1]), Q, Sc.set(1, 1, 1)); car.setMatrixAt(i, M); car.setColorAt(i, col.setHex(carC[Math.floor(rnd() * carC.length)])); });
    Q.identity(); car.count = cars.length; car.castShadow = true; scene.add(car);

    // 빛: 하늘빛 + 해(가을 오전, 남동)
    scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x9a927f, 0.62));
    const sun = new THREE.DirectionalLight(0xfff3e2, 0.95); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
    const sc = sun.shadow.camera, R = span * 1.2; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = span * 10;
    const tgt = new THREE.Vector3(cx, 0, -cy);
    const sAz = (opt.sunHour - 12) * 15 * Math.PI / 180, sAlt = 0.62; // 남 기준 방위
    const d = span * 3;
    sun.position.set(tgt.x + d * Math.cos(sAlt) * Math.sin(sAz), d * Math.sin(sAlt), tgt.z + d * Math.cos(sAlt) * Math.cos(sAz));
    sun.target.position.copy(tgt); scene.add(sun); scene.add(sun.target);

    // 카메라
    const camera = new THREE.PerspectiveCamera(opt.view === 'eye' ? 50 : 32, W / H, 1, span * 20);
    const look = new THREE.Vector3(cx, opt.view === 'eye' ? 40 : 30, -cy);
    if (opt.view === 'eye') {
      const ep = opt.eye || [cx - span * 0.55, cy - span * 0.8];
      camera.position.set(ep[0], 1.6, -ep[1]); camera.lookAt(look);
    } else {
      const dist = span * opt.distK;
      camera.position.set(look.x + dist * Math.cos(opt.elev) * Math.sin(opt.az), look.y + dist * Math.sin(opt.elev), look.z + dist * Math.cos(opt.elev) * Math.cos(opt.az));
      camera.lookAt(look);
    }
    renderer.render(scene, camera);
    return { renderer, scene, camera, png: () => renderer.domElement.toDataURL('image/png'), counts: { trees: trees.length, people: people.length, cars: cars.length } };
  }
  g.JbsBird = { render };
})(window);
