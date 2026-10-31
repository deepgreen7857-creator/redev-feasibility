'use strict';
// 3D 매스 보기 — /arch(배치 확인)와 /landscape(조망·스카이라인)가 같이 씀. three.js r128 필요
// Mass3D.create(div, {site:[[x,y]...], buildings:[{poly,h,label,color}], context:[{poly,h}], sunHour, lat})
(function (g) {
  function create(el, data) {
    const W = () => el.clientWidth || 800, Hh = () => el.clientHeight || 480;
    const scene = new THREE.Scene();
    const css = getComputedStyle(document.documentElement);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    scene.background = new THREE.Color(dark ? 0x1b2328 : 0xeef1ec);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W(), Hh());
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.innerHTML = ''; el.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(40, W() / Hh(), 1, 6000);
    // 좌표: x 동, z 남(three는 y가 위). 구역 좌표 (x, y북) → (x, 0, -y)
    const V = (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]);
    const xs = data.site.map(p => p[0]), ys = data.site.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 100);
    const target = new THREE.Vector3(cx, 20, -cy);

    // 땅·구역
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.MeshLambertMaterial({ color: dark ? 0x26313a : 0xdfe4dc }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, -cy); ground.receiveShadow = true; scene.add(ground);
    const shape = new THREE.Shape(data.site.map(p => new THREE.Vector2(p[0], p[1])));
    const lot = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: dark ? 0x2f3d33 : 0xcfdcc6 }));
    lot.rotation.x = -Math.PI / 2; lot.position.y = 0.05; lot.receiveShadow = true; scene.add(lot);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(data.site.map(p => V(p, 0.2))), new THREE.LineDashedMaterial({ color: 0xc8322b, dashSize: 6, gapSize: 3 }));
    line.computeLineDistances(); scene.add(line);

    const group = new THREE.Group(); scene.add(group);
    function prism(poly, h, color, opacity = 1) {
      const sh = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }));
      m.castShadow = true; m.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: dark ? 0x0d1215 : 0x5b6770, transparent: true, opacity: .5 }));
      const gg = new THREE.Group(); gg.add(m); gg.add(edges); return gg;
    }
    function setBuildings(blds, context) {
      while (group.children.length) group.remove(group.children[0]);
      (context || []).forEach(c => group.add(prism(c.poly, c.h, dark ? 0x4a5359 : 0xb9bfbd, 0.9)));
      blds.forEach(b => group.add(prism(b.poly, b.h, b.color || 0xf2f0ea)));
    }
    setBuildings(data.buildings, data.context);

    // 빛: 동지 해 위치
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9488, 0.55));
    const sunL = new THREE.DirectionalLight(0xffffff, 0.75); sunL.castShadow = true;
    sunL.shadow.mapSize.set(2048, 2048);
    const sc = sunL.shadow.camera; sc.left = -span * 1.6; sc.right = span * 1.6; sc.top = span * 1.6; sc.bottom = -span * 1.6; sc.near = 1; sc.far = span * 8;
    scene.add(sunL); scene.add(sunL.target); sunL.target.position.copy(target);
    function setSun(hour, lat = 37.46) {
      const s = ArchGeom.sun(lat, hour);
      const d = span * 3, alt = Math.max(0.02, s.alt);
      // 해는 남(az=0)에 있을 때 -y쪽(three에서는 +z쪽)
      sunL.position.set(target.x - d * Math.cos(alt) * Math.sin(s.az), d * Math.sin(alt), target.z + d * Math.cos(alt) * Math.cos(s.az));
      sunL.intensity = s.alt > 0 ? 0.8 : 0.05;
      draw();
    }

    // 카메라 조작: 끌기=회전, 휠=확대, 오른쪽 끌기=이동
    let az = -0.6, el2 = 0.62, dist = span * 2.1, mode = 'orbit', eye = null;
    function place() {
      if (mode === 'eye' && eye) { camera.position.copy(eye.pos); camera.lookAt(eye.look); return; }
      camera.position.set(target.x + dist * Math.cos(el2) * Math.sin(az), target.y + dist * Math.sin(el2), target.z + dist * Math.cos(el2) * Math.cos(az));
      camera.lookAt(target);
    }
    function draw() { place(); renderer.render(scene, camera); }
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }; renderer.domElement.setPointerCapture(e.pointerId); });
    renderer.domElement.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (mode === 'eye') { const yaw = -dx * 0.004; const v = eye.look.clone().sub(eye.pos); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); eye.look.copy(eye.pos).add(v); draw(); return; }
      if (drag.b === 2 || drag.shift) { const r = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)); const f = new THREE.Vector3(Math.sin(az), 0, Math.cos(az)); target.add(r.multiplyScalar(-dx * dist / 800)).add(f.multiplyScalar(-dy * dist / 800)); }
      else { az -= dx * 0.006; el2 = Math.max(0.08, Math.min(1.45, el2 + dy * 0.005)); }
      draw();
    });
    renderer.domElement.addEventListener('pointerup', () => { drag = null; });
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'eye') return; dist = Math.max(40, Math.min(span * 8, dist * (e.deltaY > 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
    const ro = new ResizeObserver(() => { renderer.setSize(W(), Hh()); camera.aspect = W() / Hh(); camera.updateProjectionMatrix(); draw(); }); ro.observe(el);

    setSun(data.sunHour || 12, data.lat);
    return {
      setBuildings: (b, c) => { setBuildings(b, c); draw(); },
      setSun,
      bird(a = -0.6, e = 0.62) { mode = 'orbit'; az = a; el2 = e; draw(); },
      // 조망점 시점: 눈높이 1.6m에서 구역 중심을 봄
      eyeAt(p, h = 1.6, fov = 60) { mode = 'eye'; camera.fov = fov; camera.updateProjectionMatrix(); eye = { pos: V(p, h), look: new THREE.Vector3(cx, 25, -cy) }; draw(); },
      orbit() { mode = 'orbit'; camera.fov = 40; camera.updateProjectionMatrix(); draw(); },
      png() { draw(); return renderer.domElement.toDataURL('image/png'); },
      dispose() { ro.disconnect(); renderer.dispose(); },
    };
  }
  g.Mass3D = { create };
})(window);
