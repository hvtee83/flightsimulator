'use strict';
/* Keyboard + gamepad/joystick input -> sim.in controls. */
(function (global) {
  const clamp = global.FlightSim.clamp;
  class Input {
    constructor(sim, handlers) {
      this.sim = sim; this.h = handlers; this.keys = new Set(); this.stick = { pitch: 0, roll: 0, yaw: 0 };
      this.padInfo = ''; this.padPrev = {}; this.usingPad = false;
      window.addEventListener('keydown', e => this.down(e));
      window.addEventListener('keyup', e => { this.keys.delete(e.code); });
      window.addEventListener('blur', () => this.keys.clear());
      window.addEventListener('gamepadconnected', e => { this.padInfo = e.gamepad.id; });
      window.addEventListener('gamepaddisconnected', () => { this.padInfo = ''; });
    }
    down(e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code !== 'Escape') return;
      const c = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Tab'].includes(c)) e.preventDefault();
      if (e.repeat) { return; }
      this.keys.add(c);
      const s = this.sim, I = s.in, h = this.h;
      switch (c) {
        case 'KeyG': I.gearDown = !I.gearDown; h.msg('Gear ' + (I.gearDown ? 'DOWN' : 'UP')); break;
        case 'KeyF': if (I.flapIdx < 3) I.flapIdx++; h.msg('Flaps ' + [0, 10, 20, 30][I.flapIdx] + '°'); break;
        case 'KeyV': if (I.flapIdx > 0) I.flapIdx--; h.msg('Flaps ' + [0, 10, 20, 30][I.flapIdx] + '°'); break;
        case 'KeyC': h.cam(); break;
        case 'KeyH': h.hud(); break;
        case 'KeyI': h.panel(); break;
        case 'KeyP': case 'Escape': h.pause(); break;
        case 'F1': case 'Slash': case 'KeyK': e.preventDefault(); h.help(); break;
        case 'KeyR': h.restart(); break;
        case 'KeyN': h.night(); break;
        case 'KeyM': h.mute(); break;
        case 'Digit1': h.setCam(0); break; case 'Digit2': h.setCam(1); break; case 'Digit3': h.setCam(2); break; case 'Digit4': h.setCam(3); break;
      }
    }
    key(...c) { return c.some(k => this.keys.has(k)); }
    update(dt) {
      const s = this.sim, I = s.in, K = this;
      let tp = (K.key('ArrowDown') ? 1 : 0) - (K.key('ArrowUp') ? 1 : 0);
      let tr = (K.key('ArrowRight') ? 1 : 0) - (K.key('ArrowLeft') ? 1 : 0);
      let ty = (K.key('KeyE', 'KeyD') ? 1 : 0) - (K.key('KeyQ', 'KeyA') ? 1 : 0);
      const move = (cur, tgt, rate, ret) => { const r = tgt === 0 ? ret : rate; const d = tgt - cur; return cur + clamp(d, -r * dt, r * dt); };
      this.stick.pitch = move(this.stick.pitch, tp, 2.6, 3.5);
      this.stick.roll = move(this.stick.roll, tr, 3.0, 4.5);
      this.stick.yaw = move(this.stick.yaw, ty, 3.0, 4.0);
      let pitch = this.stick.pitch, roll = this.stick.roll, yaw = this.stick.yaw, brake = K.key('KeyB', 'Space') ? 1 : 0;
      if (K.key('KeyW', 'PageUp')) I.throttle = clamp(I.throttle + 0.45 * dt, 0, 1);
      if (K.key('KeyS', 'PageDown')) I.throttle = clamp(I.throttle - 0.45 * dt, 0, 1);
      if (K.key('Digit0', 'Numpad0')) I.throttle = 0;
      if (K.key('Digit9', 'Numpad9')) I.throttle = 1;
      if (K.key('BracketRight', 'KeyX', 'Equal')) I.trim = clamp(I.trim + 0.12 * dt, -1, 1);
      if (K.key('BracketLeft', 'KeyZ', 'Minus')) I.trim = clamp(I.trim - 0.12 * dt, -1, 1);
      // gamepad
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null; for (const p of pads) if (p && p.connected) { pad = p; break; }
      this.usingPad = !!pad;
      if (pad) {
        const dz = v => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
        const ax = i => pad.axes[i] || 0, bt = i => pad.buttons[i] ? pad.buttons[i].value : 0;
        const prev = this.padPrev, edge = i => { const p = bt(i) > 0.5, r = p && !prev[i]; prev[i] = p; return r; };
        const px = dz(ax(0)), py = dz(ax(1)), rx = dz(ax(2)), ry = dz(ax(3));
        if (px) roll = clamp(roll + px, -1, 1);
        if (py) pitch = clamp(pitch + py, -1, 1);
        if (rx) yaw = clamp(yaw + rx, -1, 1);
        // right stick Y (up = more power), D-pad up/down also adjust throttle
        if (ry) I.throttle = clamp(I.throttle - ry * 0.5 * dt, 0, 1);
        if (bt(12) > 0.5) I.throttle = clamp(I.throttle + 0.4 * dt, 0, 1);
        if (bt(13) > 0.5) I.throttle = clamp(I.throttle - 0.4 * dt, 0, 1);
        brake = Math.max(brake, bt(1), bt(6));
        if (bt(7) > 0.1 && !ry) I.throttle = clamp(I.throttle + (bt(7)) * 0.5 * dt, 0, 1);
        if (bt(4) > 0.5) I.trim = clamp(I.trim - 0.12 * dt, -1, 1);
        if (bt(5) > 0.5) I.trim = clamp(I.trim + 0.12 * dt, -1, 1);
        if (edge(0)) { I.gearDown = !I.gearDown; this.h.msg('Gear ' + (I.gearDown ? 'DOWN' : 'UP')); }
        if (edge(3) && I.flapIdx < 3) { I.flapIdx++; this.h.msg('Flaps ' + [0, 10, 20, 30][I.flapIdx] + '°'); }
        if (edge(2) && I.flapIdx > 0) { I.flapIdx--; this.h.msg('Flaps ' + [0, 10, 20, 30][I.flapIdx] + '°'); }
        if (edge(8)) this.h.cam();
        if (edge(9)) this.h.pause();
        if (edge(10)) this.h.hud();
      }
      I.pitch = clamp(pitch, -1, 1); I.roll = clamp(roll, -1, 1); I.yaw = clamp(yaw, -1, 1); I.brake = brake;
    }
    // In pause menu only the pause/gamepad start button should work
    updatePausedPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) { const pr = p.buttons[9] && p.buttons[9].pressed; if (pr && !this.padPrev[9]) this.h.pause(); this.padPrev[9] = pr; }
    }
  }
  global.Input = Input;
})(window);
