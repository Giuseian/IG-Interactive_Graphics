// hud.js
// -----------------------------------------------------------------------------
// initHUD()
//  - Inietta stile e markup dell’HUD (due skin: 'pixel' | 'neo')
//  - Espone una piccola API per aggiornare pannelli e indicatori:
//      set(health01, heat01, score, { overheated, beamOn })
//      setSanctuary({ state, t, safe, uiDim })
//      setIndicators(items)         // offscreen arrows
//      setControlsHandlers({...})   // callbacks dei keycaps UI
//      setDayNightIcon(isNight)     // 🌙 / ☀︎
//      setDebugActive(on)           // evidenzia tasto debug
//  - Non dipende da framework; puro DOM + CSS.
// -----------------------------------------------------------------------------

export function initHUD() {
  /* ============================== SKIN ============================== */

  const VALID_SKINS = new Set(['pixel', 'neo']);
  const SKIN = (() => {
    const qs = new URLSearchParams(location.search).get('skin');
    const ls = localStorage.getItem('hudSkin');
    return VALID_SKINS.has(qs) ? qs : (VALID_SKINS.has(ls) ? ls : 'pixel');
  })();

  /* ============================== STILI ============================= */

  if (!document.getElementById('hud-style')) {
    const style = document.createElement('style');
    style.id = 'hud-style';

    let css = `
      :root{
        --hud-fg:#e8f1ff;
        --hud-muted:#a8b4c4;
        --hud-danger:#ff6b6b;
        --tab-ink:#bcd7ff;
      }
      .hud-hide{ display:none !important; }
      .hud-stack{ position:fixed; z-index:10000; pointer-events:none; }
      .hud-stack > *{ pointer-events:auto; }

      .meter{ position:relative; height:10px; border-radius:3px; overflow:hidden; background:#0e1622; }
      .meter.micro{ height:8px; }
      .meter > .fill{ position:absolute; inset:0; width:0%; transition: width .12s ease; }
      @keyframes hudPulseRed { 0%{opacity:1} 50%{opacity:.55} 100%{opacity:1} }

      /* Offscreen indicators */
      #indicator-layer{ position:fixed; inset:0; pointer-events:none; z-index:9997; }
      .indic{ position:absolute; width:28px; height:28px; margin:-14px 0 0 -14px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0 2px 4px #000a); }
      .indic .arrow{ width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid var(--col,#93c5fd); }
      .indic.info{--col:#93c5fd}.indic.warn{--col:#fbbf24}.indic.danger{--col:#ff6b6b}

      /* Hearts */
      .hearts{ display:flex; gap:8px; align-items:center; margin:6px 0; }
      .hearts .h{
        font-size:16px; filter: drop-shadow(0 1px 0 #0006);
        transition: opacity .15s ease, transform .15s ease, filter .15s ease;
      }
      .hearts .h.dim{ opacity:.4; filter: grayscale(.15) saturate(.8); }
      .hearts .h.off{ opacity:0; transform: scale(.8); pointer-events:none; }

      /* Keycaps + dim */
      .keycap.on{box-shadow: 0 0 12px #22e3ff80, inset 0 0 0 2px #22e3ff55; }
      .hud-dim{ opacity:.45; filter: grayscale(.2) saturate(.85); transition: opacity .18s ease, filter .18s ease; }
    `;

    /* ===== Skin: PIXEL RETRO ===== */
    if (SKIN === 'pixel') {
      css += `
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@900&display=swap');

        .tile{
          font-family: "Press Start 2P", ui-monospace, monospace;
          font-size: 11px; letter-spacing: .4px; color: var(--hud-fg);
          background:#0b1220; image-rendering: pixelated;
          border:2px solid #09101b; box-shadow: 0 0 0 2px #1a2a44, 4px 4px 0 #0008;
          border-radius: 6px; padding:10px 12px; min-width: 160px;
        }
        .tile.compact{ min-width: 140px; }
        .tabTitle{
          font-family:"Cinzel", serif; font-weight:900; letter-spacing:.08em;
          color:var(--tab-ink); text-transform:uppercase;
          display:inline-block; padding:4px 10px 5px; margin:-6px -6px 8px;
          background: linear-gradient(#2a3b55, #1d2a41);
          border:2px solid #09101b; box-shadow: 0 2px 0 #0008, 0 0 0 2px #1a2a44 inset;
          border-radius: 8px 8px 8px 2px;
          text-shadow: 0 1px 0 #000, 0 0 8px #8fb6ff55;
        }
        .badge{ display:inline-block; padding:3px 6px; border:2px solid #09101b; background:#112036; color:#cfe3ff; border-radius:4px; }
        .badge.off{ background:#1a2638; color:#b9c5d6; }
        .badge.on{  background:#13311c; color:#bfffd9; }
        .badge.over{ background:#3a1518; color:#ffd2d2; animation: hudPulseRed 0.85s infinite; }

        .meter{ background:#0c1626; border:2px solid #09101b; }
        .meter > .fill{
          background: repeating-linear-gradient(90deg, #2ad5ff 0 6px, #38afff 6px 12px);
          box-shadow: inset 0 0 0 2px #09101b;
        }
        .meter.heat > .fill{ background: repeating-linear-gradient(90deg, #3ce97e 0 6px, #30c96a 6px 12px); }
        .meter.heat.over > .fill{
          background: repeating-linear-gradient(90deg, #ff6b6b 0 6px, #ff3b3b 6px 12px);
        }
      `;
    }

    /* ===== Skin: NEO ===== */
    if (SKIN === 'neo') {
      css += `
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@900&display=swap');
        .tile{
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: var(--hud-fg); background: #1c2634dd; backdrop-filter: blur(6px);
          border-radius: 12px; padding: 12px 14px; min-width: 180px;
          box-shadow: 0 14px 32px #0008, inset 0 1px 0 #fff1;
        }
        .tile.compact{ min-width: 160px; }
        .tabTitle{
          font-family:"Cinzel", serif; font-weight:900; letter-spacing:.08em;
          color:var(--tab-ink); text-transform:uppercase;
          display:inline-block; padding:6px 12px; margin:-8px -8px 10px;
          background: linear-gradient(#2a3b55, #1d2a41);
          border-radius:10px;
          box-shadow: 0 6px 16px #0005, inset 0 1px 0 #ffffff22;
          text-shadow: 0 1px 0 #000, 0 0 10px #8fb6ff55;
        }
        .badge{ padding: 2px 8px; border-radius: 999px; background:#33415566; color:#cbd5e1; font-weight:700; font-size:12px; }
        .badge.off{ background:#47556944 }.badge.on{ background:#16a34a33; color:#bbf7d0 }.badge.over{ background:#ef444433; color:#fecaca; animation: hudPulseRed .85s infinite }
        .meter{ background: linear-gradient(#0000,#0002), #0f172a; border-radius:999px; }
        .meter > .fill{ background: linear-gradient(90deg, #16d6a3, #19b88a); box-shadow: 0 0 10px #16d6a380; }
      `;
    }

    /* ===== Badge stato Sanctuary (comune) ===== */
    css += `
      .badge.state{ transition: filter .12s ease, box-shadow .12s ease, background-color .12s ease, color .12s ease; }
      .badge.state.idle{ background:#112036; color:#cfe3ff; box-shadow:none; animation:none; }
      .badge.state.armed{ background:#3a1518; color:#ffd2d2; box-shadow:0 0 12px #ff6b6b66, inset 0 0 8px #ff6b6b33; animation: hudPulseRed .85s infinite; }
      .badge.state.purifying{ background:#3a2a15; color:#ffe6b3; box-shadow:0 0 10px #f59e0b55, inset 0 0 6px #f59e0b33; animation:none; }
      .badge.state.done{ background:#13311c; color:#bfffd9; box-shadow:0 0 10px #10b98155, inset 0 0 6px #10b98133; animation:none; }
    `;

    style.textContent = css;
    document.head.appendChild(style);
  }

  // Stile keycaps (una sola volta)
  if (!document.getElementById('hud-style-keycaps')) {
    const cs = document.createElement('style'); cs.id = 'hud-style-keycaps';
    cs.textContent = `
      .keycap{
        width:56px;height:56px;border:0;border-radius:12px;cursor:pointer;
        color:#e8f1ff;background:#1f2a3aee;backdrop-filter:blur(4px);
        box-shadow:0 10px 24px #0009, inset 0 1px 0 #ffffff22;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
      }
      .keycap .k{font-weight:800;font-size:18px;line-height:1;margin-bottom:2px}
      .keycap small{font-size:10px;opacity:.8;letter-spacing:.2px}
      .keycap.key-accent{background:#17445fee}
      .keycap.on{box-shadow:0 0 14px #22f3, inset 0 1px 0 #ffffff33; background:#216a8bee}
      #hud-keys .keycap:active{ transform:translateY(1px); }
    `;
    document.head.appendChild(cs);
  }

  /* ============================== MARKUP ============================= */

  const root  = document.createElement('div'); root.id = 'hud-root';
  const left  = document.createElement('div'); left.id  = 'hud-left';  left.className  = 'hud-stack'; left.style.left = '14px'; left.style.top = '14px';
  const right = document.createElement('div'); right.id = 'hud-right'; right.className = 'hud-stack';
  Object.assign(right.style, { right: '14px', top: '14px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-end' });
  root.appendChild(left); root.appendChild(right);
  document.body.appendChild(root);

  // Sanctuary tile (LEFT)
  const leftSanct = document.createElement('div');
  leftSanct.className = 'tile compact';
  leftSanct.innerHTML = `
    <div class="tabTitle">SANCTUARY</div>
    <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
      <span id="hud-sanct-state" class="badge state idle">idle</span>
      <span id="hud-sanct-pct" class="badge">0%</span>
      <span id="hud-sanct-safe" class="badge hud-hide">SAFE</span>
    </div>
    <div class="meter micro" id="hud-sanct-meter"><div class="fill" id="hud-sanct-fill"></div></div>
  `;
  left.appendChild(leftSanct);

  // RIGHT: Health
  const tHealth = document.createElement('div');
  tHealth.className = 'tile';
  tHealth.innerHTML = `
    <div class="tabTitle">HEALTH</div>
    <div class="hearts"><span class="h">❤️</span><span class="h">❤️</span><span class="h">❤️</span></div>
    <div class="meter micro" id="hud-health-meter"><div class="fill" id="hud-health-fill"></div></div>
    <div style="display:flex; justify-content:space-between; gap:10px; margin-top:6px;">
      <span class="badge">hp</span><span class="badge" id="hud-health-text">100</span>
    </div>`;
  right.appendChild(tHealth);

  // RIGHT: Score
  const tScore = document.createElement('div');
  tScore.className = 'tile compact';
  tScore.innerHTML = `<div class="tabTitle">SCORE</div>
    <div style="font-size:16px;color:#fff;text-shadow:1px 1px 0 #000" id="hud-score-text">0</div>`;
  right.appendChild(tScore);

  // RIGHT: Beam/Heat
  const tBeam = document.createElement('div');
  tBeam.className = 'tile compact';
  tBeam.innerHTML = `
    <div class="tabTitle">BEAM</div>
    <div class="meter heat" id="hud-heat-meter"><div class="fill" id="hud-heat-fill"></div></div>
    <div style="display:flex; gap:6px; margin-top:6px; justify-content:space-between;">
      <span class="badge" id="hud-heat-text" title="heat">0%</span>
      <span class="badge off" id="hud-beam-state" title="beam power">off</span>
    </div>`;
  right.appendChild(tBeam);

  // Bottom-center: keycaps
  const keys = document.createElement('div');
  keys.id = 'hud-keys';
  keys.innerHTML = `
    <button id="key-minus" class="keycap" title="Narrow beam (,)">
      <span class="k">–</span><small>cone</small>
    </button>
    <button id="key-plus" class="keycap" title="Widen beam (.)">
      <span class="k">+</span><small>cone</small>
    </button>
    <button id="key-beam" class="keycap key-accent" title="F: Beam ON/OFF">
      <span class="k">F</span><small>beam</small>
    </button>
    <button id="key-nd" class="keycap" title="Night / Day">
      <span class="k" id="key-nd-ico">🌙</span><small>mode</small>
    </button>
    <button id="key-debug" class="keycap" title="Debug">
      <span class="k">F3</span><small>debug</small>
    </button>
  `;
  Object.assign(keys.style, {
    position: 'fixed',
    left: '50%',
    bottom: '40px',
    transform: 'translateX(-50%)',
    zIndex: 10001,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    pointerEvents: 'auto'
  });
  document.body.appendChild(keys);

  /* =========================== INDICATORS =========================== */

  // Offscreen indicators (pooled)
  const indicLayer = document.createElement('div'); indicLayer.id = 'indicator-layer'; document.body.appendChild(indicLayer);
  const indicPool = [];
  function _getIndicEl() {
    for (const it of indicPool) if (!it.busy) { it.busy = true; it.el.style.display = 'block'; return it; }
    const el = document.createElement('div'); el.className = 'indic info';
    const arrow = document.createElement('div'); arrow.className = 'arrow'; el.appendChild(arrow);
    indicLayer.appendChild(el);
    const rec = { el, arrow, busy: true }; indicPool.push(rec); return rec;
  }
  function _releaseAll() { for (const it of indicPool) { it.busy = false; it.el.style.display = 'none'; } }

  // Diamond indicator for totem (edge hint)
  const totemEl = document.createElement('div');
  totemEl.id = 'totem-edge';
  totemEl.style.cssText = `
    position:fixed; left:-9999px; top:-9999px; z-index:9998;
    width:18px; height:18px; 
    border:3px solid #7ee3ff; border-radius:4px;
    box-shadow:0 0 12px #7ee3ff80, inset 0 0 8px #7ee3ff60;
    background: radial-gradient(#bff4ff80 12%, transparent 70%);
    transform: translate(-50%,-50%) rotate(45deg) scale(1);
    opacity:0; pointer-events:none;
  `;
  document.body.appendChild(totemEl);

  /* ============================= HANDLES ============================ */

  const els = {
    heartEls:  tHealth.querySelectorAll('.hearts .h'),
    healthFill: document.getElementById('hud-health-fill'),
    healthText: document.getElementById('hud-health-text'),
    heatFill:   document.getElementById('hud-heat-fill'),
    heatText:   document.getElementById('hud-heat-text'),
    heatMeter:  document.getElementById('hud-heat-meter'),
    beamBadge:  document.getElementById('hud-beam-state'),
    scoreText:  document.getElementById('hud-score-text'),
    sanctFill:  document.getElementById('hud-sanct-fill'),
    sanctPct:   document.getElementById('hud-sanct-pct'),
    sanctState: document.getElementById('hud-sanct-state'),
    sanctSafe:  document.getElementById('hud-sanct-safe')
  };

  /* ============================ UTILITIES =========================== */

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixColor = (c1, c2, t) =>
    '#' + [0, 1, 2].map(i => Math.round(lerp(c1[i], c2[i], t)).toString(16).padStart(2, '0')).join('');
  const blue = [32, 184, 255], yellow = [248, 225, 108], red = [255, 107, 107];
  function heatColor(t) {
    t = clamp01(t);
    const m = 0.6;
    return t < m ? mixColor(blue, yellow, t / m) : mixColor(yellow, red, (t - m) / (1 - m));
  }

  /* =============================== API ============================== */

  // Stato tasti (callbacks impostabili dal main)
  const _handlers = {
    onConePlus: null,
    onConeMinus: null,
    onBeamToggle: null,
    onDayNightToggle: null,
    onDebugToggle: null,
  };
  // Keycaps
  const btnMinus = document.getElementById('key-minus');
  const btnPlus  = document.getElementById('key-plus');
  const btnBeam  = document.getElementById('key-beam');
  const btnND    = document.getElementById('key-nd');
  const icoND    = document.getElementById('key-nd-ico');
  const btnDebug = document.getElementById('key-debug');

  btnMinus.onclick = () => _handlers.onConeMinus?.();
  btnPlus.onclick  = () => _handlers.onConePlus?.();
  btnBeam.onclick  = () => _handlers.onBeamToggle?.();
  btnND.onclick    = () => _handlers.onDayNightToggle?.();
  btnDebug.onclick = () => _handlers.onDebugToggle?.();

  function setControlsHandlers(h = {}) { Object.assign(_handlers, h); }
  function setDebugActive(on) { btnDebug.classList.toggle('on', !!on); }
  function setDayNightIcon(isNight) { icoND.textContent = isNight ? '🌙' : '☀︎'; }

  // HUD principale (health, heat/beam, score)
  function set(health01, heat01, score, { overheated = false, beamOn = false } = {}) {
    const h = clamp01(health01 ?? 1);
    const t = clamp01(heat01 ?? 0);

    // Health bar + text
    els.healthFill.style.width = `${Math.round(h * 100)}%`;
    els.healthText.textContent = Math.round(h * 100);

    // Hearts (3 segmenti)
    const segments = h * 3;
    const full = Math.floor(segments + 1e-6);
    const frac = segments - full;
    els.heartEls.forEach((node, i) => {
      node.classList.remove('dim', 'off');
      if (i < full) {
        // pieno
      } else if (i === full && frac > 0) {
        node.classList.add('dim');
      } else {
        node.classList.add('off');
      }
    });

    // Heat bar + color + stato overheat
    els.heatFill.style.width = `${Math.round(t * 100)}%`;
    els.heatText.textContent = `${Math.round(t * 100)}%`;
    els.heatMeter.classList.toggle('over', !!overheated);
    if (!overheated) {
      els.heatFill.style.background = (SKIN === 'pixel')
        ? `repeating-linear-gradient(90deg, ${heatColor(t)} 0 6px, ${heatColor(Math.max(0, t - 0.15))} 6px 12px)`
        : `linear-gradient(90deg, ${heatColor(t)}, ${heatColor(Math.max(0, t - 0.15))})`;
    }

    // Beam badge + keycap highlight
    if (overheated) {
      els.beamBadge.textContent = 'overheated'; els.beamBadge.className = 'badge over';
    } else if (beamOn) {
      els.beamBadge.textContent = 'on'; els.beamBadge.className = 'badge on';
    } else {
      els.beamBadge.textContent = 'off'; els.beamBadge.className = 'badge off';
    }
    btnBeam.classList.toggle('on', !!beamOn);

    // Score
    els.scoreText.textContent = String(score ?? 0);
  }

  // Pannello Sanctuary
  function setSanctuary(info) {
    const state = info?.state || 'idle';
    const tIn = clamp01(info?.t ?? 0);

    // Barra: se DONE → azzera (pronta per il prossimo)
    const tBar = (state === 'done') ? 0 : tIn;
    els.sanctFill.style.width = `${Math.round(tBar * 100)}%`;
    els.sanctPct.textContent = `${Math.round(tBar * 100)}%`;

    // Stato badge + glow
    els.sanctState.textContent = state;
    els.sanctState.className = `badge state ${state}`;

    // Colore barra coerente con stato
    const tint = (s) => ({ idle: '#3b82f6', armed: '#ef4444', purifying: '#f59e0b', done: '#10b981' }[s] || '#3b82f6');
    els.sanctFill.style.background = (SKIN === 'pixel')
      ? `repeating-linear-gradient(90deg, ${tint(state)} 0 6px, ${tint(state)}cc 6px 12px)`
      : `linear-gradient(90deg, ${tint(state)}, ${tint(state)}cc)`;

    // SAFE badge + dim pannello
    els.sanctSafe?.classList.toggle('hud-hide', !(info?.safe));
    leftSanct.classList.toggle('hud-dim', !!info?.uiDim);
  }

  // (placeholder per futuri debug toggles)
  function setDebug() {}

  // Offscreen indicators (arrows)
  function setIndicators(items = []) {
    _releaseAll();
    for (const it of items) {
      const rec = _getIndicEl();
      rec.el.className = `indic ${it.severity || 'info'}`;
      const a = clamp01(it.alpha ?? 1);
      const s = Math.max(0.5, Math.min(1.3, it.scale ?? 1));
      const ang = (it.ang ?? 0) + Math.PI * 0.5;
      rec.el.style.opacity = a.toFixed(3);
      rec.el.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) rotate(${ang}rad) scale(${s})`;
    }
  }

  // Indicatore rombo per totem (non esposto, ma pronto all’uso se servisse)
  function setTotemIndicator(item) {
    if (!item) {
      totemEl.style.left = '-9999px';
      totemEl.style.top = '-9999px';
      totemEl.style.opacity = '0';
      totemEl.style.transform = `translate(-50%,-50%) rotate(45deg) scale(1)`;
      return;
    }
    const a = clamp01(item.alpha ?? 1);
    const s = Math.max(0.5, Math.min(1.3, item.scale ?? 1));
    const ang = (item.ang ?? 0) + Math.PI * 0.25;
    totemEl.style.left = Math.round(item.x) + 'px';
    totemEl.style.top  = Math.round(item.y) + 'px';
    totemEl.style.opacity = String(a);
    totemEl.style.transform = `translate(-50%,-50%) rotate(${ang}rad) scale(${s})`;
  }

  // Stato iniziale
  set(1, 0, 0, { overheated: false, beamOn: false });

  // Helper: cambiare skin al volo (debug)
  window.__setHudSkin = (skin) => {
    if (!VALID_SKINS.has(skin)) return;
    localStorage.setItem('hudSkin', skin);
    location.reload();
  };

  // API pubblica (stessa della versione originale)
  return {
    root,
    set,
    setSanctuary,
    setDebug,
    setIndicators,
    setControlsHandlers,
    setDayNightIcon,
    setDebugActive,
    // setTotemIndicator // <- se mai servisse, basta esporlo qui
  };
}
