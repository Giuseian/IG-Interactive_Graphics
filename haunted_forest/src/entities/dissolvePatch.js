// src/entities/dissolvePatch.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'; 

export function patchGhostMaterial(mat, opts = {}) {
  if (!mat || mat.isMaterial !== true) return;
  if (mat.userData._ghostPatched) return;

  const threshold     = opts.threshold     ?? 0.98;  // Soglia base del dissolve 
  const edgeWidth     = opts.edgeWidth     ?? 0.035; // Spessore banda del bordo 
  const edgeColor     = new THREE.Color(opts.edgeColor ?? 0x66ffff);  // colore emissivo del bordo
  const noiseScale    = opts.noiseScale    ?? 1.1;   // Scala spaziale del rumore 
  const flowSpeed     = opts.flowSpeed     ?? 0.6;   // Velocità scorrimento rumore 
  const thresholdBias = opts.thresholdBias ?? 0.0;   // Offset additivo alla soglia 
  const DEBUG_VIEWS   = opts.enableDebugViews ?? true;

  const uniforms = mat.userData._ghostUniforms || {
    uThreshold:     { value: threshold },
    uEdgeWidth:     { value: edgeWidth },
    uEdgeColor:     { value: edgeColor },
    uNoiseScale:    { value: noiseScale },
    uFlowSpeed:     { value: flowSpeed },
    uPulseTime:     { value: 0.0 },
    uDebugMode:     { value: 0.0 },
    uThresholdBias: { value: thresholdBias }, 
  };
  mat.userData._ghostUniforms = uniforms;  // salva uniforms in userData 
  mat.userData._ghostPatched = true;
  mat.userData._dbgCompileCount = 0;

  const keyBase = 'ghost-dissolve-v1';
  const prevKeyFn = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = function () {
    const k = `${keyBase};debug=${DEBUG_VIEWS ? 1 : 0}`;
    return prevKeyFn ? `${prevKeyFn()};${k}` : k;
  };


  // onBeforeCompile è un hook chiamato da Three.js quando sta per compilare il programma 
  mat.onBeforeCompile = (shader) => {
    mat.userData._dbgCompileCount++;
    Object.assign(shader.uniforms, uniforms);  // inserisce le uniform del dissolve nello shader 

    // world pos per il noise
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>
         varying vec3 vWorldPos;`)
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>
         vWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;`);

    const defines = `
      #define ENABLE_DEBUG_VIEWS ${DEBUG_VIEWS ? 1 : 0}
    `;

    // Rumore 3D 
    const injectCommon = `
      varying vec3 vWorldPos;
      uniform float uThreshold;
      uniform float uEdgeWidth;
      uniform vec3  uEdgeColor;
      uniform float uNoiseScale;
      uniform float uFlowSpeed;
      uniform float uPulseTime;
      uniform float uDebugMode;     // 0..3
      uniform float uThresholdBias; // 

      float hash(vec3 p){
        p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      
      // value noise trilineare 
      float vnoise(vec3 p){
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f*f*(3.0-2.0*f);
        float n000 = hash(i + vec3(0,0,0));
        float n100 = hash(i + vec3(1,0,0));
        float n010 = hash(i + vec3(0,1,0));
        float n110 = hash(i + vec3(1,1,0));
        float n001 = hash(i + vec3(0,0,1));
        float n101 = hash(i + vec3(1,0,1));
        float n011 = hash(i + vec3(0,1,1));
        float n111 = hash(i + vec3(1,1,1));
        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);
        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);
        return mix(nxy0, nxy1, f.z);
      }

      // Fractal Brownian Motion
      float fbm(vec3 p){
        float a = 0.5;
        float f = 1.0;
        float s = 0.0;
        for (int i = 0; i < 3; i++){
          s += a * vnoise(p * f);
          f *= 2.0;
          a *= 0.5;
        }
        return s;
      }

      // debug temps
      float g_n, g_thr, g_w, g_edge;
    `;

    // blocco principale (rinominato gh_* per non collidere con altri chunk)
    const preBlock = `
    {
      // uPulseTime * uFlowSpeed : il campo di rumore scorre -> dissolve vivo e dinamico ! 
      vec3  gh_p   = vWorldPos * uNoiseScale + vec3(0.0, 0.0, uPulseTime * uFlowSpeed);  // punto nel campo di rumore 
      float gh_n   = clamp(fbm(gh_p), 0.0, 1.0);  // valore fbm 
      float gh_thr = clamp(uThreshold + uThresholdBias, 0.0, 1.0);  // soglia con bias 
      float gh_w   = uEdgeWidth;  // spessore bordo desiderato 
      float gh_aa  = fwidth(gh_n) * 2.0;   // anti-alias adattivo 

      float gh_edge = 1.0 - smoothstep( gh_w, gh_w + gh_aa, abs(gh_n - gh_thr) );   //maschera banda del borso attorno alla soglia 

      g_n = gh_n; g_thr = gh_thr; g_w = gh_w; g_edge = gh_edge;

      if (uDebugMode < 0.5) {
        if (gh_n < gh_thr - gh_w) discard;
        totalEmissiveRadiance += uEdgeColor * (gh_edge * 2.0);
      }
    }`;

    // debug views - approx 1 -> valore noise (grigio), approx 2 -> maschera visibilità (0/1),  approx 3 -> intensità del bordo
    const postBlock = `
      #if ENABLE_DEBUG_VIEWS
        if (uDebugMode > 0.5 && uDebugMode < 1.5) {
          gl_FragColor = vec4(vec3(g_n), 1.0);
        } else if (uDebugMode > 1.5 && uDebugMode < 2.5) {
          float mask = step(g_thr - g_w, g_n);
          gl_FragColor = vec4(vec3(mask), 1.0);
        } else if (uDebugMode > 2.5 && uDebugMode < 3.5) {
          vec3 e = normalize(uEdgeColor);
          gl_FragColor = vec4(e * g_edge, 1.0);
        }
      #endif
    `;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${defines}\n#include <common>\n${injectCommon}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${preBlock}`)
      .replace('#include <dithering_fragment>', `${postBlock}\n#include <dithering_fragment>`);
  };

  // settaggi consigliati per la trasparenza
  mat.transparent = true;
  mat.depthTest   = true;
  mat.depthWrite  = false;
  mat.needsUpdate = true;
}