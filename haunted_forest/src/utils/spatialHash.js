// spatialHash.js
// -----------------------------------------------------------------------------
// SpatialHash 2D per punti (x,z).
// - Divide il piano in celle quadrate di lato `cellSize`.
// - Ogni cella tiene la lista degli indici dei punti inseriti.
// - queryNeighbors(x,z[,radiusCells=1]) ritorna gli indici nelle celle
//   del vicinato (3x3 per default).
// -----------------------------------------------------------------------------
// NOTE:
//  • Pensato per inserimenti "una tantum" e poi query (no update/move).
//  • Per scene dinamiche, servirebbero remove/reinsert o una struttura diversa.
// -----------------------------------------------------------------------------

/**
 * Semplice griglia hash 2D per accelerare ricerche di vicinato su punti (x,z).
 */
export class SpatialHash {
  /**
   * @param {number} [cellSize=10] Lato della cella (stabilisce la granularità).
   */
  constructor(cellSize = 10) {
    this.cellSize = cellSize;
    this._invCell = 1 / cellSize;
    /** @type {Map<string, number[]>} key "ix,iz" → elenco indici punti */
    this.map = new Map();
    /** @type {{x:number,z:number}[]} elenco dei punti inseriti, in ordine di add() */
    this.points = [];
  }

  /** @private */
  _key(ix, iz) { return `${ix},${iz}`; }

  /** @private */
  _toCell(x, z) {
    // Math.floor gestisce correttamente anche coordinate negative
    return [Math.floor(x * this._invCell), Math.floor(z * this._invCell)];
  }

  /** @private */
  _bucket(ix, iz) {
    const k = this._key(ix, iz);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    return arr;
  }

  /**
   * Inserisce un punto e ritorna l’indice assegnato (0..N-1).
   * @param {number} x
   * @param {number} z
   * @returns {number} indice del punto nella lista `points`
   */
  add(x, z) {
    const idx = this.points.length;
    this.points.push({ x, z });
    const [ix, iz] = this._toCell(x, z);
    this._bucket(ix, iz).push(idx);
    return idx;
  }

  /**
   * Ritorna gli indici dei punti nelle celle attorno alla cella di (x,z).
   * @param {number} x
   * @param {number} z
   * @param {number} [radiusCells=1] raggio in celle (1 = 3x3; 2 = 5x5; …)
   * @returns {number[]} lista di indici in `points`
   */
  queryNeighbors(x, z, radiusCells = 1) {
    const [ix, iz] = this._toCell(x, z);
    const res = [];
    for (let dz = -radiusCells; dz <= radiusCells; dz++) {
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const arr = this.map.get(this._key(ix + dx, iz + dz));
        if (arr) res.push(...arr);
      }
    }
    return res;
  }

  /** Cancella tutti i dati (punti e mappa celle). */
  clear() {
    this.map.clear();
    this.points.length = 0;
  }
}

