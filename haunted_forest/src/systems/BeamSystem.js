// src/systems/BeamSystem.js
// -----------------------------------------------------------------------------
// BeamSystem
// -----------------------------------------------------------------------------
// Sistema che gestisce:
//  • il “gimbal” del fascio (offset yaw/pitch rispetto alla camera, con smoothing)
//  • il cono visivo (mesh visuale additiva con fade)
//  • il calcolo di exposure sui Ghost entro un cono di metà-angolo e raggio max
//  • l’overheat (salita/discesa calore, blocco temporaneo del firing)
//  • un “focus” per HUD (ghost migliore del frame: weight/dist/exposure)
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * @typedef {Object} BeamOpts
 * @property {THREE.Scene}  [scene]
 * @property {THREE.Camera} [camera]
 * @property {number} [halfAngleDeg=20]  Metà angolo del cono (gradi)
 * @property {number} [maxRange=260]     Distanza massima del raggio (m)
 * @property {number} [exposureRate=4.0] Velocità con cui cresce l’exposure
 * @property {number} [heatRise=0.8]     Velocità di salita del calore
 * @property {number} [heatFall=0.7]     Velocità di raffreddamento
 * @property {number} [overheatHi=1.0]   Soglia di overheat (blocca firing)
 * @property {number} [overheatLo=0.6]   Ripristino da overheat
 * @property {number} [smoothTau=0.12]   Smoothing pos/quaternion (s)
 * @property {number} [yawLimitDeg=35]   Limite offset yaw (± gradi)
 * @property {number} [pitchLimitDeg=25] Limite offset pitch (± gradi)
 * @property {number} [sensX=0.0018]     Sensibilità mouse X → yaw (rad/px)
 * @property {number} [sensY=0.0016]     Sensibilità mouse Y → pitch (rad/px)
 * @property {number} [recenterTau=0.22] Tempo di rientro offset fuori aiming (s)
 * @property {THREE.Object3D[]} [obstacles=[]] Ostacoli per LOS (facoltativo)
 */

export class BeamSystem {
  /** @param {BeamOpts} opts */
  constructor(opts = {}) {
    // --- Dipendenze
    this.scene  = opts.scene;
    this.camera = opts.camera;

    // --- Stato beam
    this.enabled    = true;
    this.firing     = false;
    this.overheated = false;
    this.heat       = 0;

    // --- Parametri gameplay
    this.halfAngleDeg = opts.halfAngleDeg ?? 20;
    this.maxRange     = opts.maxRange     ?? 260;
    this.exposureRate = opts.exposureRate ?? 4.0;

    // --- Overheat
    this.heatRise   = opts.heatRise   ?? 0.8;
    this.heatFall   = opts.heatFall   ?? 0.7;
    this.overheatHi = opts.overheatHi ?? 1.0;
    this.overheatLo = opts.overheatLo ?? 0.6;

    // --- Smoothing
    this.smoothTau = opts.smoothTau ?? 0.12; // s; 0 = no smoothing

    // --- Gimbal (offset rispetto alla camera, controllati dal mouse quando aiming=true)
    this.aiming       = false;
    this.yawOffset    = 0; // rad
    this.pitchOffset  = 0; // rad
    this.yawLimitDeg   = opts.yawLimitDeg   ?? 35; // ±
    this.pitchLimitDeg = opts.pitchLimitDeg ?? 25; // ±
    this.sensX = opts.sensX ?? 0.0018; // rad/px
    this.sensY = opts.sensY ?? 0.0016; // rad/px
    this.recenterTau = opts.recenterTau ?? 0.22;

    // --- Ostacoli per la linea di vista (facoltativi)
    this.obstacles = opts.obstacles || [];

    // --- Cache / scratch
    this._cosHalf   = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
    this._ray       = new THREE.Raycaster();
    this._tmpV      = new THREE.Vector3();
    this._rightCam  = new THREE.Vector3(1, 0, 0);
    this._fwdSmooth = new THREE.Vector3(0, 0, -1);
    this._posSmooth = new THREE.Vector3();
    this._upNeg     = new THREE.Vector3(0, -1, 0); // -Y (serve per allineare il cono)

    // Quaternion smussata del beam + appoggi
    this._beamQuatSmooth = new THREE.Quaternion().copy(this.camera.quaternion);
    this._qTarget = new THREE.Quaternion();
    this._qYaw    = new THREE.Quaternion();
    this._qPitch  = new THREE.Quaternion();

    // HUD/focus
    this.hitsThisFrame   = 0;
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    // Visual
    this._baseOpacity = 0.18;
    this._buildVisual();
  }

  /* ============================================================================
     API pubblica
  ============================================================================ */

  /** Incrementa la metà-ampiezza del cono (deg). */
  incHalfAngle(d = 1) { this.setHalfAngleDeg(this.halfAngleDeg + d); }

  /** Decrementa la metà-ampiezza del cono (deg). */
  decHalfAngle(d = 1) { this.setHalfAngleDeg(this.halfAngleDeg - d); }

  /** Aumenta la portata massima (m). */
  incRange(d = 10) { this.setMaxRange(this.maxRange + d); }

  /** Diminuisce la portata massima (m). */
  decRange(d = 10) { this.setMaxRange(Math.max(2, this.maxRange - d)); }

  /** Abilita il firing se non surriscaldato. */
  setFiring(v) { this.firing = !!v && !this.overheated; }

  /** Setta metà-ampiezza (clamp: [2°,45°]) e aggiorna il coseno interno. */
  setHalfAngleDeg(a) {
    this.halfAngleDeg = THREE.MathUtils.clamp(a, 2, 45);
    this._cosHalf = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
  }

  /** Setta il raggio massimo (m). */
  setMaxRange(r) { this.maxRange = Math.max(2, r); }

  /** Imposta la lista di ostacoli per il test di linea di vista (facoltativo). */
  setObstacles(list) { this.obstacles = list || []; }

  /** Abilita/disabilita modalità aiming (il mouse muove yaw/pitch del beam). */
  setAiming(on) { this.aiming = !!on; }

  /** Mouse delta per l’aiming (richiamato dal main quando RMB è tenuto). */
  onAimMouseDelta(dx, dy) {
    if (!this.aiming) return;
    this.yawOffset   += dx * this.sensX;   // dx>0 ⇒ yaw a destra
    this.pitchOffset -= dy * this.sensY;   // dy>0 (mouse giù) ⇒ pitch giù
    const yawLim   = THREE.MathUtils.degToRad(this.yawLimitDeg);
    const pitchLim = THREE.MathUtils.degToRad(this.pitchLimitDeg);
    this.yawOffset   = THREE.MathUtils.clamp(this.yawOffset, -yawLim,   yawLim);
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset, -pitchLim, pitchLim);
  }

  /** Quaternion attuale del beam (riferimento interno; non clonare). */
  getBeamQuaternion() { return this._beamQuatSmooth; }

  /** Forward del beam (unit vector). */
  getBeamForward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this._beamQuatSmooth).normalize();
  }

  /** Punto di origine (apice) del beam (posizione smussata della camera). */
  getBeamApex(out = new THREE.Vector3()) { return out.copy(this._posSmooth); }

  /** Info per HUD/debug sul bersaglio corrente. */
  getFocusInfo() {
    return {
      ghost:    this.focusedGhost,
      exposure: this.focusedExposure,
      weight:   this.focusedWeight,
      dist:     this.focusedDist
    };
  }

  /* ============================================================================
     Update loop
  ============================================================================ */

  /**
   * Aggiorna beam + exposure sui ghost (chiamato ad ogni frame).
   * @param {number} dt               Delta-time in secondi
   * @param {Iterable<any>} ghostsIterable  Collezione dei Ghost attivi
   */
  update(dt, ghostsIterable) {
    this._updateHeat(dt);

    // Posizione apice smussata verso la camera
    const camPos = this.camera.position;
    if (this.smoothTau > 0) {
      const a = 1 - Math.exp(-dt / this.smoothTau);
      if (this._posSmooth.lengthSq() === 0) this._posSmooth.copy(camPos);
      this._posSmooth.lerp(camPos, a);
    } else {
      this._posSmooth.copy(camPos);
    }

    // Quaternion target = camera * yaw * pitch
    this._rightCam.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    this._qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOffset);
    this._qPitch.setFromAxisAngle(this._rightCam, this.pitchOffset);
    this._qTarget.copy(this.camera.quaternion).multiply(this._qYaw).multiply(this._qPitch);

    // Smoothing della quaternion del beam
    const aQ = this.smoothTau > 0 ? (1 - Math.exp(-dt / this.smoothTau)) : 1.0;
    this._beamQuatSmooth.slerp(this._qTarget, aQ);

    // Fuori aiming: ritorno morbido verso 0 di yaw/pitch
    if (!this.aiming) {
      const k = Math.exp(-dt / this.recenterTau);
      this.yawOffset   *= k;
      this.pitchOffset *= k;
    }

    // Forward derivata dalla quaternion smussata
    this._fwdSmooth.set(0, 0, -1).applyQuaternion(this._beamQuatSmooth).normalize();

    // Reset frame
    let visualLen = this.maxRange;
    this.hitsThisFrame   = 0;
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    // Calcolo exposure
    if (this.enabled && this.firing && !this.overheated && ghostsIterable) {
      for (const g of ghostsIterable) {
        if (!g || !g.root || g.state !== 'active') continue;

        // Punto “aim” (un po’ sopra il terreno)
        const aim = this._tmpV.copy(g.root.position);
        aim.y += 1.0;

        // Vettore apice→ghost
        const to   = this._tmpV.clone().subVectors(aim, this._posSmooth);
        const dist = to.length();
        if (dist > this.maxRange || dist < 1e-3) continue;
        to.multiplyScalar(1 / dist);

        // Test nel cono (dot con forward del beam)
        const cosAng = to.dot(this._fwdSmooth);
        if (cosAng < this._cosHalf) continue;

        // Line-of-sight (facoltativo)
        if (!this._hasLOS(this._posSmooth, aim, dist)) continue;

        // Peso combinato: “centratura” nel cono + vicinanza
        const wAngle = (cosAng - this._cosHalf) / (1 - this._cosHalf);
        const wDist  = 1 - (dist / this.maxRange);
        const weight = THREE.MathUtils.clamp(0.5 * wAngle + 0.5 * wDist, 0, 1);

        // Focus “miglior bersaglio”
        if (weight > this.focusedWeight) {
          this.focusedWeight = weight;
          this.focusedGhost  = g;
          this.focusedDist   = dist;
        }

        // Exposure sul ghost
        const cleansed = g.applyExposure(this.exposureRate * weight * dt);
        if (cleansed) this.hitsThisFrame++;

        // Troncamento visuale sul primo ostacolo/ghost colpito più vicino
        if (dist < visualLen) visualLen = dist;
      }

      // HUD exposure corrente
      this.focusedExposure = this.focusedGhost ? (this.focusedGhost.exposure || 0) : 0;

      // Breve pulse del ring del ghost “focus” quando stai sparando
      if (this.firing && this.focusedGhost && this.focusedGhost._ring) {
        this.focusedGhost._ring.pulseT = Math.max(this.focusedGhost._ring.pulseT, 0.10);
      }
    }

    // Visual
    this._updateVisual(visualLen);
  }

  /* ============================================================================
     Interni (visual / heat / LOS / reset)
  ============================================================================ */

  // Crea il cono additivo con un leggero fade verso la base
  _buildVisual() {
    const geo = new THREE.ConeGeometry(1, 1, 36, 1, true);
    geo.translate(0, -0.5, 0); // apice all’origine, -Y asse del cono

    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2b3,
      transparent: true,
      opacity: this._baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });

    // Fade “soft” verso la base per ridurre l’impatto del disco frontale
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vConeT = uv.y;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          'float fade = 1.0 - smoothstep(0.45, 1.0, vConeT);' +
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a * (0.2 + 0.8 * fade) );'
        );
    };

    this.cone = new THREE.Mesh(geo, mat);
    this.cone.visible = false;
    this.cone.renderOrder = 900;
    this.cone.frustumCulled = false;
    this.scene.add(this.cone);
  }

  // Gestione surriscaldamento (heat 0..1 con isteresi hi/lo)
  _updateHeat(dt) {
    const wanting = this.firing && !this.overheated;
    this.heat = THREE.MathUtils.clamp(
      this.heat + (wanting ? this.heatRise : -this.heatFall) * dt,
      0, 1
    );

    if (!this.overheated && this.heat >= this.overheatHi) this.overheated = true;
    if (this.overheated  && this.heat <= this.overheatLo) this.overheated = false;
    if (this.overheated) this.firing = false;
  }

  // Aggiorna la mesh del cono (posizione/orientamento/scala/opacity)
  _updateVisual(length) {
    if (!this.cone) return;
    const show = this.firing && !this.overheated;
    this.cone.visible = show;
    if (!show) return;

    const len    = THREE.MathUtils.clamp(length, 0.5, this.maxRange);
    const radius = Math.tan(THREE.MathUtils.degToRad(this.halfAngleDeg)) * len;

    // apice un filo davanti alla camera smussata (evita near clipping)
    const eps  = Math.max(0.05, Math.min(0.25, 0.02 * len));
    const apex = this._posSmooth;
    const fwd  = this._fwdSmooth;

    this.cone.position.set(apex.x + fwd.x * eps, apex.y + fwd.y * eps, apex.z + fwd.z * eps);
    // allinea -Y del cono alla forward del beam
    this.cone.quaternion.setFromUnitVectors(this._upNeg, fwd);
    this.cone.scale.set(radius, len, radius);

    // Opacità dinamica: meno invadente quando il cono è corto
    const lenFactor = THREE.MathUtils.clamp(len / this.maxRange, 0, 1);
    this.cone.material.opacity = this._baseOpacity * (0.35 + 0.65 * lenFactor);

    this.cone.updateMatrixWorld(true);
  }

  // Line-of-sight contro una lista di ostacoli opzionale
  _hasLOS(origin, aim, dist) {
    if (!this.obstacles || this.obstacles.length === 0) return true;
    this._ray.set(origin, this._tmpV.copy(aim).sub(origin).normalize());
    this._ray.far = dist;
    const hit = this._ray.intersectObjects(this.obstacles, true);
    return hit.length === 0;
  }

  /** Reset completo (usato da Retry/Replay). Non cambia parametri di tuning. */
  reset() {
    this.enabled    = true;
    this.firing     = false;
    this.overheated = false;
    this.heat       = 0;

    this.aiming      = false;
    this.yawOffset   = 0;
    this.pitchOffset = 0;

    this.hitsThisFrame   = 0;
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    // Riallinea smoothing allo stato attuale della camera
    this._posSmooth.copy(this.camera.position);
    this._beamQuatSmooth.copy(this.camera.quaternion);
    this._fwdSmooth.set(0, 0, -1).applyQuaternion(this._beamQuatSmooth).normalize();

    if (this.cone) this.cone.visible = false;
  }
}














