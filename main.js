'use strict';
(function () {
  const FS = window.FlightSim, $ = id => document.getElementById(id);
  if (typeof THREE === 'undefined') {
    $('fatal').style.display = 'flex';
    return;
  }
  const sim = new FS.Sim();
  const world = new World($('view'));
  const pfd = new Instruments.PFD($('pfd')), eng = new Instruments.Engine($('eng')), hud = new Instruments.HUD($('hud'));
  let paused = false, showHud = true, showPanel = true, helpOpen = true, started = false, lastMode = 'runway', muted = false;
  window.__sim = sim; window.__world = world; // handy for debugging

  // ---------- messages ----------
  let msgTimer = 0;
  function msg(t) { const m = $('toast'); m.textContent = t; m.classList.add('on'); clearTimeout(msgTimer); msgTimer = setTimeout(() => m.classList.remove('on'), 1800); }

  // ---------- audio ----------
  let actx = null, osc1, osc2, gain, horn, hornG, noise, noiseG;
  function audioInit() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const master = actx.createGain(); master.gain.value = 0.35; master.connect(actx.destination); window.__master = master;
      osc1 = actx.createOscillator(); osc1.type = 'sawtooth'; osc2 = actx.createOscillator(); osc2.type = 'square';
      gain = actx.createGain(); gain.gain.value = 0.0;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      osc1.connect(lp); osc2.connect(lp); lp.connect(gain); gain.connect(master); osc1.start(); osc2.start();
      horn = actx.createOscillator(); horn.type = 'square'; horn.frequency.value = 880; hornG = actx.createGain(); hornG.gain.value = 0; horn.connect(hornG); hornG.connect(master); horn.start();
      const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noise = actx.createBufferSource(); noise.buffer = buf; noise.loop = true; noiseG = actx.createGain(); noiseG.gain.value = 0;
      const hp = actx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 900; noise.connect(hp); hp.connect(noiseG); noiseG.connect(master); noise.start();
    } catch (e) { actx = null; }
  }
  function audioUpdate(T) {
    if (!actx) return;
    const on = !paused && !muted && !sim.crashed;
    const run = sim.engineOn && sim.fuel > 0;
    const f = Math.max(20, sim.rpm / 60 * 2);
    osc1.frequency.setTargetAtTime(f, actx.currentTime, 0.05); osc2.frequency.setTargetAtTime(f * 1.5, actx.currentTime, 0.05);
    gain.gain.setTargetAtTime(on ? (run ? 0.12 + 0.18 * sim.engThr : 0.03) : 0, actx.currentTime, 0.1);
    hornG.gain.setTargetAtTime(on && T.stallWarn && Math.floor(performance.now() / 150) % 2 === 0 ? 0.12 : 0, actx.currentTime, 0.01);
    noiseG.gain.setTargetAtTime(on ? Math.min(0.25, T.tasKt / 600) : 0, actx.currentTime, 0.1);
  }

  // ---------- controls ----------
  const handlers = {
    msg,
    cam() { world.nextCam(); msg('Camera: ' + world.camNames[world.camMode]); },
    setCam(i) { world.camMode = i; world.camInit = false; msg('Camera: ' + world.camNames[i]); },
    hud() { showHud = !showHud; msg('HUD ' + (showHud ? 'on' : 'off')); },
    panel() { showPanel = !showPanel; $('panel').style.display = showPanel ? 'flex' : 'none'; },
    pause() { if (helpOpen) { toggleHelp(false); return; } setPaused(!paused); },
    help() { toggleHelp(!helpOpen); },
    restart() { restart(lastMode); },
    night() { const t = world.timeOfDay; const n = (t > 7 && t < 18) ? 22 : 12; world.setTime(n); $('tod').value = n; msg(n > 18 ? 'Night' : 'Day'); },
    mute() { muted = !muted; msg(muted ? 'Sound off' : 'Sound on'); }
  };
  const input = new Input(sim, handlers);

  function setPaused(p) {
    paused = p; $('pause').classList.toggle('on', p && !helpOpen);
    if (p) { $('p-tod').value = world.timeOfDay; $('p-wind').value = sim.wind.speed; $('p-wdir').value = sim.wind.dir; $('p-turb').value = sim.wind.turb; updPauseLabels(); }
  }
  function toggleHelp(o) { helpOpen = o; $('help').classList.toggle('on', o); if (o) { audioInit(); } else if (!started) { started = true; } $('pause').classList.toggle('on', paused && !o); }
  function restart(mode) {
    lastMode = mode; sim.reset(mode); world.camInit = false; $('crash').classList.remove('on'); setPaused(false);
    msg(mode === 'runway' ? 'Runway 36 – full throttle, rotate at 55 kt' : mode === 'cruise' ? 'Cruising at 4,000 ft' : 'Final approach – 3° glidepath');
  }
  $('b-resume').onclick = () => setPaused(false);
  $('b-help').onclick = () => { toggleHelp(true); };
  $('b-restart').onclick = () => restart('runway');
  $('b-cruise').onclick = () => restart('cruise');
  $('b-final').onclick = () => restart('final');
  $('b-start').onclick = () => { toggleHelp(false); audioInit(); };
  $('b-crash').onclick = () => restart(lastMode);
  const updPauseLabels = () => { $('l-tod').textContent = Math.floor($('p-tod').value) + ':' + String(Math.round(($('p-tod').value % 1) * 60)).padStart(2, '0'); $('l-wind').textContent = $('p-wind').value + ' kt'; $('l-wdir').textContent = $('p-wdir').value + '°'; $('l-turb').textContent = Math.round($('p-turb').value * 100) + '%'; };
  $('p-tod').oninput = e => { world.setTime(parseFloat(e.target.value)); updPauseLabels(); };
  $('p-wind').oninput = e => { sim.wind.speed = parseFloat(e.target.value); updPauseLabels(); };
  $('p-wdir').oninput = e => { sim.wind.dir = parseFloat(e.target.value); updPauseLabels(); };
  $('p-turb').oninput = e => { sim.wind.turb = parseFloat(e.target.value); updPauseLabels(); };
  window.addEventListener('keydown', () => { if (helpOpen) audioInit(); }, { once: false });
  window.addEventListener('pointerdown', () => { if (!helpOpen) audioInit(); });

  // mouse look / orbit
  let drag = null;
  $('view').addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    if (world.camMode === 0) { world.look.yaw = FS.clamp(world.look.yaw - dx * 0.005, -2.2, 2.2); world.look.pitch = FS.clamp(world.look.pitch - dy * 0.005, -1, 1); }
    else { world.orbitYaw -= dx * 0.008; world.orbitPitch = FS.clamp(world.orbitPitch + dy * 0.008, -0.2, 1.3); }
  });
  $('view').addEventListener('dblclick', () => { world.look.yaw = world.look.pitch = 0; });

  // panel scaling
  function layoutPanel() {
    const w = window.innerWidth, h = window.innerHeight;
    let s = Math.min(1, (w - 20) / 950, (h * 0.46) / 380);
    if (world.camMode !== 0) s *= 0.72;
    $('panel').style.transform = 'translateX(-50%) scale(' + s + ')';
    $('panel').classList.toggle('cockpit', world.camMode === 0);
    $('cockpit').style.display = world.camMode === 0 ? 'block' : 'none';
  }
  window.addEventListener('resize', layoutPanel);

  // ---------- main loop ----------
  let last = performance.now(), acc = 0, frame = 0, fpsT = 0, fps = 0, fpsN = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = Math.min(0.1, (now - last) / 1000); last = now;
    const T0 = sim.tel;
    if (!paused && !helpOpen) {
      input.update(dt);
      acc += dt; const STEP = 1 / 120;
      while (acc >= STEP) { sim.update(STEP); acc -= STEP; }
    } else { input.updatePausedPad(); input.update(0); if (helpOpen) sim.in.brake = 1; }
    const T = sim.tel;
    world.update(sim, paused ? 0 : dt, now / 1000);
    layoutPanel();
    pfd.draw(T); eng.draw(T); hud.draw(T, sim, world, showHud);
    $('status').textContent = world.camNames[world.camMode] + ' view' + (input.usingPad ? '  •  gamepad' : '') + '  •  ' + fps + ' fps';
    audioUpdate(T);
    if (sim.crashed && !$('crash').classList.contains('on')) { $('crash-msg').textContent = sim.crashed; $('crash').classList.add('on'); }
    // touchdown report
    if (sim.touchdownVs != null && sim.time - sim.touchdownT < 0.05 && T.iasKt > 35 && !sim.crashed && !sim._reported) { sim._reported = true; msg('Touchdown: ' + Math.round(sim.touchdownVs) + ' fpm' + (sim.touchdownVs < 200 ? ' – smooth!' : sim.touchdownVs < 500 ? ' – good' : ' – hard')); }
    if (!sim.onGround) sim._reported = false;
    fpsN++; fpsT += dt; if (fpsT > 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  }
  layoutPanel(); updPauseLabels();
  requestAnimationFrame(loop);
})();
