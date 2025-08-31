// rng.js
// -----------------------------------------------------------------------------
// Mulberry32: PRNG leggero, deterministico, 32-bit, NON crittografico.
// - createRNG(seed)  → funzione rand() che restituisce float in [0,1)
// - randRange(rand,a,b) → uniforme nell'intervallo [a,b)
// -----------------------------------------------------------------------------

/**
 * Crea un generatore di numeri pseudo-casuali deterministico (Mulberry32).
 * @param {number} [seed=1234] - Seed iniziale (solo i 32 bit più bassi sono usati).
 * @returns {() => number} Funzione che, ad ogni chiamata, restituisce un float uniforme in [0,1).
 */
export function createRNG(seed = 1234) {
  let t = seed >>> 0; // forza a uint32

  return function rand() {
    // avanzamento di stato + mix di bit (xorshift-like) con moltiplicazioni 32-bit
    t += 0x6D2B79F5; // costante scelta per diffondere lo stato
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    // normalizza a [0,1): converte a uint32 e divide per 2^32
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Estrae un numero uniforme nell'intervallo [a, b) usando un PRNG dato.
 * @param {() => number} rand - La funzione generata da createRNG().
 * @param {number} a - Estremo inferiore (incluso).
 * @param {number} b - Estremo superiore (escluso).
 * @returns {number} Numero uniforme in [a, b).
 */
export function randRange(rand, a, b) {
  return a + (b - a) * rand();
}
