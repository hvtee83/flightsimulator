'use strict';
/* Canvas instruments: primary flight display, engine panel, and HUD overlay. */
(function (global) {
  const FS = global.FlightSim;
  const D2R = Math.PI / 180;
  const clamp = FS.clamp;

  function setup(c, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  }

  class PFD {
    constructor(canvas) { this.W = 560; this.H = 380; this.g = setup(canvas, this.W, this.H); }
    draw(T) {
      const g = this.g, W = this.W, H = this.H;
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      // attitude indicator region
      const ax = 70, ay = 10, aw = 420, ah = 300, cx = ax + aw / 2, cy = ay + ah / 2 + 10;
      g.save(); g.beginPath(); g.rect(ax, ay, aw, ah); g.clip();
      g.translate(cx, cy); g.rotate(-T.roll * D2R);
      const ppd = 5.2, py = T.pitch * ppd;
      g.fillStyle = '#2f78c8'; g.fillRect(-600, -600 + py, 1200, 600);
      g.fillStyle = '#7a5230'; g.fillRect(-600, py, 1200, 600);
      g.fillStyle = '#9ec9f0'; g.fillRect(-600, py - 40, 1200, 40);
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-600, py); g.lineTo(600, py); g.stroke();
      g.fillStyle = '#fff'; g.font = '13px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let p = -30; p <= 30; p += 2.5) {
        if (p === 0) continue;
        const y = py - p * ppd, major = p % 10 === 0, mid = p % 5 === 0;
        const len = major ? 60 : mid ? 36 : 16;
        g.beginPath(); g.moveTo(-len, y); g.lineTo(len, y); g.stroke();
        if (major) { g.fillText(Math.abs(p), -len - 16, y); g.fillText(Math.abs(p), len + 16, y); }
      }
      g.restore();
      // roll scale
      g.save(); g.beginPath(); g.rect(ax, ay, aw, ah); g.clip(); g.translate(cx, cy); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2;
      const R = 135;
      g.save(); g.rotate(-T.roll * D2R);
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { g.save(); g.rotate(a * D2R); g.beginPath(); g.moveTo(0, -R); g.lineTo(0, -R + (a % 30 === 0 ? 14 : 8)); g.stroke(); g.restore(); }
      g.restore();
      g.beginPath(); g.moveTo(0, -R + 2); g.lineTo(-7, -R + 16); g.lineTo(7, -R + 16); g.closePath(); g.fillStyle = '#ffd400'; g.fill();
      g.restore();
      // aircraft symbol
      g.save(); g.translate(cx, cy); g.strokeStyle = '#ffd400'; g.lineWidth = 4; g.beginPath();
      g.moveTo(-80, 0); g.lineTo(-30, 0); g.lineTo(-30, 12); g.moveTo(80, 0); g.lineTo(30, 0); g.lineTo(30, 12); g.stroke();
      g.fillStyle = '#ffd400'; g.fillRect(-3, -3, 6, 6); g.restore();
      // slip ball
      g.fillStyle = '#111'; g.fillRect(cx - 50, ay + ah - 18, 100, 16); g.strokeStyle = '#ccc'; g.lineWidth = 1; g.strokeRect(cx - 50, ay + ah - 18, 100, 16);
      g.fillStyle = '#eee'; g.beginPath(); g.arc(cx - clamp(T.betaDeg * 6, -42, 42), ay + ah - 10, 6, 0, 7); g.fill();

      // airspeed tape
      const sx = 6, sw = 62;
      g.fillStyle = 'rgba(20,24,30,0.92)'; g.fillRect(sx, ay, sw, ah); g.save(); g.beginPath(); g.rect(sx, ay, sw, ah); g.clip();
      const sp = 3.4, mid = ay + ah / 2 + 10; // px per knot
      const yS = v => mid - (v - T.iasKt) * sp;
      const arc = (a, b, col, x, w2) => { g.fillStyle = col; const y1 = yS(b), y2 = yS(a); g.fillRect(x, y1, w2, y2 - y1); };
      arc(48, 129, '#2ecc40', sw - 6, 6); arc(129, 163, '#ffdd00', sw - 6, 6); arc(40, 100, '#fff', sw - 12, 4);
      g.fillStyle = '#ff2b2b'; g.fillRect(sw - 8, yS(250), 8, yS(163) - yS(250));
      g.fillStyle = '#fff'; g.font = '14px Segoe UI, Arial'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      for (let v = Math.max(0, Math.floor((T.iasKt - 45) / 10) * 10); v <= T.iasKt + 45; v += 10) {
        const y = yS(v); g.beginPath(); g.moveTo(sw - 16 + sx, y); g.lineTo(sx + sw - 8, y); g.stroke(); if (v % 20 === 0) g.fillText(v, sx + sw - 20, y);
      }
      g.restore();
      g.fillStyle = '#000'; g.strokeStyle = T.stallWarn ? '#ff3030' : '#fff'; g.lineWidth = 2; g.fillRect(sx, mid - 15, sw - 6, 30); g.strokeRect(sx, mid - 15, sw - 6, 30);
      g.fillStyle = T.stallWarn ? '#ff5050' : '#fff'; g.font = 'bold 22px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(Math.round(T.iasKt), sx + (sw - 6) / 2, mid);
      g.font = '12px Segoe UI, Arial'; g.fillStyle = '#6cf'; g.textAlign = 'left'; g.fillText('TAS ' + Math.round(T.tasKt), sx, ay + ah + 12); g.fillText('GS ' + Math.round(T.gsKt), sx, ay + ah + 28);

      // altitude tape
      const bx = W - 130, bw = 64;
      g.fillStyle = 'rgba(20,24,30,0.92)'; g.fillRect(bx, ay, bw, ah); g.save(); g.beginPath(); g.rect(bx, ay, bw, ah); g.clip();
      const ap = 0.34; const yA = v => mid - (v - T.altFt) * ap;
      g.fillStyle = '#fff'; g.font = '13px Segoe UI, Arial'; g.textAlign = 'left'; g.strokeStyle = '#fff';
      for (let v = Math.floor((T.altFt - 450) / 20) * 20; v <= T.altFt + 450; v += 20) {
        const y = yA(v); const big = v % 100 === 0; g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + (big ? 14 : 7), y); g.stroke(); if (big) g.fillText(v, bx + 17, y);
      }
      // ground
      const gf = T.altFt - T.aglFt; // field elevation ft approx
      const yg = yA(gf); if (yg < ay + ah) { g.fillStyle = 'rgba(160,100,40,0.7)'; g.fillRect(bx, yg, 6, ay + ah - yg); }
      g.restore();
      g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.fillRect(bx - 4, mid - 15, bw + 4, 30); g.strokeRect(bx - 4, mid - 15, bw + 4, 30);
      g.fillStyle = '#fff'; g.font = 'bold 22px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(Math.round(T.altFt / 10) * 10, bx + bw / 2 - 1, mid);
      g.font = '12px Segoe UI, Arial'; g.fillStyle = '#6cf'; g.textAlign = 'left'; g.fillText('AGL ' + Math.max(0, Math.round(T.aglFt)) + ' ft', bx, ay + ah + 12); g.fillText('29.92 inHg', bx, ay + ah + 28);

      // VSI
      const vx = W - 60, vw = 52;
      g.fillStyle = 'rgba(20,24,30,0.92)'; g.fillRect(vx, ay, vw, ah);
      const vm = ay + ah / 2 + 10, vp = 0.085;
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = '12px Segoe UI, Arial'; g.textAlign = 'left'; g.lineWidth = 1.5;
      for (let v = -2000; v <= 2000; v += 500) { const y = vm - v * vp * (v === 0 ? 1 : 1) * 0.5 * 2 / 2 * 1; const yy = vm - clamp(v, -2000, 2000) * 0.07; g.beginPath(); g.moveTo(vx, yy); g.lineTo(vx + (v % 1000 === 0 ? 14 : 8), yy); g.stroke(); if (v % 1000 === 0 && v !== 0) g.fillText(Math.abs(v / 1000), vx + 18, yy); }
      const vy = vm - clamp(T.vsFpm, -2200, 2200) * 0.07;
      g.strokeStyle = '#0f0'; g.lineWidth = 3; g.beginPath(); g.moveTo(vx + 42, vm); g.lineTo(vx + 4, vy); g.stroke();
      g.fillStyle = '#000'; g.fillRect(vx, ay + ah + 3, vw, 20); g.fillStyle = '#0f0'; g.font = 'bold 13px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(Math.round(T.vsFpm / 10) * 10, vx + vw / 2, ay + ah + 14);

      // heading tape
      const hy = ay + ah + 6, hh = 56;
      g.fillStyle = 'rgba(20,24,30,0.92)'; g.fillRect(ax, hy + 10, aw, hh - 10);
      g.save(); g.beginPath(); g.rect(ax, hy + 10, aw, hh - 10); g.clip();
      const hp = 4.2, hxs = h => ax + aw / 2 + ((h - T.hdg + 540) % 360 - 180) * hp;
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = '14px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 1.5;
      for (let h = 0; h < 360; h += 5) {
        const x = hxs(h); if (x < ax - 20 || x > ax + aw + 20) continue;
        g.beginPath(); g.moveTo(x, hy + 10); g.lineTo(x, hy + (h % 10 === 0 ? 24 : 18)); g.stroke();
        if (h % 10 === 0) { const l = h % 90 === 0 ? ['N', 'E', 'S', 'W'][h / 90] : (h / 10 + ''); g.fillText(l, x, hy + 38); }
      }
      // track bug
      const tx = hxs(T.trk); g.fillStyle = '#f0f'; g.beginPath(); g.moveTo(tx, hy + 12); g.lineTo(tx - 6, hy + 4); g.lineTo(tx + 6, hy + 4); g.fill();
      g.restore();
      g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.fillRect(cx - 28, hy - 10, 56, 22); g.strokeRect(cx - 28, hy - 10, 56, 22);
      g.fillStyle = '#fff'; g.font = 'bold 18px Segoe UI, Arial'; g.fillText(String(Math.round(T.hdg) % 360).padStart(3, '0') + '°', cx, hy + 1);
      // bottom row: G, AoA, wind
      g.textAlign = 'left'; g.font = '12px Segoe UI, Arial'; g.fillStyle = '#9cf';
      g.fillText('G ' + T.g.toFixed(1), W - 130, H - 22); g.fillText('AoA ' + T.alphaDeg.toFixed(1) + '°', W - 130, H - 8);
      g.fillText('WIND ' + String(Math.round(T.windDir)).padStart(3, '0') + '° / ' + Math.round(T.windKt) + ' kt', ax, H - 8);
      // warnings
      const blink = Math.floor(performance.now() / 300) % 2 === 0;
      let msg = '';
      if (T.crashed) msg = 'CRASHED'; else if (T.fuelOut) msg = 'FUEL EXHAUSTED'; else if (T.stalled) msg = 'STALL'; else if (T.stallWarn) msg = 'STALL WARNING';
      else if (T.overspeedFlaps) msg = 'FLAPS OVERSPEED'; else if (T.gearWarn) msg = 'GEAR OVERSPEED'; else if (T.lowFuel) msg = 'LOW FUEL';
      if (msg && (blink || T.crashed)) { g.fillStyle = 'rgba(200,20,20,0.88)'; g.fillRect(cx - 90, ay + 30, 180, 30); g.fillStyle = '#fff'; g.font = 'bold 20px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(msg, cx, ay + 46); }
    }
  }

  class Engine {
    constructor(canvas) { this.W = 380; this.H = 380; this.g = setup(canvas, this.W, this.H); }
    gauge(cx, cy, r, v, min, max, label, unit, zones, a0, a1) {
      const g = this.g; a0 = a0 == null ? 135 : a0; a1 = a1 == null ? 405 : a1;
      g.lineWidth = 8; g.lineCap = 'butt';
      for (const z of zones) { g.strokeStyle = z[2]; g.beginPath(); g.arc(cx, cy, r, (a0 + (z[0] - min) / (max - min) * (a1 - a0)) * D2R, (a0 + (z[1] - min) / (max - min) * (a1 - a0)) * D2R); g.stroke(); }
      g.strokeStyle = '#ddd'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r - 7, a0 * D2R, a1 * D2R); g.stroke();
      const f = clamp((v - min) / (max - min), 0, 1), a = (a0 + f * (a1 - a0)) * D2R;
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32)); g.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 15px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(Math.round(v * 10) / 10, cx, cy + r * 0.45);
      g.fillStyle = '#7bd'; g.font = '11px Segoe UI, Arial'; g.fillText(label + ' ' + unit, cx, cy + r * 0.85);
    }
    bar(x, y, w, h, f, col, label, val) {
      const g = this.g; g.strokeStyle = '#999'; g.lineWidth = 1; g.strokeRect(x, y, w, h);
      g.fillStyle = col; const fh = h * clamp(f, 0, 1); g.fillRect(x + 1, y + h - fh, w - 2, fh);
      g.fillStyle = '#7bd'; g.font = '11px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(label, x + w / 2, y + h + 13);
      g.fillStyle = '#fff'; g.font = 'bold 12px Segoe UI, Arial'; g.fillText(val, x + w / 2, y - 5);
    }
    draw(T) {
      const g = this.g, W = this.W;
      g.fillStyle = '#0a0c10'; g.fillRect(0, 0, W, this.H);
      this.gauge(100, 80, 62, T.rpm, 0, 3000, 'RPM', '', [[0, 600, '#c33'], [600, 2500, '#2c4'], [2500, 2700, '#fc0'], [2700, 3000, '#c33']]);
      this.gauge(255, 80, 62, T.map, 10, 32, 'MAP', 'inHg', [[10, 24, '#2c4'], [24, 29, '#fc0'], [29, 32, '#c33']]);
      this.gauge(100, 205, 55, T.flowGph, 0, 16, 'FF', 'gph', [[0, 12, '#2c4'], [12, 16, '#fc0']]);
      this.gauge(255, 205, 55, T.oilPsi, 0, 100, 'OIL P', 'psi', [[0, 20, '#c33'], [20, 30, '#fc0'], [30, 80, '#2c4'], [80, 100, '#c33']]);
      this.bar(325, 20, 16, 100, (T.oilF - 100) / 150, T.oilF > 230 ? '#e33' : '#2c4', 'OIL°F', Math.round(T.oilF));
      this.bar(325, 160, 16, 80, (T.egtF - 400) / 1200, '#fc0', 'EGT°F', Math.round(T.egtF));
      // fuel + throttle
      this.bar(20, 270, 18, 90, T.fuelL / 180, T.fuelL < 20 ? '#e33' : '#4af', 'FUEL', Math.round(T.fuelL) + 'L');
      this.bar(60, 270, 18, 90, T.throttlePct / 100, '#8c4', 'THR%', Math.round(T.throttlePct));
      // flaps
      g.fillStyle = '#7bd'; g.font = '11px Segoe UI, Arial'; g.textAlign = 'left'; g.fillText('FLAPS', 105, 276);
      g.fillStyle = '#fff'; g.font = 'bold 16px Segoe UI, Arial'; g.fillText(Math.round(T.flapDeg) + '°', 105, 296);
      // gear lights
      const gp = T.gearPos, col = gp > 0.97 ? '#2f4' : gp < 0.03 ? '#444' : '#f60';
      g.fillStyle = '#7bd'; g.font = '11px Segoe UI, Arial'; g.fillText('GEAR', 160, 276);
      for (let i = 0; i < 3; i++) { g.fillStyle = col; g.beginPath(); g.arc(165 + i * 20 + (i === 0 ? 10 : 0) , 295, 7, 0, 7); g.fill(); }
      g.fillStyle = '#fff'; g.font = '12px Segoe UI, Arial'; g.fillText(gp > 0.97 ? 'DOWN' : gp < 0.03 ? 'UP' : 'TRANSIT', 160, 316);
      // trim
      g.fillStyle = '#7bd'; g.font = '11px Segoe UI, Arial'; g.fillText('PITCH TRIM', 105, 336);
      g.fillStyle = '#333'; g.fillRect(105, 344, 100, 8); g.fillStyle = '#fc0'; g.fillRect(155 + T.trim * 48, 340, 4, 16);
      g.fillStyle = '#7bd'; g.fillText('BRAKE', 235, 276); g.fillStyle = T.brake > 0.05 ? '#f44' : '#444'; g.fillRect(235, 282, 40, 12);
      g.fillStyle = '#7bd'; g.fillText('STATUS', 290, 276); g.fillStyle = T.onGround ? '#fc0' : '#4af'; g.font = 'bold 13px Segoe UI, Arial'; g.fillText(T.onGround ? 'ON GROUND' : 'AIRBORNE', 290, 296);
    }
  }

  class HUD {
    constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); }
    draw(T, sim, world, show) {
      const c = this.c, g = this.g, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth, H = window.innerHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!show) return;
      const col = '#5dff7a'; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5; g.font = '15px Consolas, monospace'; g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3;
      const cx = W / 2, cy = H * 0.42;
      if (world.camMode === 0) {
        const fov = world.camera.fov, ppd = H / fov;
        g.save(); g.translate(cx, cy); g.rotate(-T.roll * D2R);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let p = -30; p <= 30; p += 5) {
          const y = (T.pitch - p) * ppd; if (Math.abs(y) > H * 0.5) continue;
          if (p === 0) { g.beginPath(); g.moveTo(-170, y); g.lineTo(-40, y); g.moveTo(40, y); g.lineTo(170, y); g.stroke(); continue; }
          g.beginPath(); g.setLineDash(p < 0 ? [6, 5] : []); g.moveTo(-70, y); g.lineTo(-28, y); g.moveTo(28, y); g.lineTo(70, y); g.stroke(); g.setLineDash([]);
          g.fillText(Math.abs(p), -88, y); g.fillText(Math.abs(p), 88, y);
        }
        g.restore();
        // boresight + flight path vector
        g.beginPath(); g.moveTo(cx - 14, cy); g.lineTo(cx - 4, cy); g.moveTo(cx + 4, cy); g.lineTo(cx + 14, cy); g.moveTo(cx, cy - 4); g.lineTo(cx, cy - 12); g.stroke();
        const fpa = T.fpa, dr = T.drift;
        const fx = cx + clamp(dr, -30, 30) * ppd, fy = cy - (fpa - T.pitch + 0) * ppd + (T.pitch ? 0 : 0);
        // approximate: FPV vertical offset = (fpa - pitch)
        const fyy = cy + (T.pitch - fpa) * ppd;
        g.beginPath(); g.arc(fx, fyy, 8, 0, 7); g.moveTo(fx - 8, fyy); g.lineTo(fx - 20, fyy); g.moveTo(fx + 8, fyy); g.lineTo(fx + 20, fyy); g.moveTo(fx, fyy - 8); g.lineTo(fx, fyy - 16); g.stroke();
      }
      g.textBaseline = 'middle';
      // side boxes
      const bx = 40, by = H * 0.42;
      g.textAlign = 'left'; g.font = 'bold 22px Consolas, monospace'; g.fillText('SPD ' + Math.round(T.iasKt), bx, by);
      g.font = '14px Consolas, monospace'; g.fillText('GS  ' + Math.round(T.gsKt) + ' kt', bx, by + 26); g.fillText('G   ' + T.g.toFixed(1), bx, by + 46); g.fillText('AOA ' + T.alphaDeg.toFixed(1), bx, by + 66);
      g.textAlign = 'right'; g.font = 'bold 22px Consolas, monospace'; g.fillText('ALT ' + Math.round(T.altFt), W - 40, by);
      g.font = '14px Consolas, monospace'; g.fillText('VS ' + Math.round(T.vsFpm / 10) * 10 + ' fpm', W - 40, by + 26); g.fillText('AGL ' + Math.max(0, Math.round(T.aglFt)) + ' ft', W - 40, by + 46);
      g.textAlign = 'center'; g.font = 'bold 18px Consolas, monospace'; g.fillText('HDG ' + String(Math.round(T.hdg) % 360).padStart(3, '0'), cx, 64);
      g.font = '14px Consolas, monospace'; g.fillText('THR ' + Math.round(T.throttlePct) + '%   FLAP ' + Math.round(T.flapDeg) + '°   GEAR ' + (T.gearPos > 0.97 ? 'DN' : T.gearPos < 0.03 ? 'UP' : '..') + '   FUEL ' + Math.round(T.fuelL) + 'L', cx, 86);
      g.shadowBlur = 0;
    }
  }

  global.Instruments = { PFD, Engine, HUD };
})(window);
