// src/systems/WispSystem.js
// -----------------------------------------------------------------------------
// WispSystem
// -----------------------------------------------------------------------------
// Sistema particellare GPU “billboard + instancing” per piccole scie/fiammelle
// (wisps). È pensato per tre pattern di emissione:
//   - emitRing()    : anello a terra (o attorno a un ring)
//   - emitBurst()   : esplosione sferica morbida (celebration/purify burst)
//   - emitSheath()  : guaina cilindrica attorno a un corpo (ghost durante beam)
//
// Caratteristiche:
//   - Aggiornamento CPU di pos/vel (vento perlin + lift + drag + collisione soft)
//   - Rendering GPU via InstancedBufferGeometry (color/size/alpha/angle per istanza)
//   - Billboard in camera space (Right/Up della camera passati come uniform)
//   - Fog “manuale” nel fragment (Exp2) per evitare incompatibilità con fog built-in
//   - Blending Additive, depthTest on, depthWrite off
//
// NOTE: nessuna logica modificata rispetto alla tua versione. Solo refactor
// cosmetico, JSDoc, naming coerente e commenti.
//
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { ImprovedNoise } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/math/ImprovedNoise.js';

/**
 * @typedef {Object} WispOpts
 * @property {THREE.Scene}  scene
 * @property {THREE.Camera} camera
 * @property {(x:number, z:number)=>number} [getGroundY]   Funzione terreno
 * @property {number} [max=700]             Numero massimo di particelle
 * @property {number} [windAmp=1.3]         Intensità vento
 * @property {number} [windFreq=0.06]       Frequenza (spaziale) del rumore vento
 * @property {number} [windSpeed=0.45]      Velocità (temporale) del vento
 * @property {number} [lift=0.75]           Spinta verso l’alto
 * @property {number} [drag=0.9]            Attrito (decadimento velocità)
 */

export class WispSystem {
  /** @param {WispOpts} opts */
  constructor({
    scene,
    camera,
    getGroundY = (x, z) => 0,
    max = 700,
    windAmp = 1.3,
    windFreq = 0.06,
    windSpeed = 0.45,
    lift = 0.75,
    drag = 0.9
  } = {}) {
    // --- dipendenze
    this.scene = scene;
    this.camera = camera;
    this.getGroundY = getGroundY;

    // --- stato globale
    this.enabled = true;
    this.max = max;

    // --- parametri dinamici (tuning runtime possibile)
    this.params = { windAmp, windFreq, windSpeed, lift, drag };

    // --- pool particelle (SoA: Structure of Arrays)
    this._alive = new Array(max).fill(false);
    this._pos   = new Float32Array(max * 3);
    this._vel   = new Float32Array(max * 3);
    this._age   = new Float32Array(max);
    this._life  = new Float32Array(max);
    this._size0 = new Float32Array(max);
    this._size1 = new Float32Array(max);
    this._spin  = new Float32Array(max);
    this._seed  = new Float32Array(max);
    this._col   = new Float32Array(max * 3); // rgb [0..1]

    // --- geometria instanziata (billboard quad)
    const base = new THREE.PlaneGeometry(1, 1);
    const geo  = new THREE.InstancedBufferGeometry().copy(base);
    base.dispose();

    // attributi per istanza
    this._attrOffset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this._attrSize   = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this._attrAngle  = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this._attrColor  = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this._attrAlpha  = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);

    geo.setAttribute('iOffset', this._attrOffset);
    geo.setAttribute('iSize',   this._attrSize);
    geo.setAttribute('iAngle',  this._attrAngle);
    geo.setAttribute('iColor',  this._attrColor);
    geo.setAttribute('iAlpha',  this._attrAlpha);
    geo.instanceCount = 0;
    this.geometry = geo;

    // --- shader (billboard con Right/Up camera + fog manuale nel fragment)
    const vtx = `
      attribute vec3  iOffset;
      attribute float iSize;
      attribute float iAngle;
      attribute vec3  iColor;
      attribute float iAlpha;

      varying vec2 vCoord;
      varying vec4 vCol;
      varying vec3 vWorldPos;

      uniform vec3 uCamRight;
      uniform vec3 uCamUp;

      void main(){
        // quad locale [-0.5,0.5]^2 e rotazione in-plane
        float c = cos(iAngle), s = sin(iAngle);
        vec2 p = vec2(position.x, position.y);
        vec2 r = vec2(c*p.x - s*p.y, s*p.x + c*p.y);

        // billboard in spazio mondo con assi della camera
        vec3 world = iOffset + uCamRight * (r.x * iSize) + uCamUp * (r.y * iSize);

        vCoord    = r;                     // coord per radial falloff
        vCol      = vec4(iColor, iAlpha);  // colore+alpha per istanza
        vWorldPos = world;                 // posizione mondo per fog

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `;

    const frg = `
      precision mediump float;

      varying vec2 vCoord;
      varying vec4 vCol;
      varying vec3 vWorldPos;

      // Fog manuale (Exp2) + camera
      uniform vec3  uCamPos;
      uniform vec3  uFogColor;   // se serve un leggero tint (non usato nel colore finale additivo)
      uniform float uFogDensity;

      void main(){
        // soft circle (radial falloff)
        float d    = length(vCoord) * 1.41421356237; // sqrt(2) per normalizzare
        float soft = smoothstep(1.0, 0.0, d);
        float a    = vCol.a * soft;
        if (a <= 0.001) discard;

        // Exp2 fog factor in funzione della distanza camera→particella
        float distCam = distance(vWorldPos, uCamPos);
        float fogF    = 1.0 - exp( - (uFogDensity*uFogDensity) * distCam * distCam );

        // Per blending additivo: attenuo l'alpha (e quindi la luminosità) con la nebbia
        float aFogged = a * (1.0 - fogF);

        gl_FragColor = vec4(vCol.rgb * aFogged, aFogged);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader:   vtx,
      fragmentShader: frg,
      uniforms: {
        uCamRight:   { value: new THREE.Vector3(1,0,0) },
        uCamUp:      { value: new THREE.Vector3(0,1,0) },
        uCamPos:     { value: new THREE.Vector3() },
        uFogColor:   { value: new THREE.Color(0xDFE9F3) }, // solo per eventuale tint
        uFogDensity: { value: 1.6e-4 }                     // stesso valore della scena
      },
      transparent: true,
      depthWrite:  false,
      depthTest:   true,
      blending:    THREE.AdditiveBlending,
      fog:         false,   // IMPORTANT: disabilita fog built-in (usiamo quella manuale)
      toneMapped:  false
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 995;
    this.scene.add(this.mesh);

    // --- vento perlin
    this._noise = new ImprovedNoise();

    // --- scratch
    this._time  = 0;
    this._tmpV  = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up    = new THREE.Vector3();
  }

  /** Abilita/Disabilita rendering e update */
  setEnabled(v) {
    this.enabled = !!v;
    this.mesh.visible = this.enabled;
  }

  /* ============================================================================
     EMISSIONE
  ============================================================================ */

  /**
   * Emissione su anello (center,yaw,radius).
   * @param {THREE.Vector3} center
   * @param {number} [yaw=0]       orientamento dell’anello
   * @param {number} [radius=2.0]
   * @param {number} [count=16]
   * @param {{up?:number,out?:number,size?:[number,number],life?:[number,number],tint?:THREE.Color,spread?:number}} [opt]
   */
  emitRing(center, yaw = 0, radius = 2.0, count = 16, opt = {}) {
    const up     = opt.up     ?? 0.9;
    const out    = opt.out    ?? 0.7;
    const size   = opt.size   ?? [0.7, 1.8];
    const life   = opt.life   ?? [0.9, 1.6];
    const tint   = opt.tint   ?? new THREE.Color(0x9fe3ff);
    const spread = opt.spread ?? 0.35;

    const c = Math.cos(yaw), s = Math.sin(yaw);

    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;

      // punto sull’anello ruotato di yaw
      const lx = Math.cos(ang) * radius;
      const lz = Math.sin(ang) * radius;
      const rx = c * lx - s * lz;
      const rz = s * lx + c * lz;

      const pos = new THREE.Vector3(center.x + rx, center.y, center.z + rz);

      // velocità: radiale + componente verso l’alto
      const outward = new THREE.Vector3(rx, 0, rz).normalize();
      outward.x += (Math.random() - 0.5) * spread;
      outward.z += (Math.random() - 0.5) * spread;

      const vel = outward.multiplyScalar(out)
        .add(new THREE.Vector3(0, up * (0.8 + Math.random() * 0.6), 0));

      this._spawnOne({
        pos,
        vel,
        size0: THREE.MathUtils.lerp(size[0], size[1], Math.random() * 0.35),
        size1: THREE.MathUtils.lerp(size[0], size[1], 0.65 + Math.random() * 0.35),
        life:  THREE.MathUtils.lerp(life[0], life[1], 0.35 + Math.random() * 0.65),
        spin:  (Math.random() * 2 - 1) * 2.4,
        color: tint
      });
    }
  }

  /**
   * Emissione “burst” (sfera morbida).
   * @param {THREE.Vector3} center
   * @param {number} [count=100]
   * @param {{up?:number,out?:number,size?:[number,number],life?:[number,number],tint?:THREE.Color}} [opt]
   */
  emitBurst(center, count = 100, opt = {}) {
    const up   = opt.up   ?? 2.4;
    const out  = opt.out  ?? 1.8;
    const size = opt.size ?? [1.0, 2.8];
    const life = opt.life ?? [1.2, 2.2];
    const tint = opt.tint ?? new THREE.Color(0xffd166);

    for (let i = 0; i < count; i++) {
      // direzione uniforme su sfera
      let dir;
      do {
        dir = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1);
      } while (dir.lengthSq() < 1e-3);
      dir.normalize();

      // posizione iniziale leggermente distribuita (più densa vicino al centro)
      const r   = Math.pow(Math.random(), 0.6) * 0.8;
      const pos = new THREE.Vector3(center.x + dir.x * r, center.y + dir.y * r * 0.5, center.z + dir.z * r);

      // velocità radiale + lift
      const vel = dir.multiplyScalar(out * (0.6 + Math.random() * 0.8));
      vel.y += up * (0.8 + Math.random() * 0.5);

      this._spawnOne({
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
   * @param {THREE.Vector3} center
   * @param {number} [height=2.0]
   * @param {number} [radius=0.8]
   * @param {number} [count=40]
   * @param {{up?:number,out?:number,size?:[number,number],life?:[number,number],tint?:THREE.Color,spread?:number}} [opt]
   */
  emitSheath(center, height = 2.0, radius = 0.8, count = 40, opt = {}) {
    const up     = opt.up     ?? 1.2;
    const out    = opt.out    ?? 0.5;
    const size   = opt.size   ?? [0.7, 1.8];
    const life   = opt.life   ?? [0.9, 1.6];
    const tint   = opt.tint   ?? new THREE.Color(0x9fe3ff);
    const spread = opt.spread ?? 0.35;

    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const y01 = Math.random();
      const y   = (y01 - 0.5) * height;                 // [-H/2, H/2]
      const r   = radius * (0.85 + Math.random() * 0.3);

      const rx = Math.cos(ang) * r;
      const rz = Math.sin(ang) * r;

      const pos = new THREE.Vector3(center.x + rx, center.y + y, center.z + rz);

      const outward = new THREE.Vector3(rx, 0, rz).normalize();
      outward.x += (Math.random() - 0.5) * spread;
      outward.z += (Math.random() - 0.5) * spread;

      const vel = outward.multiplyScalar(out)
        .add(new THREE.Vector3(0, up * (0.8 + Math.random() * 0.6), 0));

      this._spawnOne({
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
  _spawnOne({ pos, vel, size0, size1, life, spin, color }) {
    // cerca slot libero
    for (let i = 0; i < this.max; i++) {
      if (this._alive[i]) continue;
      this._alive[i] = true;

      const i3 = i * 3;
      this._pos[i3+0] = pos.x; this._pos[i3+1] = pos.y; this._pos[i3+2] = pos.z;
      this._vel[i3+0] = vel.x; this._vel[i3+1] = vel.y; this._vel[i3+2] = vel.z;

      this._age[i]   = 0;
      this._life[i]  = life;
      this._size0[i] = size0;
      this._size1[i] = size1;
      this._spin[i]  = spin;
      this._seed[i]  = Math.random() * 1000;

      this._col[i3+0] = color.r; this._col[i3+1] = color.g; this._col[i3+2] = color.b;
      return;
    }

    // pool pieno → sovrascrivi un indice casuale (stesso comportamento)
    let i = Math.floor(Math.random() * this.max);
    const i3 = i * 3;
    this._alive[i] = true;
    this._pos[i3+0] = pos.x; this._pos[i3+1] = pos.y; this._pos[i3+2] = pos.z;
    this._vel[i3+0] = vel.x; this._vel[i3+1] = vel.y; this._vel[i3+2] = vel.z;
    this._age[i]   = 0;      this._life[i]  = life;
    this._size0[i] = size0;  this._size1[i] = size1;
    this._spin[i]  = spin;   this._seed[i]  = Math.random() * 1000;
    this._col[i3+0] = color.r; this._col[i3+1] = color.g; this._col[i3+2] = color.b;
  }

  /* ============================================================================
     UPDATE
  ============================================================================ */

  /** Aggiorna simulazione e buffer instanziati. */
  update(dt) {
    if (!this.enabled) {
      this.geometry.instanceCount = 0;
      return;
    }
    this._time += dt;

    // assi camera per billboard
    this._right.set(1,0,0).applyQuaternion(this.camera.quaternion);
    this._up.set(0,1,0).applyQuaternion(this.camera.quaternion);
    this.material.uniforms.uCamRight.value.copy(this._right);
    this.material.uniforms.uCamUp.value.copy(this._up);

    // fog manuale (sincronizzata con la scena)
    this.material.uniforms.uCamPos.value.copy(this.camera.position);
    if (this.scene && this.scene.fog && this.scene.fog.isFogExp2) {
      this.material.uniforms.uFogColor.value.copy(this.scene.fog.color);
      this.material.uniforms.uFogDensity.value = this.scene.fog.density;
    }

    const { windAmp, windFreq, windSpeed, lift, drag } = this.params;

    // pack delle istanze vive in testa ai buffer
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (!this._alive[i]) continue;

      // aging
      let age = this._age[i] + dt;
      const life = this._life[i];
      if (age >= life) { this._alive[i] = false; continue; }
      this._age[i] = age;

      const i3 = i * 3;
      // stato corrente
      const px = this._pos[i3+0], py = this._pos[i3+1], pz = this._pos[i3+2];
      let   vx = this._vel[i3+0], vy = this._vel[i3+1], vz = this._vel[i3+2];

      // vento Perlin 3D (coerente)
      const s = this._seed[i];
      const t = this._time * windSpeed;
      const fx = this._noise.noise((px+s)*windFreq, (py-s)*windFreq, (pz+s)*windFreq + t);
      const fy = this._noise.noise((px-s)*windFreq + t, (py+s)*windFreq, (pz-s)*windFreq);
      const fz = this._noise.noise((px+s)*windFreq, (py+s)*windFreq + t, (pz-s)*windFreq);

      vx += fx * windAmp * dt;
      vy += (fy * 0.6 + lift) * dt;
      vz += fz * windAmp * dt;

      // drag moltiplicativo (stabile)
      const k = Math.exp(-drag * dt);
      vx *= k; vy *= k; vz *= k;

      // integrazione
      let nx = px + vx * dt;
      let ny = py + vy * dt;
      let nz = pz + vz * dt;

      // ground “soft” (rimbalzo smorzato + attrito orizzontale)
      const gy = this.getGroundY(nx, nz) + 0.02;
      if (ny < gy) {
        ny = gy;
        if (vy < 0) vy *= -0.25;
        vx *= 0.88; vz *= 0.88;
      }

      // salva stato
      this._pos[i3+0] = nx; this._pos[i3+1] = ny; this._pos[i3+2] = nz;
      this._vel[i3+0] = vx; this._vel[i3+1] = vy; this._vel[i3+2] = vz;

      // parametri visuali (size/alpha/angle)
      const u = age / life;
      const grow = u; // 0..1
      const size = this._size0[i] * (1.0 - grow) + this._size1[i] * grow;

      // alpha: ease-in (0→0.15) & ease-out (0.75→1.0)
      const aIn  = THREE.MathUtils.smoothstep(u, 0.00, 0.15);
      const aOut = 1.0 - THREE.MathUtils.smoothstep(u, 0.75, 1.00);
      const alpha = Math.max(0.0, Math.min(1.0, aIn * aOut));

      const angle = (this._attrAngle.array[n] || 0) + this._spin[i] * dt;

      // scrivi istanza “packed”
      const j3 = n * 3;
      this._attrOffset.array[j3+0] = nx;
      this._attrOffset.array[j3+1] = ny;
      this._attrOffset.array[j3+2] = nz;

      this._attrSize.array[n]  = size;
      this._attrAngle.array[n] = angle;

      this._attrColor.array[j3+0] = this._col[i3+0];
      this._attrColor.array[j3+1] = this._col[i3+1];
      this._attrColor.array[j3+2] = this._col[i3+2];
      this._attrAlpha.array[n]    = alpha;

      n++;
    }

    // applica conteggio e invalida attributi GPU
    this.geometry.instanceCount = n;
    this._attrOffset.needsUpdate = true;
    this._attrSize.needsUpdate   = true;
    this._attrAngle.needsUpdate  = true;
    this._attrColor.needsUpdate  = true;
    this._attrAlpha.needsUpdate  = true;
  }

  /** Disattiva tutte le particelle vive e azzera il draw count. */
  clear() {
    for (let i = 0; i < this.max; i++) this._alive[i] = false;
    this.geometry.instanceCount = 0;

    // invalida attributi (non strettamente necessario, ma sicuro)
    this._attrOffset.needsUpdate = true;
    this._attrSize.needsUpdate   = true;
    this._attrAngle.needsUpdate  = true;
    this._attrColor.needsUpdate  = true;
    this._attrAlpha.needsUpdate  = true;
  }

  /** Reset totale (pool + tempo interno). */
  reset() {
    this.clear();
    this._time = 0;
  }
}
