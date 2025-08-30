// src/systems/BeamSystem.js - camera and beam offset (soft cone)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export class BeamSystem {
  constructor(opts = {}) {
    this.scene     = opts.scene;
    this.camera    = opts.camera;

    // ---- Stato beam
    this.enabled    = true;
    this.firing     = false;
    this.overheated = false;
    this.heat       = 0;

    // ---- Parametri gameplay
    this.halfAngleDeg = opts.halfAngleDeg ?? 20;
    this.maxRange     = opts.maxRange     ?? 260;
    this.exposureRate = opts.exposureRate ?? 4.0;

    // ---- Overheat interno
    this.heatRise   = opts.heatRise   ?? 0.8;
    this.heatFall   = opts.heatFall   ?? 0.7;
    this.overheatHi = opts.overheatHi ?? 1.0;
    this.overheatLo = opts.overheatLo ?? 0.6;

    // ---- Smoothing globale (orientamento e posizione)
    this.smoothTau = opts.smoothTau ?? 0.12; // s; 0 = no smoothing

    // ---- Gimbal (offset yaw/pitch rispetto alla camera)
    this.aiming = false;
    this.yawOffset   = 0; // rad
    this.pitchOffset = 0; // rad

    this.yawLimitDeg   = opts.yawLimitDeg   ?? 35; // ±
    this.pitchLimitDeg = opts.pitchLimitDeg ?? 25; // ±
    this.sensX = opts.sensX ?? 0.0018; // rad per pixel mouse X
    this.sensY = opts.sensY ?? 0.0016; // rad per pixel mouse Y
    this.recenterTau = opts.recenterTau ?? 0.22; // s: ritorno verso 0 fuori aim

    // ---- Ostacoli per LOS (facoltativi)
    this.obstacles = opts.obstacles || [];

    // ---- Cache / scratch
    this._cosHalf   = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
    this._ray       = new THREE.Raycaster();
    this._tmpV      = new THREE.Vector3();
    this._fwdSmooth = new THREE.Vector3(0,0,-1);
    this._posSmooth = new THREE.Vector3();
    this._upNeg     = new THREE.Vector3(0,-1,0);

    // quaternion del beam (lisciata)
    this._beamQuatSmooth = new THREE.Quaternion().copy(this.camera.quaternion);
    this._qTarget = new THREE.Quaternion();
    this._qYaw    = new THREE.Quaternion();
    this._qPitch  = new THREE.Quaternion();

    this.hitsThisFrame = 0;

    // info per HUD/target (bersaglio migliore del frame)
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    // base opacity del cono (useremo una modulazione dinamica)
    this._baseOpacity = 0.18;

    this._buildVisual();
  }

  /* ===== API ===== */

  // tuning da tastiera
  incHalfAngle(d=1){ this.setHalfAngleDeg(this.halfAngleDeg + d); }
  decHalfAngle(d=1){ this.setHalfAngleDeg(this.halfAngleDeg - d); }
  incRange(d=10){ this.setMaxRange(this.maxRange + d); }
  decRange(d=10){ this.setMaxRange(Math.max(2, this.maxRange - d)); }

  setFiring(v) { this.firing = !!v && !this.overheated; }
  setHalfAngleDeg(a) {
    this.halfAngleDeg = THREE.MathUtils.clamp(a, 2, 45);
    this._cosHalf = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
  }
  setMaxRange(r) { this.maxRange = Math.max(2, r); }
  setObstacles(list) { this.obstacles = list || []; }

  // Gimbal
  setAiming(on){
    this.aiming = !!on;
  }
  onAimMouseDelta(dx, dy){
    if (!this.aiming) return;
    this.yawOffset   += dx * this.sensX;   // dx>0 ⇒ yaw a destra
    this.pitchOffset -= dy * this.sensY;   // dy>0 (mouse in giù) ⇒ pitch giù
    const yawLimRad   = THREE.MathUtils.degToRad(this.yawLimitDeg);
    const pitchLimRad = THREE.MathUtils.degToRad(this.pitchLimitDeg);
    this.yawOffset   = THREE.MathUtils.clamp(this.yawOffset, -yawLimRad, yawLimRad);
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset, -pitchLimRad, pitchLimRad);
  }

  getBeamQuaternion(){
    return this._beamQuatSmooth;
  }
  getBeamForward(out = new THREE.Vector3()){
    return out.set(0,0,-1).applyQuaternion(this._beamQuatSmooth).normalize();
  }
  getBeamApex(out = new THREE.Vector3()){
    return out.copy(this._posSmooth);
  }

  /** Info per HUD/debug sul bersaglio attuale */
  getFocusInfo() {
    return {
      ghost: this.focusedGhost,
      exposure: this.focusedExposure,
      weight: this.focusedWeight,
      dist: this.focusedDist
    };
  }

  /* ===== Update ===== */
  update(dt, ghostsIterable) {
    this._updateHeat(dt);

    // Posizione smussata
    const camPos = this.camera.position;
    if (this.smoothTau > 0) {
      const a = 1 - Math.exp(-dt / this.smoothTau);
      if (this._posSmooth.lengthSq() === 0) this._posSmooth.copy(camPos);
      this._posSmooth.lerp(camPos, a);
    } else {
      this._posSmooth.copy(camPos);
    }

    // Calcola la quaternion target del beam (camera * yaw * pitch)
    const yaw = this.yawOffset, pitch = this.pitchOffset;
    const upWorld = new THREE.Vector3(0,1,0);
    const rightCam = new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion).normalize();
    this._qYaw.setFromAxisAngle(upWorld, yaw);
    this._qPitch.setFromAxisAngle(rightCam, pitch);
    this._qTarget.copy(this.camera.quaternion).multiply(this._qYaw).multiply(this._qPitch);

    // Smoothing quaternion del beam
    const aQ = this.smoothTau > 0 ? (1 - Math.exp(-dt / this.smoothTau)) : 1.0;
    this._beamQuatSmooth.slerp(this._qTarget, aQ);

    // Fuori dal mirino, recentra lentamente gli offset
    if (!this.aiming) {
      const k = Math.exp(-dt / this.recenterTau);
      this.yawOffset   *= k;
      this.pitchOffset *= k;
    }

    // Forward derivata dalla quaternion smussata
    this._fwdSmooth.set(0,0,-1).applyQuaternion(this._beamQuatSmooth).normalize();

    let visualLen = this.maxRange;
    this.hitsThisFrame = 0;

    // reset focus info (nuovo frame)
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    if (this.enabled && this.firing && !this.overheated && ghostsIterable) {
      for (const g of ghostsIterable) {
        if (!g || !g.root || g.state !== 'active') continue;

        // punto da “illuminare”
        const aim = this._tmpV.copy(g.root.position);
        aim.y += 1.0;

        // vettore beam-apice → ghost
        const to   = this._tmpV.clone().subVectors(aim, this._posSmooth);
        const dist = to.length();
        if (dist > this.maxRange || dist < 1e-3) continue;

        to.multiplyScalar(1 / dist);

        // test cono 3D con forward del BEAM
        const cosAng = to.dot(this._fwdSmooth);
        if (cosAng < this._cosHalf) continue;

        // LOS (se hai passato ostacoli)
        if (!this._hasLOS(this._posSmooth, aim, dist)) continue;

        // peso: centro del cono + vicino alla camera
        const wAngle = (cosAng - this._cosHalf) / (1 - this._cosHalf);
        const wDist  = 1 - (dist / this.maxRange);
        const weight = THREE.MathUtils.clamp(0.5 * wAngle + 0.5 * wDist, 0, 1);

        // aggiorna focus (bersaglio migliore)
        if (weight > this.focusedWeight) {
          this.focusedWeight = weight;
          this.focusedGhost  = g;
          this.focusedDist   = dist;
        }

        const cleansed = g.applyExposure(this.exposureRate * weight * dt);
        if (cleansed) this.hitsThisFrame++;

        if (dist < visualLen) visualLen = dist;
      }

      // dopo il loop, aggiorna exposure per HUD
      this.focusedExposure = this.focusedGhost ? (this.focusedGhost.exposure || 0) : 0;
    }

    this._updateVisual(visualLen);
  }

  _buildVisual() {
    const geo = new THREE.ConeGeometry(1, 1, 36, 1, true);
    geo.translate(0, -0.5, 0);

    // Colore più freddo e soft
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2b3,          // meno giallo
      transparent: true,
      opacity: this._baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });

    // Fade verso la base del cono (ammorbidisce il disco frontale)
    mat.onBeforeCompile = (shader)=>{
      // passiamo una coordinata lungo l'altezza usando le UV della geometria
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vConeT = uv.y;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          // fade: 1.0 alla punta → ~0.2 alla base (morbido)
          'float fade = 1.0 - smoothstep(0.45, 1.0, vConeT);' +
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a * (0.2 + 0.8*fade) );'
        );
    };

    this.cone = new THREE.Mesh(geo, mat);
    this.cone.visible = false;
    this.cone.renderOrder = 900;
    this.cone.frustumCulled = false;
    this.scene.add(this.cone);
  }

  _updateHeat(dt) {
    const wanting = this.firing && !this.overheated;
    this.heat = THREE.MathUtils.clamp(this.heat + (wanting ? this.heatRise : -this.heatFall) * dt, 0, 1);

    if (!this.overheated && this.heat >= this.overheatHi) this.overheated = true;
    if (this.overheated && this.heat <= this.overheatLo) this.overheated = false;
    if (this.overheated) this.firing = false;
  }

  _updateVisual(length) {
    if (!this.cone) return;
    const show = this.firing && !this.overheated;
    this.cone.visible = show;
    if (!show) return;

    const len = THREE.MathUtils.clamp(length, 0.5, this.maxRange);
    const radius = Math.tan(THREE.MathUtils.degToRad(this.halfAngleDeg)) * len;

    // apice un filo davanti alla camera smussata (niente near clipping)
    const eps = Math.max(0.05, Math.min(0.25, 0.02 * len));
    const apex = this._posSmooth;
    const fwd  = this._fwdSmooth;

    this.cone.position.set(apex.x + fwd.x * eps, apex.y + fwd.y * eps, apex.z + fwd.z * eps);
    // allinea -Y del cono alla forward del BEAM
    this.cone.quaternion.setFromUnitVectors(this._upNeg, fwd);
    this.cone.scale.set(radius, len, radius);

    // Opacità dinamica: meno invadente quando il cono è corto
    const lenFactor = THREE.MathUtils.clamp(len / this.maxRange, 0, 1);
    this.cone.material.opacity = this._baseOpacity * (0.35 + 0.65 * lenFactor);

    this.cone.updateMatrixWorld(true);
  }

  _hasLOS(origin, aim, dist) {
    if (!this.obstacles || this.obstacles.length === 0) return true;
    this._ray.set(origin, this._tmpV.copy(aim).sub(origin).normalize());
    this._ray.far = dist;
    const hit = this._ray.intersectObjects(this.obstacles, true);
    return hit.length === 0;
  }
}
