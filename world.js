'use strict';
/* Three.js world: sky, terrain, airport, aircraft model, cameras, day/night. */
(function (global) {
  const FS = global.FlightSim;
  const { terrainHeight, qrot, smooth, clamp } = FS;
  const RW_LEN = 1800, RW_W = 30;

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }

  class World {
    constructor(container) {
      this.R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(this.R.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 60000);
      this.timeOfDay = 14; this.camMode = 0; this.camNames = ['Cockpit', 'Chase', 'External', 'Tower'];
      this.orbitYaw = 0.6; this.orbitPitch = 0.25; this.look = { yaw: 0, pitch: 0 };
      this.fogColor = new THREE.Color(0xb8d4ee);
      this.scene.fog = new THREE.Fog(this.fogColor, 3000, 24000);
      this.buildLights(); this.buildSky(); this.buildTerrain(); this.buildAirport();
      this.buildScenery(); this.buildClouds(); this.buildAircraft();
      this.camPos = new THREE.Vector3(); this.camQ = new THREE.Quaternion(); this.camInit = false;
      this.setTime(this.timeOfDay);
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.R.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }

    buildLights() {
      this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4b6b3a, 0.8);
      this.sun = new THREE.DirectionalLight(0xfff2d8, 1.0);
      this.scene.add(this.hemi, this.sun);
      this.landLight = new THREE.SpotLight(0xfff4d0, 0, 900, 0.35, 0.5, 1.0);
      this.landTarget = new THREE.Object3D();
      this.scene.add(this.landLight, this.landTarget); this.landLight.target = this.landTarget;
    }

    buildSky() {
      const geo = new THREE.SphereGeometry(40000, 32, 16);
      this.skyU = { top: { value: new THREE.Color(0x2a6ccf) }, hor: { value: new THREE.Color(0xb8d4ee) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2d0) } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol;' +
          'void main(){ float h=clamp(vP.y,-0.2,1.0); float t=pow(max(h,0.0),0.55); vec3 c=mix(hor,top,t); if(vP.y<0.0) c=mix(hor,hor*0.85,clamp(-vP.y*4.0,0.0,1.0));' +
          'float s=max(dot(normalize(vP),normalize(sunDir)),0.0); c+=sunCol*(pow(s,600.0)*2.0+pow(s,12.0)*0.25); gl_FragColor=vec4(c,1.0);} '
      });
      this.sky = new THREE.Mesh(geo, mat); this.sky.renderOrder = -10; this.scene.add(this.sky);
      // stars
      const n = 1200, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(a) * r * 38000; pos[i * 3 + 1] = Math.abs(u) * 38000; pos[i * 3 + 2] = Math.sin(a) * r * 38000;
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
      this.stars = new THREE.Points(sg, this.starMat); this.scene.add(this.stars);
    }

    buildTerrain() {
      this.TN = 192; this.TC = 130; // segments, cell size (m)
      const size = this.TN * this.TC;
      const g = new THREE.PlaneGeometry(size, size, this.TN, this.TN); g.rotateX(-Math.PI / 2);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.terrainGeo = g; this.tcx = 1e9; this.tcz = 1e9;
      const tex = canvasTex(256, 256, (c, w, h) => {
        const id = c.createImageData(w, h);
        for (let i = 0; i < w * h; i++) { const v = 200 + Math.random() * 55; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
        c.putImageData(id, 0, 0);
        for (let k = 0; k < 400; k++) { c.fillStyle = 'rgba(' + (k % 2 ? '255,255,255' : '90,90,90') + ',0.12)'; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 0, 7); c.fill(); }
      }, true);
      this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }));
      this.terrain.frustumCulled = false; this.scene.add(this.terrain);
      this.updateTerrain(0, 0, true);
    }
    updateTerrain(px, pz, force) {
      const C = this.TC, step = C * 8;
      const cx = Math.round(px / step) * step, cz = Math.round(pz / step) * step;
      if (!force && Math.abs(cx - this.tcx) < 1 && Math.abs(cz - this.tcz) < 1) return;
      this.tcx = cx; this.tcz = cz;
      const g = this.terrainGeo, pos = g.attributes.position, col = g.attributes.color;
      const uv = g.attributes.uv;
      const half = this.TN * C / 2;
      const grass = [0.33, 0.52, 0.2], dry = [0.5, 0.46, 0.25], rock = [0.45, 0.42, 0.38], snow = [0.92, 0.93, 0.96];
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i), lz = pos.getZ(i);
        // snap vertices to the global grid so heights do not swim
        const wx = cx + Math.round(lx / C) * C, wz = cz + Math.round(lz / C) * C;
        const h = terrainHeight(wx, wz);
        pos.setXYZ(i, wx, h - 0.05, wz);
        const n = FS.vnoise(wx / 260, wz / 260) * 0.25 + FS.vnoise(wx / 40, wz / 40) * 0.1;
        let c;
        const hh = h + n * 25;
        if (hh < 150) c = grass; else if (hh < 480) c = dry; else if (hh < 900) c = rock; else c = snow;
        const t = hh < 150 ? 0 : hh < 480 ? (hh - 150) / 330 : hh < 900 ? (hh - 480) / 420 : 0;
        const c2 = hh < 150 ? dry : hh < 480 ? rock : hh < 900 ? snow : snow;
        const k = 0.85 + n * 0.5;
        col.setXYZ(i, (c[0] + (c2[0] - c[0]) * (hh < 150 ? hh / 150 * 0.4 : t)) * k, (c[1] + (c2[1] - c[1]) * (hh < 150 ? hh / 150 * 0.4 : t)) * k, (c[2] + (c2[2] - c[2]) * (hh < 150 ? hh / 150 * 0.4 : t)) * k);
        uv.setXY(i, wx / 55, wz / 55);
      }
      pos.needsUpdate = true; col.needsUpdate = true; uv.needsUpdate = true;
      g.computeVertexNormals(); g.computeBoundingSphere();
      this.terrain.position.set(0, 0, 0);
    }

    buildAirport() {
      const A = new THREE.Group(); this.scene.add(A); this.airport = A;
      // runway texture: length along local X after rotation => draw horizontally
      const rwTex = canvasTex(2048, 128, (c, w, h) => {
        c.fillStyle = '#3a3b3e'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 3000; i++) { c.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255' : '0,0,0') + ',0.04)'; c.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
        c.fillStyle = '#e8e8e8';
        for (let x = 150; x < w - 150; x += 70) c.fillRect(x, h / 2 - 1.5, 40, 3);
        c.fillRect(0, 3, w, 2); c.fillRect(0, h - 5, w, 2);
        // threshold bars both ends
        for (let e = 0; e < 2; e++) for (let i = 0; i < 8; i++) { const y = 14 + i * ((h - 28) / 7) - 3; c.fillRect(e ? w - 52 : 12, y, 40, 6); }
        // aiming points
        c.fillRect(w * 0.15, 30, 60, 14); c.fillRect(w * 0.15, h - 44, 60, 14);
        c.fillRect(w * 0.85 - 60, 30, 60, 14); c.fillRect(w * 0.85 - 60, h - 44, 60, 14);
        // numbers
        c.font = 'bold 40px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.save(); c.translate(100, h / 2); c.rotate(Math.PI / 2); c.fillText('18', 0, 0); c.restore();
        c.save(); c.translate(w - 100, h / 2); c.rotate(-Math.PI / 2); c.fillText('36', 0, 0); c.restore();
      });
      const rgeo = new THREE.PlaneGeometry(RW_LEN, RW_W); rgeo.rotateX(-Math.PI / 2); rgeo.rotateY(Math.PI / 2); // long axis along z, '36' end at north (-z)
      const rw = new THREE.Mesh(rgeo, new THREE.MeshPhongMaterial({ map: rwTex, shininess: 5, specular: 0x222222 }));
      rw.position.y = 0.04; A.add(rw);
      this.runway = rw;
      // apron / taxiway
      const asphalt = new THREE.MeshPhongMaterial({ color: 0x4a4b4f, shininess: 3, specular: 0x111111 });
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), asphalt); apron.rotation.x = -Math.PI / 2; apron.position.set(-110, 0.03, 120); A.add(apron);
      const taxi = new THREE.Mesh(new THREE.PlaneGeometry(18, 260), asphalt); taxi.rotation.x = -Math.PI / 2; taxi.position.set(-55, 0.03, 80); A.add(taxi);
      for (const z of [-20, 160, 340]) { const t = new THREE.Mesh(new THREE.PlaneGeometry(60, 14), asphalt); t.rotation.x = -Math.PI / 2; t.position.set(-30, 0.03, z); A.add(t); }
      // hangars
      const hm = new THREE.MeshLambertMaterial({ color: 0xaab2b8 }), rm = new THREE.MeshLambertMaterial({ color: 0x7a3b32 });
      for (let i = 0; i < 3; i++) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(38, 11, 30), hm); h.position.set(-150, 5.5, 90 + i * 45); A.add(h);
        const r = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 32), rm); r.position.set(-150, 11.6, 90 + i * 45); A.add(r);
      }
      // terminal + tower
      const term = new THREE.Mesh(new THREE.BoxGeometry(60, 9, 22), new THREE.MeshLambertMaterial({ color: 0xd9d6cc })); term.position.set(-150, 4.5, 235); A.add(term);
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 24, 12), new THREE.MeshLambertMaterial({ color: 0xcfcfcf })); tw.position.set(-125, 12, 250); A.add(tw);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(6, 4.5, 5, 12), new THREE.MeshLambertMaterial({ color: 0x3a6a88, emissive: 0x112233 })); cab.position.set(-125, 26.5, 250); A.add(cab);
      this.towerPos = new THREE.Vector3(-125, 31, 250);
      // windsock
      this.sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); this.sockPole.position.set(30, 3.5, 300); A.add(this.sockPole);
      this.sock = new THREE.Group(); this.sock.position.set(30, 7, 300);
      const sm = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.5, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }));
      sm.rotation.z = -Math.PI / 2; sm.position.x = 1.75; this.sock.add(sm); A.add(this.sock);
      // lights
      const dot = canvasTex(64, 64, (c, w, h) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
      const lp = [], gp = [];
      for (let z = -RW_LEN / 2; z <= RW_LEN / 2; z += 60) { lp.push(-RW_W / 2 - 1, 0.35, z, RW_W / 2 + 1, 0.35, z); }
      for (let x = -RW_W / 2; x <= RW_W / 2; x += 3) { gp.push(x, 0.35, RW_LEN / 2 + 3, x, 0.35, -RW_LEN / 2 - 3); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      this.rwLightMat = new THREE.PointsMaterial({ color: 0xffffee, size: 4, map: dot, transparent: true, opacity: 0.0, depthWrite: false, fog: false });
      A.add(new THREE.Points(lg, this.rwLightMat));
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
      this.endLightMat = new THREE.PointsMaterial({ color: 0x33ff55, size: 4, map: dot, transparent: true, opacity: 0, depthWrite: false, fog: false });
      A.add(new THREE.Points(gg, this.endLightMat));
      // PAPI-ish approach lights (strobes along centerline)
      const ap = []; for (let i = 1; i <= 16; i++) ap.push(0, 0.5, RW_LEN / 2 + 3 + i * 45);
      const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
      this.apprMat = new THREE.PointsMaterial({ color: 0xffffff, size: 6, map: dot, transparent: true, opacity: 0, depthWrite: false, fog: false });
      A.add(new THREE.Points(ag, this.apprMat));
      // building window glow at night
      this.glowMats = [cab.material, term.material];
    }

    buildScenery() {
      const N = 2600, tg = new THREE.ConeGeometry(5, 16, 6); tg.translate(0, 9, 0);
      const trunk = new THREE.CylinderGeometry(0.7, 0.9, 3, 5); trunk.translate(0, 1.5, 0);
      const m = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0x2f6a2c }), N);
      const mt = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), N);
      const d = new THREE.Object3D(); let i = 0, tries = 0;
      while (i < N && tries < 40000) {
        tries++;
        const a = Math.random() * 6.283, r = 700 + Math.pow(Math.random(), 0.7) * 16000;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.abs(x) < 120 && Math.abs(z) < 1500) continue;
        if (x > -330 && x < 100 && z > -100 && z < 450) continue;
        const h = terrainHeight(x, z); if (h > 650) continue;
        const s = 0.8 + Math.random() * 1.4;
        d.position.set(x, h, z); d.scale.set(s, s * (0.8 + Math.random() * 0.6), s); d.rotation.y = Math.random() * 6; d.updateMatrix();
        m.setMatrixAt(i, d.matrix); mt.setMatrixAt(i, d.matrix); i++;
      }
      m.count = mt.count = i; m.instanceMatrix.needsUpdate = mt.instanceMatrix.needsUpdate = true;
      this.scene.add(m, mt);
      // field patches / roads for speed cues
      const pm = [0x6d8f3a, 0xa89c55, 0x5c7d33, 0x8aa04a];
      for (let k = 0; k < 90; k++) {
        const a = Math.random() * 6.283, r = 1600 + Math.random() * 3200;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(120 + Math.random() * 260, 100 + Math.random() * 240), new THREE.MeshLambertMaterial({ color: pm[k % 4] }));
        p.rotation.x = -Math.PI / 2; p.rotation.z = Math.random() * 3; p.position.set(x, terrainHeight(x, z) + 0.2, z); this.scene.add(p);
      }
    }

    buildClouds() {
      const tex = canvasTex(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95, color: 0xffffff });
      this.clouds = new THREE.Group();
      for (let i = 0; i < 70; i++) {
        const cx = (Math.random() - 0.5) * 36000, cz = (Math.random() - 0.5) * 36000, cy = 1100 + Math.random() * 1200;
        const n = 5 + Math.floor(Math.random() * 6);
        for (let j = 0; j < n; j++) {
          const s = new THREE.Sprite(this.cloudMat); const sc = 500 + Math.random() * 700;
          s.scale.set(sc, sc * 0.55, 1); s.position.set(cx + (Math.random() - 0.5) * 900, cy + (Math.random() - 0.5) * 120, cz + (Math.random() - 0.5) * 900); this.clouds.add(s);
        }
      }
      this.scene.add(this.clouds);
    }

    buildAircraft() {
      const ac = new THREE.Group(); this.ac = ac;           // oriented by sim quaternion (body: X fwd, Y up, Z right)
      const body = new THREE.Group(); ac.add(body); this.acBody = body;
      const white = new THREE.MeshPhongMaterial({ color: 0xf2f2f0, shininess: 60 });
      const red = new THREE.MeshPhongMaterial({ color: 0xb02020, shininess: 40 });
      const dark = new THREE.MeshPhongMaterial({ color: 0x25272b });
      const glass = new THREE.MeshPhongMaterial({ color: 0x2c4a5e, shininess: 120, transparent: true, opacity: 0.75 });
      // fuselage: cylinder along X
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 6.0, 14), white); fus.rotation.z = Math.PI / 2; fus.position.set(-0.8, 0, 0); body.add(fus);
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.55, 1.6, 14), white); nose.rotation.z = Math.PI / 2; nose.position.set(1.7, -0.05, 0); body.add(nose);
      const tailc = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.12, 2.5, 10), white); tailc.rotation.z = Math.PI / 2; tailc.position.set(-4.0, 0.1, 0); body.add(tailc);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.12, 1.12), red); stripe.position.set(-0.8, 0.0, 0); body.add(stripe);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 1.0), glass); cab.position.set(0.0, 0.5, 0); body.add(cab);
      // high wing
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 10.8), white); wing.position.set(0.1, 0.75, 0); body.add(wing);
      const tip1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2020 })); tip1.position.set(0.1, 0.75, -5.4); body.add(tip1);
      const tip2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x20ff40 })); tip2.position.set(0.1, 0.75, 5.4); body.add(tip2);
      for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.07), white); st.position.set(0.1, 0.0, s * 1.8); st.rotation.x = -s * 0.9; body.add(st); }
      // ailerons / flaps (pivot groups)
      this.ail = []; this.flapS = [];
      for (const s of [-1, 1]) {
        const g = new THREE.Group(); g.position.set(-0.7, 0.75, s * 4.0); const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 2.4), white); m.position.set(-0.2, 0, 0); g.add(m); body.add(g); this.ail.push(g);
        const gf = new THREE.Group(); gf.position.set(-0.7, 0.75, s * 1.6); const mf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 2.2), white); mf.position.set(-0.2, 0, 0); gf.add(mf); body.add(gf); this.flapS.push(gf);
      }
      // tail
      const hs = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 3.8), white); hs.position.set(-4.9, 0.25, 0); body.add(hs);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.07), white); fin.position.set(-4.85, 0.95, 0); fin.rotation.z = 0.0; body.add(fin);
      const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.09), red); finStripe.position.set(-4.7, 1.2, 0); body.add(finStripe);
      this.elev = new THREE.Group(); this.elev.position.set(-5.35, 0.25, 0); const em = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 3.7), white); em.position.x = -0.22; this.elev.add(em); body.add(this.elev);
      this.rud = new THREE.Group(); this.rud.position.set(-5.45, 0.95, 0); const rm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.06), white); rm.position.x = -0.22; this.rud.add(rm); body.add(this.rud);
      // prop
      this.prop = new THREE.Group(); this.prop.position.set(2.55, -0.05, 0);
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.12), dark); this.prop.add(bl);
      const spin = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 10), dark); spin.rotation.z = -Math.PI / 2; spin.position.x = 0.15; this.prop.add(spin);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.0, side: THREE.DoubleSide })); disc.rotation.y = Math.PI / 2; this.prop.add(disc); this.disc = disc;
      body.add(this.prop);
      // landing gear
      this.gear = new THREE.Group(); body.add(this.gear);
      const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 14); wheelGeo.rotateX(Math.PI / 2);
      const mk = (x, y, z) => { const w = new THREE.Mesh(wheelGeo, dark); w.position.set(x, y, z); this.gear.add(w); const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), dark); l.position.set(x, y + 0.45, z * 0.8); this.gear.add(l); return w; };
      this.wheelsM = [mk(-0.65, -1.1, -1.45), mk(-0.65, -1.1, 1.45)]; this.wheelN = mk(1.6, -1.1, 0);
      // lights
      this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 })); this.beacon.position.set(-5.2, 1.7, 0); body.add(this.beacon);
      this.scene.add(ac);
      // cockpit-view helpers: hide body when in cockpit
    }

    setTime(h) {
      this.timeOfDay = h;
      const ang = (h - 6) / 24 * Math.PI * 2;
      const sy = Math.sin(ang), sx = Math.cos(ang) * 0.85, sz = -0.35;
      const dir = new THREE.Vector3(sx, sy, sz).normalize();
      this.sunVec = dir;
      const day = smooth(-0.12, 0.22, sy), dusk = Math.max(0, 1 - Math.abs(sy) / 0.28) * 1.0;
      const topDay = new THREE.Color(0x2e6fd0), topNight = new THREE.Color(0x02040c), horDay = new THREE.Color(0xbcd7ee), horNight = new THREE.Color(0x0a1022), duskC = new THREE.Color(0xff8a4a);
      const top = topNight.clone().lerp(topDay, day), hor = horNight.clone().lerp(horDay, day).lerp(duskC, dusk * 0.7);
      this.skyU.top.value.copy(top); this.skyU.hor.value.copy(hor); this.skyU.sunDir.value.copy(dir);
      this.skyU.sunCol.value.setRGB(1, 0.85 - dusk * 0.35, 0.65 - dusk * 0.35).multiplyScalar(smooth(-0.1, 0.05, sy));
      this.fogColor.copy(hor); this.scene.fog.color.copy(hor);
      this.sun.position.copy(dir).multiplyScalar(1000); this.sun.intensity = 1.05 * smooth(-0.05, 0.25, sy);
      this.sun.color.setRGB(1, 0.93 - dusk * 0.3, 0.82 - dusk * 0.4);
      this.hemi.intensity = 0.3 + 0.55 * day; this.hemi.color.copy(top.clone().lerp(new THREE.Color(0xffffff), 0.4));
      this.nightF = 1 - day;
      this.starMat.opacity = clamp(1 - smooth(-0.25, 0.05, sy) * 1.0, 0, 1) * 0.9;
      const lightOp = clamp((0.45 - day) / 0.4, 0, 1);
      this.rwLightMat.opacity = lightOp; this.endLightMat.opacity = lightOp; this.apprMat.opacity = lightOp;
      this.cloudMat.color.setRGB(0.15 + 0.85 * day, 0.16 + 0.84 * day, 0.22 + 0.78 * day).lerp(new THREE.Color(1, 0.72, 0.55), dusk * 0.45);
      for (const m of this.glowMats) m.emissive.setRGB(0.55 * lightOp, 0.5 * lightOp, 0.25 * lightOp);
      this.landLight.intensity = 2.2 * lightOp;
      this.scene.fog.far = 24000 * (0.5 + 0.5 * day) + 6000; this.scene.fog.near = 3000 * (0.4 + 0.6 * day);
    }

    nextCam() { this.camMode = (this.camMode + 1) % 4; this.camInit = false; this.look.yaw = this.look.pitch = 0; }

    update(sim, dt, t) {
      const q = new THREE.Quaternion(sim.q[1], sim.q[2], sim.q[3], sim.q[0]);
      const P = new THREE.Vector3(sim.pos[0], sim.pos[1], sim.pos[2]);
      // aircraft model
      this.ac.position.copy(P); this.ac.quaternion.copy(q);
      const I = sim.in, spin = sim.rpm * 0.10472;
      this.prop.rotation.x += spin * dt * (sim.rpm > 900 ? 0.6 : 1);
      this.disc.material.opacity = clamp((sim.rpm - 600) / 1500, 0, 0.55) * (sim.engineOn && sim.fuel > 0 ? 1 : 0);
      this.prop.children[0].visible = sim.rpm < 900;
      this.gear.visible = sim.gearPos > 0.05; this.gear.scale.y = Math.max(0.05, sim.gearPos); this.gear.position.y = (1 - sim.gearPos) * 0.4;
      this.elev.rotation.z = -(I.pitch + I.trim) * 0.4; this.rud.rotation.y = I.yaw * 0.4;
      this.ail[0].rotation.z = -I.roll * 0.35; this.ail[1].rotation.z = I.roll * 0.35;
      for (const f of this.flapS) f.rotation.z = sim.flap * 0.5;
      this.beacon.visible = (Math.floor(t * 1.6) % 2) === 0;
      // terrain recentre
      this.updateTerrain(P.x, P.z, false);
      this.sky.position.copy(P); this.stars.position.copy(P);
      // windsock
      const ws = sim.wind.speed, wd = -(sim.wind.dir) * Math.PI / 180; // points downwind
      this.sock.rotation.y = wd + Math.PI / 2 * 0 + Math.sin(t * 2) * 0.06;
      this.sock.rotation.z = -Math.max(0, 1 - ws / 12) * 1.1;
      // landing light
      if (this.landLight.intensity > 0.01) {
        const f = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        this.landLight.position.copy(P).addScaledVector(f, 1.0).add(new THREE.Vector3(0, 0.2, 0));
        this.landTarget.position.copy(P).addScaledVector(f, 150).add(new THREE.Vector3(0, -22, 0));
      }
      // cameras
      const cam = this.camera;
      const acBodyVisible = this.camMode !== 0;
      this.acBody.visible = acBodyVisible; this.disc.visible = true;
      if (this.camMode === 0) {
        const eye = new THREE.Vector3(0.45, 0.62, -0.3).applyQuaternion(q).add(P);
        cam.position.copy(eye);
        const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ'));
        // camera looks along -Z; aircraft forward is +X => rotate about Y by +90deg? camera -Z -> world X needs rotY(-90deg)
        const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
        cam.quaternion.copy(q).multiply(base).multiply(look);
        cam.fov = 78; this.camInit = true;
      } else if (this.camMode === 1) {
        const back = new THREE.Vector3(-13 - Math.abs(sim.thrust) * 0.0, 3.6, 0).applyQuaternion(q);
        // smooth follow using heading-only influence for stability
        const target = P.clone().add(back);
        if (!this.camInit) { this.camPos.copy(target); this.camQ.copy(q); this.camInit = true; }
        this.camPos.lerp(target, 1 - Math.exp(-dt * 6));
        this.camQ.slerp(q, 1 - Math.exp(-dt * 4));
        cam.position.copy(this.camPos);
        const yaw = this.orbitYaw - 0.6, pit = this.orbitPitch - 0.25;
        cam.lookAt(P.clone().add(new THREE.Vector3(2, 0.6, 0).applyQuaternion(this.camQ)));
        cam.fov = 62;
        if (cam.position.y < terrainHeight(cam.position.x, cam.position.z) + 1) cam.position.y = terrainHeight(cam.position.x, cam.position.z) + 1;
      } else if (this.camMode === 2) {
        const d = 16;
        const off = new THREE.Vector3(Math.cos(this.orbitPitch) * Math.sin(this.orbitYaw), Math.sin(this.orbitPitch), Math.cos(this.orbitPitch) * Math.cos(this.orbitYaw)).multiplyScalar(d).applyQuaternion(q);
        cam.position.copy(P).add(off); cam.lookAt(P); cam.fov = 55;
      } else {
        cam.position.copy(this.towerPos); cam.lookAt(P);
        const dist = cam.position.distanceTo(P); cam.fov = clamp(60 / Math.max(1, dist / 120), 6, 60);
      }
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      // keep fog distance consistent
      this.R.render(this.scene, cam);
    }
  }
  global.World = World;
})(window);
