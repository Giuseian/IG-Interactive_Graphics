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
    this.firing     = false;  // stai sparando ? 
    this.overheated = false;  // è in surriscaldamento ? 
    this.heat       = 0;  // valore di calore 

    // --- Parametri gameplay
    this.halfAngleDeg = opts.halfAngleDeg ?? 20;    // mezzo angolo del cono 
    this.maxRange     = opts.maxRange     ?? 260;   // portata massima 
    this.exposureRate = opts.exposureRate ?? 4.0;   // quanto velocemente cresce l'esposizione dei Ghost 

    // --- Overheat
    this.heatRise   = opts.heatRise   ?? 0.8;  // salita del calore
    this.heatFall   = opts.heatFall   ?? 0.7;  // discesa del calore
    this.overheatHi = opts.overheatHi ?? 1.0;  // soglia di overheat -> oltre questa si blocca il fuoco 
    this.overheatLo = opts.overheatLo ?? 0.6;  // ripristino da overheat -> sotto questa, si sblocca 

    // --- Smoothing
    this.smoothTau = opts.smoothTau ?? 0.12; // s; 0 = no smoothing -> costante di tempo per smussare sia posizione dell'apice che orientamento del raggio 

    // --- Gimbal (offset rispetto alla camera, controllati dal mouse quando aiming=true)
    this.aiming       = false;   // stato : sto mirando ? 
    this.yawOffset    = 0; // rad
    this.pitchOffset  = 0; // rad
    this.yawLimitDeg   = opts.yawLimitDeg   ?? 35; // ±
    this.pitchLimitDeg = opts.pitchLimitDeg ?? 25; // ±
    this.sensX = opts.sensX ?? 0.0018; // rad/px -> sensibilità mouse X
    this.sensY = opts.sensY ?? 0.0016; // rad/px -> sensibilità mouse Y
    this.recenterTau = opts.recenterTau ?? 0.22;  // tempo di rientro offset fuori mira 

    // --- Ostacoli per la linea di vista (facoltativi)
    this.obstacles = opts.obstacles || [];   // lista degli oggetti per i raycast 

    // --- Cache / scratch
    this._cosHalf   = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));  // precalcolo del coseno del mezzo-angolo 
    this._ray       = new THREE.Raycaster();  // raycaster riusato per la line of sight  
    this._tmpV      = new THREE.Vector3();
    this._rightCam  = new THREE.Vector3(1, 0, 0);
    this._fwdSmooth = new THREE.Vector3(0, 0, -1);  // forward del beam smussata 
    this._posSmooth = new THREE.Vector3();  // posizione apice smussata  
    this._upNeg     = new THREE.Vector3(0, -1, 0); // -Y (serve per allineare il cono)

    // Quaternion smussata del beam + appoggi
    this._beamQuatSmooth = new THREE.Quaternion().copy(this.camera.quaternion);
    this._qTarget = new THREE.Quaternion();
    this._qYaw    = new THREE.Quaternion();
    this._qPitch  = new THREE.Quaternion();

    // HUD/focus
    this.hitsThisFrame   = 0;  // contatore hit -> quanti ghost sono stati cleansed 
    this.focusedGhost    = null;  // bersaglio focus 
    this.focusedWeight   = 0;  // peso (centratura + vicinanza) del ghost 
    this.focusedDist     = Infinity;  // distanza del ghost focus 
    this.focusedExposure = 0;

    // Visual
    this._baseOpacity = 0.18;  // opacità di base del cono 
    this._buildVisual();  // costruzione della mesh additiva con mini-patch shader 
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
  update(dt, ghostsIterable) {                         // Chiamato ogni frame: dt in secondi, iterable di Ghost
    this._updateHeat(dt);                              // Aggiorna calore e stato overheated con isteresi

    // Posizione dell'emettitore 
    const camPos = this.camera.position;               // Posizione attuale della camera
    if (this.smoothTau > 0) {                          // Se smoothing abilitato
      const a = 1 - Math.exp(-dt / this.smoothTau);    // Coefficiente esponenziale (frame-rate indipendente)
      if (this._posSmooth.lengthSq() === 0)            // Se è il primo frame (posizione non inizializzata)
        this._posSmooth.copy(camPos);                  // Allinea subito la posizione smussata alla camera
      this._posSmooth.lerp(camPos, a);                 // Interpola verso la camera con fattore a
    } else {
      this._posSmooth.copy(camPos);                    // Nessun smoothing: copia diretta
    }

    // Orientamento del beam : parte dal quaternion della camera e applica offset di mira 
    this._rightCam.set(1, 0, 0)                        // Vettore “right” di base
      .applyQuaternion(this.camera.quaternion)         // Rotato nello spazio della camera
      .normalize();                                    // Normalizza (unitario)
    this._qYaw.setFromAxisAngle(                       // Costruisci quaternion di yaw
      new THREE.Vector3(0, 1, 0), this.yawOffset
    );
    this._qPitch.setFromAxisAngle(this._rightCam, this.pitchOffset); // Quaternion di pitch intorno al right camera
    this._qTarget.copy(this.camera.quaternion)         // qTarget = qCamera
      .multiply(this._qYaw)                            //           * qYaw
      .multiply(this._qPitch);                         //           * qPitch (ordine importante)

    const aQ = this.smoothTau > 0                      // Coefficiente esponenziale per smoothing quaternion
      ? (1 - Math.exp(-dt / this.smoothTau))
      : 1.0;
    this._beamQuatSmooth.slerp(this._qTarget, aQ);     // Slerp: porta orientamento beam verso il target smussato

    if (!this.aiming) {                                // Se non stai mirando
      const k = Math.exp(-dt / this.recenterTau);      // Fattore di decadimento → ritorno a 0 degli offset
      this.yawOffset   *= k;                           // Rientro morbido yaw
      this.pitchOffset *= k;                           // Rientro morbido pitch
    }

    // Forward del beam : -Z ruotato dalla quaterion smussata
    this._fwdSmooth                                   // Calcola forward del beam
      .set(0, 0, -1)                                  // Vettore -Z
      .applyQuaternion(this._beamQuatSmooth)          // Ruotato con la quaternion smussata del beam
      .normalize();                                   // Normalizza

    // Scansione e scelta del bersaglio 
    let visualLen = this.maxRange;                     // Lunghezza visuale iniziale = portata massima (accorciata dopo)
    this.hitsThisFrame   = 0;                          // Reset telemetria “hit nel frame”
    this.focusedGhost    = null;                       // Reset bersaglio focus
    this.focusedWeight   = 0;                          // Reset peso focus
    this.focusedDist     = Infinity;                   // Reset distanza focus
    this.focusedExposure = 0;                          // Reset exposure focus

    if (this.enabled && this.firing                    // Processa solo se attivo, stai sparando
        && !this.overheated && ghostsIterable) {       // non overheated e c’è una lista di Ghost
      for (const g of ghostsIterable) {                // Itera tutti i Ghost
        if (!g || !g.root || g.state !== 'active')     // Skippa null/non attivi/ senza root
          continue;

        const aim = this._tmpV.copy(g.root.position);  // Punto da mirare = posizione ghost
        aim.y += 1.0;                                  // Alzato di 1m (evita colpire il terreno)

        const to   = this._tmpV.clone()                // Vettore apice→ghost
          .subVectors(aim, this._posSmooth);
        const dist = to.length();                      // Distanza apice-ghost
        if (dist > this.maxRange || dist < 1e-3)       // Fuori portata o troppo vicino/degenerato
          continue;
        to.multiplyScalar(1 / dist);                   // Normalizza il vettore direzione

        const cosAng = to.dot(this._fwdSmooth);        // Coseno angolo con la forward del beam
        if (cosAng < this._cosHalf)                    // Se sotto soglia: è fuori dal cono -> scarta 
          continue;

        if (!this._hasLOS(this._posSmooth, aim, dist)) // Se non c’è Line-of-Sight libera, salta
          continue;

        const wAngle = (cosAng - this._cosHalf) /      // Peso angolare: 0 al bordo, 1 perfettamente centrato
                        (1 - this._cosHalf);
        const wDist  = 1 - (dist / this.maxRange);     // Peso distanza: 1 vicino, 0 a maxRange
        const weight = THREE.MathUtils.clamp(           // Peso finale = media 50/50 (clamp in [0,1])
          0.5 * wAngle + 0.5 * wDist, 0, 1
        );

        if (weight > this.focusedWeight) {             // Aggiorna il ghost “focus” (miglior peso) !!
          this.focusedWeight = weight;
          this.focusedGhost  = g;
          this.focusedDist   = dist;
        }

        const cleansed = g.applyExposure(              // Applica esposizione al ghost (scala con weight e dt)
          this.exposureRate * weight * dt
        );
        if (cleansed) this.hitsThisFrame++;            // Se il ghost ha raggiunto “clean”, conta l’hit

        if (dist < visualLen)                          // Accorcia il cono visuale al primo bersaglio utile
          visualLen = dist;
      }

      this.focusedExposure =                           // Aggiorna exposure corrente del ghost focus (per HUD)
        this.focusedGhost ? (this.focusedGhost.exposure || 0) : 0;

      if (this.firing && this.focusedGhost &&          // Piccolo “pulse” del ring del ghost focus quando spari
          this.focusedGhost._ring) {
        this.focusedGhost._ring.pulseT =
          Math.max(this.focusedGhost._ring.pulseT, 0.10);
      }
    }

    this._updateVisual(visualLen);                     // Aggiorna la mesh del cono (pos/rot/scala/opacity)
  }



  /* ============================================================================
     Interni (visual / heat / LOS / reset)
  ============================================================================ */

  // Crea il cono additivo con un leggero fade verso la base
  _buildVisual() {
    const geo = new THREE.ConeGeometry(1, 1, 36, 1, true);  // Cono unitario 
    geo.translate(0, -0.5, 0); // apice all’origine, -Y asse del cono

    const mat = new THREE.MeshBasicMaterial({  // Materiale additivo e trasparente 
      color: 0xfff2b3,
      transparent: true,
      opacity: this._baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // visibile da dentro e fuori 
      fog: false,  // ignora fog della scena 
      toneMapped: false
    });

    // Fade “soft” verso la base per ridurre l’impatto del disco frontale
    mat.onBeforeCompile = (shader) => {  // Patch shader per aggiungere un fade verso la base 
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vConeT = uv.y;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vConeT;')
        .replace(
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
          'float fade = 1.0 - smoothstep(0.45, 1.0, vConeT);' +  // Fade forte vicino alla base 
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a * (0.2 + 0.8 * fade) );'
        );
    };

    this.cone = new THREE.Mesh(geo, mat);
    this.cone.visible = false;
    this.cone.renderOrder = 900;
    this.cone.frustumCulled = false;
    this.scene.add(this.cone);
  }

  // Gestione surriscaldamento (heat 0..1 con isteresi hi/lo) -> Modello termico 
  _updateHeat(dt) {  //Aggiorna il valore di calore e lo stato overheated 
    const wanting = this.firing && !this.overheated;   // Vuoi davvero sparare e puoi ? 
    this.heat = THREE.MathUtils.clamp(  // Aumenta o diminuisci heat in base a wanting 
      this.heat + (wanting ? this.heatRise : -this.heatFall) * dt,
      0, 1
    );

    if (!this.overheated && this.heat >= this.overheatHi) this.overheated = true;  // Sali sopra soglia alta -> entra overheated 
    if (this.overheated  && this.heat <= this.overheatLo) this.overheated = false;  // Scendi sotto soglia bassa -> esci overheated 
    if (this.overheated) this.firing = false;  // Se overheated, disabilita il firing 
  }

  // Aggiorna la mesh del cono (posizione/orientamento/scala/opacity)
  _updateVisual(length) {                              // Aggiorna posizione/orientamento/scala/alpha del cono
    if (!this.cone) return;                            // Se non esiste la mesh, esci
    const show = this.firing && !this.overheated;      // Mostra solo se stai sparando e non overheated
    this.cone.visible = show;                          // Aggiorna visibilità
    if (!show) return;                                 // Se non visibile, niente altro

    const len    = THREE.MathUtils.clamp(              // Altezza reale del cono (clampata)
      length, 0.5, this.maxRange
    );
    const radius = Math.tan(                           // Raggio alla base dal mezzo angolo e lunghezza
      THREE.MathUtils.degToRad(this.halfAngleDeg)
    ) * len;

    const eps  = Math.max(0.05, Math.min(0.25, 0.02 * len)); // Piccolo offset dall’apice per evitare near-clip
    const apex = this._posSmooth;                      // Apice smussato (posizione)
    const fwd  = this._fwdSmooth;                      // Direzione smussata (forward)

    this.cone.position.set(                            // Posiziona la mesh un filo davanti all’apice
      apex.x + fwd.x * eps,
      apex.y + fwd.y * eps,
      apex.z + fwd.z * eps
    );
    this.cone.quaternion.setFromUnitVectors(           // Allinea l’asse -Y del cono alla forward del beam
      this._upNeg, fwd
    );
    this.cone.scale.set(radius, len, radius);          // Scala raggio/altezza del cono

    const lenFactor = THREE.MathUtils.clamp(           // Fattore [0..1] proporzionale alla lunghezza relativa
      len / this.maxRange, 0, 1
    );
    this.cone.material.opacity = this._baseOpacity *   // Opacità dinamica (meno “sparata” quando corto)
      (0.35 + 0.65 * lenFactor);

    this.cone.updateMatrixWorld(true);                 // Aggiorna matrici della mesh
  }


  // Line-of-sight contro una lista di ostacoli opzionale
  _hasLOS(origin, aim, dist) {  // Verifica se c’è linea di vista libera tra origin e aim
    if (!this.obstacles || this.obstacles.length === 0) return true;
    this._ray.set(origin, this._tmpV.copy(aim).sub(origin).normalize());    // Configura il raycaster
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














