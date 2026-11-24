'use strict';
/* Flight dynamics model: 6-DOF rigid body, light single-engine retractable-gear aircraft.
   World frame: x = east, y = up, z = south (north = -z).  Body frame: X forward, Y up, Z right.
   Body angular velocity w = [wx roll(right wing down +), wy yaw(nose left +), wz pitch(nose up +)]. */
(function (global) {
  const D2R = Math.PI / 180, G = 9.80665;
  const KT = 1.943844, FT = 3.28084, FPM = 196.850;
  const ELEV = 150; // airport elevation above MSL, metres

  // ---------- small math ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function qmul(a, b) {
    return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
            a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
  }
  const qconj = q => [q[0], -q[1], -q[2], -q[3]];
  function qrot(q, v) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const tx = 2*(y*v[2]-z*v[1]), ty = 2*(z*v[0]-x*v[2]), tz = 2*(x*v[1]-y*v[0]);
    return [v[0]+w*tx+(y*tz-z*ty), v[1]+w*ty+(z*tx-x*tz), v[2]+w*tz+(x*ty-y*tx)];
  }
  function qaxis(ax, ang) { const s = Math.sin(ang/2); return [Math.cos(ang/2), ax[0]*s, ax[1]*s, ax[2]*s]; }
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

  // ---------- terrain (shared with renderer) ----------
  function hash(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx*fx*(3-2*fx), sz = fz*fz*(3-2*fz);
    const a = hash(ix, iz), b = hash(ix+1, iz), c = hash(ix, iz+1), d = hash(ix+1, iz+1);
    return a + (b-a)*sx + (c-a)*sz + (a-b-c+d)*sx*sz;
  }
  function terrainHeight(x, z) {
    const d = Math.hypot(x, z);
    const fade = smooth(3500, 9500, d);
    if (fade <= 0) return 0;
    let n = 0, amp = 0.55, f = 1 / 5200;
    for (let i = 0; i < 4; i++) { n += amp * vnoise(x * f + 17.3, z * f - 9.1); amp *= 0.5; f *= 2.1; }
    return fade * Math.max(0, n - 0.18) * 1500;
  }

  // ---------- atmosphere ----------
  function atmosphere(hMSL) {
    const h = Math.max(hMSL, 0);
    const T = 288.15 - 0.0065 * h;
    const rho = 1.225 * Math.pow(T / 288.15, 4.2559);
    return { T, rho, sigma: rho / 1.225, pInHg: 29.92 * Math.pow(1 - 2.25577e-5 * h, 5.2559) };
  }

  // ---------- aircraft definition ----------
  const AC = {
    name: 'Skyhawk-class light single (retractable gear)',
    emptyMass: 760, crewMass: 170, fuelDensity: 0.72, tankL: 180,
    S: 16.2, b: 11.0, c: 1.5,
    Ix: 1285, Iy: 2667, Iz: 1824,
    Pmax: 135000, eta: 0.80, V0: 28, propArea: 2.84,
    rpmIdle: 750, rpmMax: 2700,
    CD0: 0.026, kInd: 1 / (Math.PI * 0.75 * (11 * 11 / 16.2)),
    Vne: 163 / KT, Vfe: 100 / KT, Vle: 130 / KT
  };
  const FLAP_STEPS = [0, 10, 20, 30];
  const GEAR_PTS = [ // body coords
    { id: 'nose', p: [1.6, -1.3, 0], k: 38000, c: 3500, steer: true, brake: false },
    { id: 'mainL', p: [-0.65, -1.3, -1.45], k: 52000, c: 4200, steer: false, brake: true },
    { id: 'mainR', p: [-0.65, -1.3, 1.45], k: 52000, c: 4200, steer: false, brake: true }
  ];
  const STRUCT_PTS = [
    { id: 'belly1', p: [0.3, -0.85, 0], k: 150000, c: 9000, tol: 3.2 },
    { id: 'belly2', p: [-1.8, -0.8, 0], k: 150000, c: 9000, tol: 3.2 },
    { id: 'tail', p: [-4.9, 0.1, 0], k: 150000, c: 9000, tol: 2.5 },
    { id: 'tipL', p: [-0.3, 0.35, -5.4], k: 150000, c: 9000, tol: 0.5 },
    { id: 'tipR', p: [-0.3, 0.35, 5.4], k: 150000, c: 9000, tol: 0.5 },
    { id: 'prop', p: [2.4, -0.95, 0], k: 150000, c: 9000, tol: 4.5 }
  ];

  class Sim {
    constructor() {
      this.wind = { speed: 5, dir: 0, turb: 0.3 }; // knots, from-direction deg, turbulence 0..1
      this.cm0 = 0.06;
      this.reset('runway');
    }

    mass() { return AC.emptyMass + AC.crewMass + this.fuel * AC.fuelDensity; }

    windVec() {
      const t = this.time, s = this.wind.speed / KT, d = this.wind.dir * D2R;
      const base = [-s * Math.sin(d), 0, s * Math.cos(d)];
      const A = this.wind.turb * 2.2 + s * 0.06 * this.wind.turb;
      const g = (f1, f2, f3, p) => (Math.sin(f1*t+p) + 0.6*Math.sin(f2*t+p*2.3) + 0.4*Math.sin(f3*t+p*1.7)) / 2;
      const gust = this.pos[1] > 3 || this.onGround ? 1 : 0.3;
      return [base[0] + A*g(0.31, 0.83, 1.9, 1) * gust, base[1] + A*0.6*g(0.57, 1.3, 2.7, 2) * gust, base[2] + A*g(0.27, 0.9, 2.1, 3) * gust];
    }

    thrustAt(thr, V, sigma) {
      const P = this.powerAt(thr, sigma);
      return AC.eta * P / (Math.max(V, 0) + AC.V0);
    }
    powerAt(thr, sigma) {
      const dens = Math.max(0.1, (sigma - 0.12) / 0.88);
      return AC.Pmax * (0.04 + 0.96 * thr) * dens;
    }

    reset(mode, opts) {
      opts = opts || {};
      this.time = 0; this.crashed = null; this.onGround = true; this.gearHard = false;
      this.fuel = opts.fuel != null ? opts.fuel : 120;
      this.in = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, trim: 0, flapIdx: 0, gearDown: true };
      this.flap = 0; this.gearPos = 1; this.engThr = 0; this.rpm = AC.rpmIdle;
      this.oilT = 150; this.egt = 800; this.flow = 0; this.engineOn = true; this.thrust = 0;
      this.w = [0, 0, 0]; this.gLoad = 1; this.stallT = 0; this.alpha = 0; this.beta = 0;
      this.contact = { nose: 0, mainL: 0, mainR: 0 }; this.warn = {};
      this.touchdownVs = null; this.lastMsg = '';
      if (mode === 'runway') {
        this.setPose([0, 1.3, 800], 0, 0, 0);
        this.vel = [0, 0, 0];
        this.in.trim = 0.0;
        this.in.flapIdx = 1; this.flap = 10 / 30;
        this.in.brake = 1; // parked with brakes; user releases
      } else if (mode === 'cruise') {
        this.setupFlight({ altFt: 4000, ias: 100, hdg: 0, gamma: 0, flaps: 0, gear: false, z: 300 });
      } else if (mode === 'final') {
        this.setupFlight({ altFt: null, ias: 70, hdg: 0, gamma: -3, flaps: 2, gear: true, z: 3700 });
      }
      if (opts.fuel == null && mode !== 'runway') this.fuel = 100;
    }

    setPose(pos, hdgDeg, pitchRad, rollRad) {
      this.pos = pos.slice();
      const q0 = qaxis([0, 1, 0], Math.PI / 2);
      let q = qmul(qaxis([0, 1, 0], -hdgDeg * D2R), q0);
      q = qmul(q, qaxis([0, 0, 1], pitchRad));
      q = qmul(q, qaxis([1, 0, 0], rollRad));
      this.q = q;
    }

    setupFlight(o) {
      const aglM = o.altFt != null ? o.altFt / FT - ELEV : Math.abs(o.z - 900) * Math.tan(-o.gamma * D2R) + 0;
      const y = o.altFt != null ? o.altFt / FT - ELEV : aglM;
      const hMSL = y + ELEV, atm = atmosphere(hMSL);
      const ias = o.ias / KT, tas = ias / Math.sqrt(atm.sigma);
      const gam = (o.gamma || 0) * D2R;
      this.in.flapIdx = o.flaps; this.flap = FLAP_STEPS[o.flaps] / 30;
      this.in.gearDown = !!o.gear; this.gearPos = o.gear ? 1 : 0;
      this.in.brake = 0;
      const W = this.mass() * G, qd = 0.5 * atm.rho * tas * tas;
      const CLreq = W * Math.cos(gam) / (qd * AC.S);
      const CL0 = 0.35 + 0.55 * this.flap, a = 4.8;
      const alpha = clamp((CLreq - CL0) / a, -0.1, 0.3);
      this.setPose([0, y, o.z != null ? o.z : 0], o.hdg || 0, gam + alpha, 0);
      const h = o.hdg * D2R;
      this.vel = [tas * Math.cos(gam) * Math.sin(h), tas * Math.sin(gam), -tas * Math.cos(gam) * Math.cos(h)];
      this.w = [0, 0, 0];
      // trim for zero pitching moment
      this.alpha = alpha;
      const cmNoDe = this.cm0 - 0.9 * alpha - 0.05 * this.flap;
      this.in.trim = clamp(-cmNoDe / (1.3 * 0.45), -1, 1);
      // throttle for required thrust
      const CDtot = this.dragCoef(CLreq, alpha, 0, this.flap, this.gearPos, 0.5);
      const Treq = CDtot * qd * AC.S + W * Math.sin(gam) * -1 * -1; // T = D + W sin(gamma)
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; (this.thrustAt(m, tas, atm.sigma) < Treq ? lo = m : hi = m); }
      this.in.throttle = (lo + hi) / 2; this.engThr = this.in.throttle;
      this.onGround = false;
    }

    dragCoef(CL, alpha, beta, f, gearPos, thr) {
      const aS = 0.25 - 0.03 * f;
      const post = smooth(0, 0.12, Math.abs(alpha) - (alpha > 0 ? aS : 0.22));
      return AC.CD0 + 0.055 * f * f + 0.02 * f + 0.018 * gearPos + 0.008 * (1 - thr)
        + 0.9 * beta * beta + 1.3 * Math.sin(alpha) * Math.sin(alpha) * post + AC.kInd * CL * CL;
    }

    liftCoef(alpha, f) {
      const aS = 0.25 - 0.03 * f, aN = -0.22, CL0 = 0.35 + 0.55 * f, a = 4.8;
      if (alpha > aS) {
        const CLs = CL0 + a * aS, t = smooth(0, 0.12, alpha - aS);
        return CLs * (1 - t) + 0.9 * Math.sin(2 * alpha) * t;
      }
      if (alpha < aN) {
        const CLn = CL0 + a * aN, t = smooth(0, 0.12, aN - alpha);
        return CLn * (1 - t) + 0.9 * Math.sin(2 * alpha) * t;
      }
      return CL0 + a * alpha;
    }

    update(dt) { // fixed outer dt, internal substeps
      if (this.crashed) return;
      const n = Math.max(1, Math.round(dt / (1 / 240)));
      const h = dt / n;
      for (let i = 0; i < n && !this.crashed; i++) this.step(h);
    }

    step(dt) {
      const I = this.in, q = this.q, qc = qconj(q);
      this.time += dt;
      const m = this.mass();
      // actuators
      const fTarget = FLAP_STEPS[I.flapIdx] / 30;
      this.flap += clamp(fTarget - this.flap, -dt / 9, dt / 9);
      const gTarget = I.gearDown ? 1 : 0;
      this.gearPos += clamp(gTarget - this.gearPos, -dt / 6, dt / 6);
      this.engThr += clamp(I.throttle - this.engThr, -dt * 2, dt * 2);

      // air data
      const hMSL = this.pos[1] + ELEV, atm = atmosphere(hMSL);
      const wind = this.windVec();
      const vrel = [this.vel[0] - wind[0], this.vel[1] - wind[1], this.vel[2] - wind[2]];
      const va = qrot(qc, vrel);
      const V = Math.hypot(va[0], va[1], va[2]);
      const Vs = Math.max(V, 0.5);
      let alpha = V > 1 ? Math.atan2(-va[1], va[0]) : 0;
      const beta = V > 1 ? Math.asin(clamp(va[2] / Vs, -1, 1)) : 0;
      this.alpha = alpha; this.beta = beta; this.V = V;
      const qd = 0.5 * atm.rho * V * V;
      const f = this.flap;

      // engine
      const fuelOK = this.fuel > 0;
      const run = this.engineOn && fuelOK;
      const thrEff = run ? this.engThr : 0;
      let P = run ? this.powerAt(thrEff, atm.sigma) : 0;
      const T = run ? AC.eta * P / (V + AC.V0) : 0;
      this.thrust = T;
      const rpmTarget = run ? AC.rpmIdle + (AC.rpmMax - AC.rpmIdle) * Math.pow(thrEff, 0.75) * (1 + 0.03 * V / 50) : Math.max(0, V * 12);
      this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * 3);
      const kW = P / 1000;
      const flowKgS = run ? (kW * 0.30 + 1.2) / 3600 : 0;
      this.fuel = Math.max(0, this.fuel - flowKgS / AC.fuelDensity * dt);
      this.flow = flowKgS / AC.fuelDensity * 3600 / 3.785; // gal/h
      this.egt += ((run ? 650 + 850 * Math.pow(thrEff, 0.6) : 100) - this.egt) * dt / 4;
      this.oilT += ((run ? 150 + 70 * thrEff : 90) - this.oilT) * dt / 90;
      this.map = run ? 11 + (atm.pInHg - 11) * Math.pow(thrEff, 0.85) : atm.pInHg;
      this.sigma = atm.sigma;

      // aero coefficients
      const CL = this.liftCoef(alpha, f);
      const CD = this.dragCoef(CL, alpha, beta, f, this.gearPos, thrEff);
      // ground effect
      const hAGL = this.pos[1] - terrainHeight(this.pos[0], this.pos[2]) - 0.7;
      const ge = Math.pow(16 * Math.max(hAGL, 0.1) / AC.b, 2);
      const phi = ge / (1 + ge);
      const CDge = CD - AC.kInd * CL * CL * (1 - phi);
      const CLge = CL * (1 + 0.10 * (1 - phi));
      this.CL = CLge;

      const vhat = V > 0.5 ? [va[0] / V, va[1] / V, va[2] / V] : [1, 0, 0];
      let ld = cross([0, 0, 1], vhat); const ll = Math.hypot(ld[0], ld[1], ld[2]) || 1;
      ld = [ld[0] / ll, ld[1] / ll, ld[2] / ll];
      const qS = qd * AC.S;
      const Fb = [T, 0, 0];
      for (let i = 0; i < 3; i++) Fb[i] += -CDge * qS * vhat[i] + CLge * qS * ld[i];
      Fb[2] += -0.45 * beta * qS;

      // moments (body axes)
      const Vd = Math.max(V, 12);
      const slip2 = 2 * T / (atm.rho * AC.propArea);
      const qCtl = 0.5 * atm.rho * (V * V + 0.5 * slip2);
      const p = this.w[0], rYaw = this.w[1], qP = this.w[2];
      const de = clamp(I.pitch + I.trim, -1, 1) * 0.45;
      const da = I.roll, dr = I.yaw;
      const aS = 0.25 - 0.03 * f;
      const stallK = smooth(0, 0.08, alpha - aS);
      const Cm = this.cm0 - 0.9 * alpha - 0.05 * f - 12 * qP * AC.c / (2 * Vd) - 0.5 * stallK;
      let Mz = qd * AC.S * AC.c * Cm + qCtl * AC.S * AC.c * 1.3 * de;
      const rStd = -rYaw;
      const Cl = -0.10 * beta - 0.45 * p * AC.b / (2 * Vd) + 0.10 * rStd * AC.b / (2 * Vd);
      let Mx = qd * AC.S * AC.b * Cl + qCtl * AC.S * AC.b * 0.06 * da;
      const Cn = 0.07 * beta - 0.10 * rStd * AC.b / (2 * Vd) - 0.03 * p * AC.b / (2 * Vd) - 0.012 * da;
      const Nstd = qd * AC.S * AC.b * Cn + qCtl * AC.S * AC.b * 0.02 * dr;
      let My = -Nstd;
      // engine torque / p-factor (left-turning tendency)
      if (run) {
        const Qeng = P / Math.max(this.rpm * 0.10472, 80);
        Mx += -0.02 * Qeng;
        My += 0.3 * Qeng * (1 - clamp(V / 45, 0, 1));
      }
      // mild spiral stability (dihedral / fin effect) so the aircraft self-levels gently
      { const rr = qrot(q, [0, 0, 1]), uu = qrot(q, [0, 1, 0]); const sr = Math.atan2(-rr[1], uu[1]);
        if (Math.abs(sr) < 1.4) Mx += -qd * AC.S * AC.b * 0.02 * Math.sin(sr); }
      // stall buffet and wing drop
      if (stallK > 0) {
        const nz = Math.sin(this.time * 17) * Math.sin(this.time * 5.3 + 1);
        Mx += stallK * (nz * 1500 + Math.sin(this.time * 1.3) * 1200);
        Mz += stallK * nz * 700;
      }
      // turbulence moments
      const tb = this.wind.turb * 0.5 * qd * AC.S * AC.b * 0.004;
      Mx += tb * Math.sin(this.time * 3.1) * Math.sin(this.time * 1.1 + 2);
      Mz += tb * 0.4 * Math.sin(this.time * 2.3 + 1);

      // world forces
      const Fw = qrot(q, Fb);
      let Fx = Fw[0], Fy = Fw[1] - m * G, Fz = Fw[2];
      let specY = Fb[1];

      // ground contact
      this.onGround = false;
      const contacts = [];
      const w3 = this.w;
      const handle = (pt, wheel) => {
        const rb = pt.p, rw = qrot(q, rb);
        const P = [this.pos[0] + rw[0], this.pos[1] + rw[1], this.pos[2] + rw[2]];
        const gh = terrainHeight(P[0], P[2]);
        const depth = gh - P[1];
        if (depth <= 0) { if (wheel) this.contact[pt.id] = 0; return; }
        const vp = qrot(q, cross(w3, rb));
        const v = [this.vel[0] + vp[0], this.vel[1] + vp[1], this.vel[2] + vp[2]];
        let Fn = Math.max(0, pt.k * depth - pt.c * v[1]);
        Fn = Math.min(Fn, 150000);
        if (wheel) this.contact[pt.id] = Fn;
        // crash checks on first meaningful contact
        const sink = -v[1];
        if (wheel) {
          if (sink > 6.0 && !this.touchdownMark) { this.crash('Hard landing – landing gear collapsed (sink ' + (sink * FPM).toFixed(0) + ' fpm)'); }
          if (depth > 0.01 && !this.touchdownMark) { this.touchdownMark = true; this.touchdownVs = sink * FPM; this.touchdownT = this.time; }
          this.onGround = true;
        } else {
          const hs = Math.hypot(v[0], v[2]);
          if (sink > pt.tol || (pt.id.startsWith('tip') && hs > 12 && depth > 0.02)) this.crashPt = pt.id + ' sink ' + sink.toFixed(1) + ' hs ' + hs.toFixed(1) + ' depth ' + depth.toFixed(2);
          if (sink > pt.tol || (pt.id.startsWith('tip') && hs > 12 && depth > 0.02)) this.crash('Crashed – ' + (pt.id.startsWith('tip') ? 'wing struck the ground' : pt.id === 'prop' ? 'propeller strike' : 'impact with terrain'));
          this.onGround = this.onGround || false;
        }
        // tyre / skid friction
        let dir = [1, 0, 0];
        if (pt.steer) { const vg = Math.hypot(this.vel[0], this.vel[2]) / 8; const s = -I.yaw * 0.30 / (1 + vg * vg); dir = [Math.cos(s), 0, -Math.sin(s)]; }
        let fw = qrot(q, dir); fw[1] = 0; const fl = Math.hypot(fw[0], fw[2]) || 1; fw = [fw[0] / fl, 0, fw[2] / fl];
        const sd = [-fw[2], 0, fw[0]];
        const vf = v[0] * fw[0] + v[2] * fw[2], vs = v[0] * sd[0] + v[2] * sd[2];
        const isWheel = !!wheel;
        const mu = isWheel ? 0.85 : 0.5;
        let Ff;
        if (isWheel) Ff = -Math.tanh(vf / 0.4) * Fn * (0.025 + (pt.brake ? 0.38 * I.brake : 0));
        else Ff = -Math.tanh(vf / 0.4) * Fn * 0.5;
        const Fs = -Math.tanh(vs / (isWheel ? 0.6 : 0.4)) * Fn * mu;
        const Fc = [Ff * fw[0] + Fs * sd[0], Fn, Ff * fw[2] + Fs * sd[2]];
        Fx += Fc[0]; Fy += Fc[1]; Fz += Fc[2];
        const Fcb = qrot(qc, Fc);
        const tau = cross(rb, Fcb);
        Mx += tau[0]; My += tau[1]; Mz += tau[2];
        specY += Fcb[1];
      };
      if (this.gearPos > 0.95) for (const g of GEAR_PTS) handle(g, true);
      else for (const g of GEAR_PTS) this.contact[g.id] = 0;
      for (const s of STRUCT_PTS) handle(s, false);
      if (this.gearPos <= 0.95 && !this.crashed) {
        // retracted: belly contact counts as ground contact
        const gh = terrainHeight(this.pos[0], this.pos[2]);
        if (this.pos[1] - gh < 1.0) this.onGround = true;
      }
      if (!this.onGround) { this.touchdownMark = false; }
      if (this.onGround) {
        const up = qrot(q, [0, 1, 0]);
        if (up[1] < 0.0 && !this.crashed) this.crash('Crashed – aircraft overturned');
      }

      // integrate
      this.gLoad += ((specY / (m * G)) - this.gLoad) * Math.min(1, dt * 12);
      this.vel[0] += Fx / m * dt; this.vel[1] += Fy / m * dt; this.vel[2] += Fz / m * dt;
      this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt;
      const wx = this.w[0], wy = this.w[1], wz = this.w[2];
      this.w[0] += (Mx + (AC.Iy - AC.Iz) * wy * wz) / AC.Ix * dt;
      this.w[1] += (My + (AC.Iz - AC.Ix) * wz * wx) / AC.Iy * dt;
      this.w[2] += (Mz + (AC.Ix - AC.Iy) * wx * wy) / AC.Iz * dt;
      const dq = qmul(this.q, [0, this.w[0], this.w[1], this.w[2]]);
      const nq = [this.q[0] + 0.5 * dq[0] * dt, this.q[1] + 0.5 * dq[1] * dt, this.q[2] + 0.5 * dq[2] * dt, this.q[3] + 0.5 * dq[3] * dt];
      const nl = Math.hypot(nq[0], nq[1], nq[2], nq[3]);
      this.q = [nq[0] / nl, nq[1] / nl, nq[2] / nl, nq[3] / nl];
      // terrain safety net
      const gh2 = terrainHeight(this.pos[0], this.pos[2]);
      if (this.pos[1] < gh2 - 0.3) { this.pos[1] = gh2 - 0.3; if (!this.crashed) this.crash('Crashed – impact with terrain'); }
    }

    crash(msg) {
      if (this.crashed) return;
      this.crashed = msg;
      this.vel = [this.vel[0] * 0.2, Math.max(this.vel[1], 0), this.vel[2] * 0.2];
      this.w = [0, 0, 0];
    }

    // derived telemetry for instruments
    get tel() {
      const q = this.q;
      const f = qrot(q, [1, 0, 0]), u = qrot(q, [0, 1, 0]), r = qrot(q, [0, 0, 1]);
      const atm = atmosphere(this.pos[1] + ELEV);
      const wind = this.windVec();
      const vr = [this.vel[0] - wind[0], this.vel[1] - wind[1], this.vel[2] - wind[2]];
      const tas = Math.hypot(vr[0], vr[1], vr[2]);
      const ias = tas * Math.sqrt(atm.sigma);
      let hdg = Math.atan2(f[0], -f[2]) / D2R; if (hdg < 0) hdg += 360;
      const gs = Math.hypot(this.vel[0], this.vel[2]);
      let trk = Math.atan2(this.vel[0], -this.vel[2]) / D2R; if (trk < 0) trk += 360;
      const aS = 0.25 - 0.03 * this.flap;
      return {
        iasKt: ias * KT, tasKt: tas * KT, gsKt: gs * KT, altFt: (this.pos[1] + ELEV) * FT,
        aglFt: (this.pos[1] - terrainHeight(this.pos[0], this.pos[2]) - 1.3) * FT,
        vsFpm: this.vel[1] * FPM, hdg, trk,
        pitch: Math.asin(clamp(f[1], -1, 1)) / D2R, roll: Math.atan2(-r[1], u[1]) / D2R,
        alphaDeg: this.alpha / D2R, betaDeg: this.beta / D2R, g: this.gLoad,
        rpm: this.rpm, map: this.map, flowGph: this.flow, fuelL: this.fuel, egtF: this.egt, oilF: this.oilT,
        oilPsi: this.engineOn && this.fuel > 0 ? 25 + 45 * (this.rpm / AC.rpmMax) : 0,
        throttlePct: this.in.throttle * 100, flapDeg: this.flap * 30, gearPos: this.gearPos,
        trim: this.in.trim, stallWarn: this.alpha > aS - 0.05 && !this.onGround,
        stalled: this.alpha > aS && !this.onGround, onGround: this.onGround, brake: this.in.brake,
        thrust: this.thrust, windKt: this.wind.speed, windDir: this.wind.dir,
        overspeedFlaps: this.flap > 0.05 && ias * KT > 103, gearWarn: this.gearPos > 0.05 && ias * KT > 130,
        lowFuel: this.fuel < 20, fuelOut: this.fuel <= 0, crashed: this.crashed,
        fpa: tas > 3 ? Math.asin(clamp(this.vel[1] / Math.max(Math.hypot(...this.vel), 0.1), -1, 1)) / D2R : 0,
        drift: ((trk - hdg + 540) % 360) - 180
      };
    }
  }

  global.FlightSim = { Sim, AC, terrainHeight, atmosphere, ELEV, KT, FT, FPM, FLAP_STEPS, qrot, qconj, clamp, smooth, hash, vnoise, GEAR_PTS };
})(window);
