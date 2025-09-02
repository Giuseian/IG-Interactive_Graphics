// src/systems/WispSystem.js                                                      // percorso del file
// -----------------------------------------------------------------------------  // sezione: header
// WispSystem                                                                     // nome del sistema
// -----------------------------------------------------------------------------  // —
/* Sistema particellare GPU “billboard + instancing” per piccole scie/fiammelle  // descrizione ad alto livello
   (wisps). È pensato per tre pattern di emissione:
     - emitRing()    : anello a terra (o attorno a un ring)
     - emitBurst()   : esplosione sferica morbida (celebration/purify burst)
     - emitSheath()  : guaina cilindrica attorno a un corpo (ghost durante beam)

   Caratteristiche:
     - Simulazione CPU (vento perlin + lift + drag + collisione soft)
     - Rendering GPU via InstancedBufferGeometry (attributi per istanza)
     - Billboard con assi camera (Right/Up come uniform)
     - Fog manuale Exp2 nel fragment
     - Additive blending, depthTest on, depthWrite off
*/
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'; // importa three.js ESM
import { ImprovedNoise } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/math/ImprovedNoise.js'; // Perlin-like noise

/**
 * @typedef {Object} WispOpts                                                         // tipo opzioni costruttore
 * @property {THREE.Scene}  scene                                                    // scena dove aggiungere la mesh
 * @property {THREE.Camera} camera                                                   // camera per Right/Up e fog
 * @property {(x:number, z:number)=>number} [getGroundY]                             // callback quota terreno
 * @property {number} [max=700]                                                      // numero max particelle
 * @property {number} [windAmp=1.3]                                                  // intensità vento
 * @property {number} [windFreq=0.06]                                                // frequenza spaziale rumore
 * @property {number} [windSpeed=0.45]                                               // velocità temporale vento
 * @property {number} [lift=0.75]                                                    // spinta verso l’alto
 * @property {number} [drag=0.9]                                                     // attrito (decadimento velocità)
 */

export class WispSystem {                                                             // definizione classe
  /** @param {WispOpts} opts */
  constructor({                                                                        // costruttore con default
    scene,
    camera,
    getGroundY = (x, z) => 0,                                                         // default: terreno piatto
    max = 700,                                                                        // limite pool
    windAmp = 1.3,                                                                    // default vento
    windFreq = 0.06,
    windSpeed = 0.45,
    lift = 0.75,
    drag = 0.9
  } = {}) {
    // --- dipendenze
    this.scene = scene;                                                               // salva scena
    this.camera = camera;                                                             // salva camera
    this.getGroundY = getGroundY;                                                     // salva funzione terreno

    // --- stato globale
    this.enabled = true;                                                              // sistema attivo
    this.max = max;                                                                   // dimensione pool

    // --- parametri dinamici (tuning runtime possibile)
    this.params = { windAmp, windFreq, windSpeed, lift, drag };                       // bundle parametri

    // --- pool particelle (SoA: Structure of Arrays)
    this._alive = new Array(max).fill(false);                                         // slot occupato sì/no
    this._pos   = new Float32Array(max * 3);                                          // posizioni [x,y,z] per particella
    this._vel   = new Float32Array(max * 3);                                          // velocità [x,y,z]
    this._age   = new Float32Array(max);                                              // età corrente
    this._life  = new Float32Array(max);                                              // durata assegnata
    this._size0 = new Float32Array(max);                                              // taglia iniziale
    this._size1 = new Float32Array(max);                                              // taglia finale
    this._spin  = new Float32Array(max);                                              // velocità angolare in piano
    this._seed  = new Float32Array(max);                                              // seme rumore per particella
    this._col   = new Float32Array(max * 3); // rgb [0..1]                           // colore base per particella

    // --- geometria instanziata (billboard quad)
    const base = new THREE.PlaneGeometry(1, 1);                                       // quad unitario [-0.5,0.5]
    const geo  = new THREE.InstancedBufferGeometry().copy(base);                      // duplica in geometria instanziabile
    base.dispose();                                                                    // libera la base

    // attributi per istanza (uno per particella viva) -> lunghezza array : max - numero di particelle 
    this._attrOffset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // centro mondo (x,y,z)
    this._attrSize   = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);     // scala uniform
    this._attrAngle  = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);     // rotazione in piano
    this._attrColor  = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // colore rgb
    this._attrAlpha  = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);     // alpha/intensità

    geo.setAttribute('iOffset', this._attrOffset);                                     // collega offset all’attributo
    geo.setAttribute('iSize',   this._attrSize);                                       // id.
    geo.setAttribute('iAngle',  this._attrAngle);                                      // id.
    geo.setAttribute('iColor',  this._attrColor);                                      // id.
    geo.setAttribute('iAlpha',  this._attrAlpha);                                      // id.
    geo.instanceCount = 0;                                                             // nessuna istanza all’inizio
    this.geometry = geo;                                                               // memorizza geometria

    // --- shader (billboard con Right/Up camera + fog manuale nel fragment)
    const vtx = `                                                                     
      attribute vec3  iOffset;                                                         // centro del quad
      attribute float iSize;                                                           // dimensione quad
      attribute float iAngle;                                                          // rotazione 2D
      attribute vec3  iColor;                                                          // colore base
      attribute float iAlpha;                                                          // alpha base

      varying vec2 vCoord;                                                             // coord locali ruotate → falloff
      varying vec4 vCol;                                                               // colore+alpha verso fragment
      varying vec3 vWorldPos;                                                          // posizione mondo per fog

      // Assi camera Right ed Up, passati dalla cpu 
      uniform vec3 uCamRight;                                                          // asse destro camera
      uniform vec3 uCamUp;                                                             // asse alto camera

      void main(){
      
        // 1) Prendo i vertici del quad "base" (PlaneGeometry 1×1 è in [-0.5, 0.5])
        vec2 p = vec2(position.x, position.y);                                         // XY del vertice base

        // 2) Rotazione in piano (cos/sin)
        float c = cos(iAngle), s = sin(iAngle);                                        // precalcolo rotazione
        vec2 r = vec2(c*p.x - s*p.y, s*p.x + c*p.y);                                   // punto ruotato nel piano

        // 3) Billboard: proietto la X del quad sull’asse Right e la Y sull’asse Up della camera,
        // poi traslo al centro particella (iOffset) e applico la scala (iSize).
        vec3 world = iOffset + uCamRight * (r.x * iSize) + uCamUp * (r.y * iSize);     // ricostruzione in world

        // 4) Passo i dati al fragment
        vCoord    = r;                     // per distanza dal centro nel fragment
        vCol      = vec4(iColor, iAlpha);  // colore+alpha dell’istanza
        vWorldPos = world;                 // posizione mondo per fog

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);                // proiezione standard
      }
    `;

    const frg = `                                                                      
      precision mediump float;                                                         // precisione mobile

      varying vec2 vCoord;                                                             // coord locali ruotate
      varying vec4 vCol;                                                               // colore+alpha istanza
      varying vec3 vWorldPos;                                                          // posizione mondo

      // Fog manuale (Exp2) + camera
      uniform vec3  uCamPos;                                                           // posizione camera
      uniform vec3  uFogColor;   // se serve un leggero tint (non usato nel colore finale additivo) // tenuto per opzioni
      uniform float uFogDensity;                                                       // densità fog scena

      void main(){
        // soft circle (radial falloff)
        float d    = length(vCoord) * 1.41421356237; // sqrt(2) per normalizzare                         // mappa angolo→~1
        float soft = smoothstep(1.0, 0.0, d);        // 1 al centro → 0 al bordo                         // bordo morbido
        float a    = vCol.a * soft;                 // alpha attenuata                                   // riduce spigoli
        if (a <= 0.001) discard;                    // evita fill-rate su pixel invisibili               // ottimizzazione

        // Exp2 fog factor in funzione della distanza camera→particella
        float distCam = distance(vWorldPos, uCamPos);                                                   // distanza per fog
        float fogF    = 1.0 - exp( - (uFogDensity*uFogDensity) * distCam * distCam );                  // fattore Exp^2

        // Per blending additivo: attenuo l'alpha (e quindi la luminosità) con la nebbia
        float aFogged = a * (1.0 - fogF);                                                                // alpha attenuata

        gl_FragColor = vec4(vCol.rgb * aFogged, aFogged);                                               // colore additivo
      }
    `;

    this.material = new THREE.ShaderMaterial({                                          // crea materiale custom
      vertexShader:   vtx,                                                              // vertex sopra
      fragmentShader: frg,                                                              // fragment sopra
      uniforms: {                                                                       // uniform iniziali
        uCamRight:   { value: new THREE.Vector3(1,0,0) },                               // Right iniziale
        uCamUp:      { value: new THREE.Vector3(0,1,0) },                               // Up iniziale
        uCamPos:     { value: new THREE.Vector3() },                                    // pos camera (aggiornata ogni frame)
        uFogColor:   { value: new THREE.Color(0xDFE9F3) },                              // tint opzionale
        uFogDensity: { value: 1.6e-4 }                                                  // densità default (scene-like)
      },
      transparent: true,                                                                // abilita alpha
      depthWrite:  false,                                                               // non scrivere Z (evita tagli tra wisp)
      depthTest:   true,                                                                // ma testare contro la scena
      blending:    THREE.AdditiveBlending,                                              // somma luce
      fog:         false,   // IMPORTANT: disabilita fog built-in (usiamo quella manuale)
      toneMapped:  false                                                               // niente tonemapping
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);                           // mesh istanziata
    this.mesh.frustumCulled = false;                                                    // non cullare per frustum (particelle sparse)
    this.mesh.renderOrder   = 995;                                                      // disegna tardi (sopra molte cose)
    this.scene.add(this.mesh);                                                          // aggiungi alla scena

    // --- vento perlin
    this._noise = new ImprovedNoise();                                                  // generatore rumore coerente

    // --- scratch
    this._time  = 0;                                                                    // tempo interno simulazione
    this._tmpV  = new THREE.Vector3();                                                  // vettore temporaneo
    this._right = new THREE.Vector3();                                                  // Right calcolato per frame
    this._up    = new THREE.Vector3();                                                  // Up calcolato per frame
  }

  /** Abilita/Disabilita rendering e update */
  setEnabled(v) {                                                                        // on/off globale
    this.enabled = !!v;                                                                  // cast a booleano
    this.mesh.visible = this.enabled;                                                   // mostra/nascondi mesh
  }

  /* ============================================================================
     EMISSIONE
  ============================================================================ */

  /**
   * Emissione su anello (center,yaw,radius).
   */
  emitRing(center, yaw = 0, radius = 2.0, count = 16, opt = {}) {                       // emetti lungo un ring
    const up     = opt.up     ?? 0.9;                                                   // spinta verticale
    const out    = opt.out    ?? 0.7;                                                   // spinta radiale
    const size   = opt.size   ?? [0.7, 1.8];                                            // range dimensione
    const life   = opt.life   ?? [0.9, 1.6];                                            // range vita
    const tint   = opt.tint   ?? new THREE.Color(0x9fe3ff);                             // colore
    const spread = opt.spread ?? 0.35;                                                  // jitter orizzontale

    const c = Math.cos(yaw), s = Math.sin(yaw);                                         // rotazione anello

    for (let i = 0; i < count; i++) {                                                   // genera N particelle
      const ang = Math.random() * Math.PI * 2;                                          // angolo casuale

      // punto sull’anello ruotato di yaw
      const lx = Math.cos(ang) * radius;                                                // punto locale X
      const lz = Math.sin(ang) * radius;                                                // punto locale Z
      const rx = c * lx - s * lz;                                                       // ruota con yaw (X)
      const rz = s * lx + c * lz;                                                       // ruota con yaw (Z)

      const pos = new THREE.Vector3(center.x + rx, center.y, center.z + rz);            // posizione mondo

      // velocità: radiale + componente verso l’alto
      const outward = new THREE.Vector3(rx, 0, rz).normalize();                          // direzione radiale
      outward.x += (Math.random() - 0.5) * spread;                                      // jitter X
      outward.z += (Math.random() - 0.5) * spread;                                      // jitter Z

      const vel = outward.multiplyScalar(out)                                           // spinta radiale
        .add(new THREE.Vector3(0, up * (0.8 + Math.random() * 0.6), 0));               // + lift variabile

      this._spawnOne({                                                                  // crea particella
        pos,
        vel,
        size0: THREE.MathUtils.lerp(size[0], size[1], Math.random() * 0.35),           // taglia iniziale
        size1: THREE.MathUtils.lerp(size[0], size[1], 0.65 + Math.random() * 0.35),    // taglia finale
        life:  THREE.MathUtils.lerp(life[0], life[1], 0.35 + Math.random() * 0.65),    // vita
        spin:  (Math.random() * 2 - 1) * 2.4,                                           // rotazione in piano
        color: tint                                                                     // colore
      });
    }
  }

  /**
   * Emissione “burst” (sfera morbida).
   */
  emitBurst(center, count = 100, opt = {}) {                                            // emetti in sfera
    const up   = opt.up   ?? 2.4;                                                       // lift più forte
    const out  = opt.out  ?? 1.8;                                                       // spinta radiale
    const size = opt.size ?? [1.0, 2.8];                                                // range dimensioni
    const life = opt.life ?? [1.2, 2.2];                                                // range vita
    const tint = opt.tint ?? new THREE.Color(0xffd166);                                 // colore

    for (let i = 0; i < count; i++) {                                                   // N particelle
      // direzione uniforme su sfera
      let dir;                                                                          // direzione casuale
      do {
        dir = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1); // prova casuale
      } while (dir.lengthSq() < 1e-3);                                                  // evita vettori quasi zero
      dir.normalize();                                                                   // normalizza direzione

      // posizione iniziale leggermente distribuita (più densa vicino al centro)
      const r   = Math.pow(Math.random(), 0.6) * 0.8;                                   // bias verso centro
      const pos = new THREE.Vector3(center.x + dir.x * r, center.y + dir.y * r * 0.5, center.z + dir.z * r); // pos

      // velocità radiale + lift
      const vel = dir.multiplyScalar(out * (0.6 + Math.random() * 0.8));                // velocità radiale
      vel.y += up * (0.8 + Math.random() * 0.5);                                        // + lift

      this._spawnOne({                                                                  // crea particella
        pos,
        vel,
        size0: THREE.MathUtils.lerp(size[0], size[1], Math.random() * 0.4),
        size1: THREE.MathUtils.lerp(size[0], size[1], 0.6 + Math.random() * 0.4),
        life:  THREE.MathUtils.lerp(life[0], life[1], Math.random()),
        spin:  (Math.random() * 2 - 1) * 2.2,
        color: tint
      });
    }
  }

  /**
   * Emissione “guaina” attorno a un asse (cilindro morbido).
   * 1. Distribuisce casualmente le particelle lungo l'altezza e la circonferenza di un cilindro
   * 2. Dà a ciascuna una velocità che le spinge in alto e verso l'esterno
   * 3. Aggiunge un jitter casuale alla direzione radiale
   * 4. Assegna a ciascuna dimensioni iniziali/finali, durata di vita, spin e colore,
   * 5. Infine chiama _spawnOne() che registra la particella nella pool.
   */
  emitSheath(center, height = 2.0, radius = 0.8, count = 40, opt = {}) {                // emetti su cilindro
    const up     = opt.up     ?? 1.2;    // spinta verticale (quanto salgono)
    const out    = opt.out    ?? 0.5;    // spinta radiale (quanto si allargano)
    const size   = opt.size   ?? [0.7, 1.8]; // intervallo di size
    const life   = opt.life   ?? [0.9, 1.6]; // intervallo di durata
    const tint   = opt.tint   ?? new THREE.Color(0x9fe3ff); // colore
    const spread = opt.spread ?? 0.35;   // jitter per direzione radiale


    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;                                         // angolo attorno all’asse
      const y01 = Math.random();                                                        // altezza 0..1
      const y   = (y01 - 0.5) * height;                                                // mappa a [-H/2, H/2]
      const r   = radius * (0.85 + Math.random() * 0.3);                                // r casuale intorno al r base

      const rx = Math.cos(ang) * r;                                                     // x su cerchio
      const rz = Math.sin(ang) * r;                                                     // z su cerchio

      // Posizione iniziale della particella 
      const pos = new THREE.Vector3(center.x + rx, center.y + y, center.z + rz);        // posizione mondo

      // outward : direzione dal centro verso il bordo + spinta verticlae : particella che sale 
      const outward = new THREE.Vector3(rx, 0, rz).normalize();                          // direzione radiale
      outward.x += (Math.random() - 0.5) * spread;                                      // jitter X
      outward.z += (Math.random() - 0.5) * spread;                                      // jitter Z

      const vel = outward.multiplyScalar(out)                                           // spinta radiale
        .add(new THREE.Vector3(0, up * (0.8 + Math.random() * 0.6), 0));               // + lift

      // Registrazione della particella 
      this._spawnOne({                                                                  // crea particella
        pos,
        vel,
        size0: THREE.MathUtils.lerp(size[0], size[1], Math.random() * 0.35),
        size1: THREE.MathUtils.lerp(size[0], size[1], 0.65 + Math.random() * 0.35),
        life:  THREE.MathUtils.lerp(life[0], life[1], 0.35 + Math.random() * 0.65),
        spin:  (Math.random() * 2 - 1) * 2.0,
        color: tint
      });
    }
  }

  /** Spawna una singola particella nel primo slot libero (fallback: overwrite random). */
  _spawnOne({ pos, vel, size0, size1, life, spin, color }) {                            // inserisci in pool
    // cerca slot libero
    for (let i = 0; i < this.max; i++) {                                                // loop su tutti gli slot
      if (this._alive[i]) continue;                                                     // se occupato, salta
      this._alive[i] = true;                                                            // marca vivo

      const i3 = i * 3;                                                                 // indice triplo
      this._pos[i3+0] = pos.x; this._pos[i3+1] = pos.y; this._pos[i3+2] = pos.z;        // salva pos
      this._vel[i3+0] = vel.x; this._vel[i3+1] = vel.y; this._vel[i3+2] = vel.z;        // salva vel

      this._age[i]   = 0;                                                               // età 0
      this._life[i]  = life;                                                            // durata
      this._size0[i] = size0;                                                           // size in
      this._size1[i] = size1;                                                           // size out
      this._spin[i]  = spin;                                                            // spin
      this._seed[i]  = Math.random() * 1000;                                            // seme per vento

      this._col[i3+0] = color.r; this._col[i3+1] = color.g; this._col[i3+2] = color.b;  // colore
      return;                                                                           // fatto
    }

    // pool pieno → sovrascrivi un indice casuale (stesso comportamento)
    let i = Math.floor(Math.random() * this.max);                                       // indice random
    const i3 = i * 3;
    this._alive[i] = true;                                                              // marca vivo
    this._pos[i3+0] = pos.x; this._pos[i3+1] = pos.y; this._pos[i3+2] = pos.z;          // pos
    this._vel[i3+0] = vel.x; this._vel[i3+1] = vel.y; this._vel[i3+2] = vel.z;          // vel
    this._age[i]   = 0;      this._life[i]  = life;                                     // età/vita
    this._size0[i] = size0;  this._size1[i] = size1;                                    // size in/out
    this._spin[i]  = spin;   this._seed[i]  = Math.random() * 1000;                     // spin/seed
    this._col[i3+0] = color.r; this._col[i3+1] = color.g; this._col[i3+2] = color.b;    // colore
  }

  /* ============================================================================
     UPDATE
  ============================================================================ */

  /** Aggiorna simulazione e buffer instanziati. */
  update(dt) {  
    // 1. Controllo se il sistema è attivo                                                // chiamato ogni frame
    if (!this.enabled) {                                                                 // se disabilitato
      this.geometry.instanceCount = 0;                                                   // niente istanze
      return;                                                                            // esci
    }

    // 2. Aggiorno il tempo e sincronizzo la camera 
    this._time += dt;                                                                     // avanza tempo

    // assi camera per billboard -> servono al vertex shader per costruire i billboard 
    this._right.set(1,0,0).applyQuaternion(this.camera.quaternion);                      // Right camera
    this._up.set(0,1,0).applyQuaternion(this.camera.quaternion);                         // Up camera
    
    // serve al fragment per calcolare la fog 
    this.material.uniforms.uCamRight.value.copy(this._right);                            // aggiorna uniform
    this.material.uniforms.uCamUp.value.copy(this._up);                                  // id.

    // fog manuale (sincronizzata con la scena)
    this.material.uniforms.uCamPos.value.copy(this.camera.position);                     // posizione camera
    if (this.scene && this.scene.fog && this.scene.fog.isFogExp2) {                      // se scena ha FogExp2
      this.material.uniforms.uFogColor.value.copy(this.scene.fog.color);                 // copia colore (per eventuale uso)
      this.material.uniforms.uFogDensity.value = this.scene.fog.density;                 // stessa densità
    }

    const { windAmp, windFreq, windSpeed, lift, drag } = this.params;                    // destruct parametri

    // 3. Itero su tutte le particelle -> se è viva, aggiorno vita, posizione e aspetto 
    // pack delle istanze vive in testa ai buffer
    let n = 0;                                                                           // contatore vivi
    for (let i = 0; i < this.max; i++) {                                                 // visita tutta la pool
      if (!this._alive[i]) continue;                                                     // salta morti

      // 4. Aggiorno fisica della particella 
      // aging
      let age = this._age[i] + dt;                                                       // nuova età
      const life = this._life[i];                                                        // durata
      if (age >= life) { this._alive[i] = false; continue; }                             // muore se scaduta
      this._age[i] = age;                                                                // salva età

      const i3 = i * 3;                                                                  // indice triplo
      // stato corrente
      const px = this._pos[i3+0], py = this._pos[i3+1], pz = this._pos[i3+2];            // posizione
      let   vx = this._vel[i3+0], vy = this._vel[i3+1], vz = this._vel[i3+2];            // velocità

      // vento Perlin 3D (coerente)
      const s = this._seed[i];                                                           // seme personale
      const t = this._time * windSpeed;                                                  // tempo scalato per vento
      const fx = this._noise.noise((px+s)*windFreq, (py-s)*windFreq, (pz+s)*windFreq + t); // forza X
      const fy = this._noise.noise((px-s)*windFreq + t, (py+s)*windFreq, (pz-s)*windFreq); // forza Y
      const fz = this._noise.noise((px+s)*windFreq, (py+s)*windFreq + t, (pz-s)*windFreq); // forza Z

      vx += fx * windAmp * dt;                                                           // integra vento X
      vy += (fy * 0.6 + lift) * dt;                                                      // vento Y + lift
      vz += fz * windAmp * dt;                                                           // vento Z

      // drag moltiplicativo (stabile) -> resistenza dall'aria frame-rate 
      const k = Math.exp(-drag * dt);                                                    // fattore decadimento
      vx *= k; vy *= k; vz *= k;                                                         // applica attrito

      // integrazione
      let nx = px + vx * dt;                                                             // nuova X
      let ny = py + vy * dt;                                                             // nuova Y
      let nz = pz + vz * dt;                                                             // nuova Z

      // ground “soft” (rimbalzo smorzato + attrito orizzontale)
      const gy = this.getGroundY(nx, nz) + 0.02;                                         // quota terreno + eps
      if (ny < gy) {                                                                     // sotto terreno?
        ny = gy;                                                                         // clamp a terreno
        if (vy < 0) vy *= -0.25;                                                         // rimbalzo smorzato
        vx *= 0.88; vz *= 0.88;                                                          // attrito XZ
      }

      // salva stato
      this._pos[i3+0] = nx; this._pos[i3+1] = ny; this._pos[i3+2] = nz;                  // salva pos
      this._vel[i3+0] = vx; this._vel[i3+1] = vy; this._vel[i3+2] = vz;                  // salva vel

      // 5. Aggiorno l'aspetto visivo della particella 
      // parametri visuali (size/alpha/angle)
      const u = age / life;                                                              // progress 0..1
      const grow = u;                                                                    // qui è lineare
      const size = this._size0[i] * (1.0 - grow) + this._size1[i] * grow;                // lerp size -> size cresce o cambia lungo la vita 

      // alpha: ease-in (0→0.15) & ease-out (0.75→1.0)
      const aIn  = THREE.MathUtils.smoothstep(u, 0.00, 0.15);                            // rampa di ingresso
      const aOut = 1.0 - THREE.MathUtils.smoothstep(u, 0.75, 1.00);                      // rampa di uscita
      const alpha = Math.max(0.0, Math.min(1.0, aIn * aOut));                            // alpha finale [0,1]

      const angle = (this._attrAngle.array[n] || 0) + this._spin[i] * dt;                // aggiorna rotazione

      // scrivi istanza “packed” -> Scrivo i dati nel buffer per la GPU 
      const j3 = n * 3;                                                                  // indice di packing
      this._attrOffset.array[j3+0] = nx;                                                // offset.x
      this._attrOffset.array[j3+1] = ny;                                                // offset.y
      this._attrOffset.array[j3+2] = nz;                                                // offset.z

      this._attrSize.array[n]  = size;                                                  // size
      this._attrAngle.array[n] = angle;                                                 // angle

      this._attrColor.array[j3+0] = this._col[i3+0];                                    // color.r
      this._attrColor.array[j3+1] = this._col[i3+1];                                    // color.g
      this._attrColor.array[j3+2] = this._col[i3+2];                                    // color.b
      this._attrAlpha.array[n]    = alpha;                                              // alpha

      n++;                                                                              // una istanza in più
    }

    // applica conteggio e invalida attributi GPU
    this.geometry.instanceCount = n;                                                    // quante istanze disegnare
    this._attrOffset.needsUpdate = true;                                                // segnala upload GPU
    this._attrSize.needsUpdate   = true;                                                // id.
    this._attrAngle.needsUpdate  = true;                                                // id.
    this._attrColor.needsUpdate  = true;                                                // id.
    this._attrAlpha.needsUpdate  = true;                                                // id.
  }

  /** Disattiva tutte le particelle vive e azzera il draw count. */
  clear() {                                                                             // spegne tutto
    for (let i = 0; i < this.max; i++) this._alive[i] = false;                          // marca morti
    this.geometry.instanceCount = 0;                                                    // zero istanze

    // invalida attributi (non strettamente necessario, ma sicuro)
    this._attrOffset.needsUpdate = true;                                                // forza upload
    this._attrSize.needsUpdate   = true;                                                // id.
    this._attrAngle.needsUpdate  = true;                                                // id.
    this._attrColor.needsUpdate  = true;                                                // id.
    this._attrAlpha.needsUpdate  = true;                                                // id.
  }

  /** Reset totale (pool + tempo interno). */
  reset() {                                                                             // reset globale
    this.clear();                                                                        // svuota pool
    this._time = 0;                                                                      // azzera tempo
  }
}
