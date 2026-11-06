/**
 * Procedural vessels and their fracture.
 *
 * A vessel is a lathe (a profile spun around the Y axis) with real wall
 * thickness. It is cut into shards on a fine (u, v) grid: u runs around the
 * vessel, v runs from the foot to the rim. Every cell is assigned to the
 * nearest of a few seed points (a jittered Voronoi pattern measured in real
 * surface distance), which gives irregular, believable break lines. The foot
 * disc is its own piece and is always already in place.
 *
 * Everything is driven by a seeded random generator, so a given seed always
 * breaks the same way: the day's vessel is the same for everyone that day.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Vector3,
} from '@iwsdk/core';

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ShapeKind = 'chawan' | 'bowl' | 'vase' | 'cup';

export interface Glaze {
  name: string;
  outer: number;
  inner: number;
  clay: number;
}

export const GLAZES: Glaze[] = [
  { name: 'Celadon', outer: 0x8fb8a4, inner: 0xa9cbb9, clay: 0xb9a48a },
  { name: 'Indigo', outer: 0x2f4a7a, inner: 0xd8dde6, clay: 0xc2ad92 },
  { name: 'Ash white', outer: 0xe4ddd0, inner: 0xd2c9b8, clay: 0xa8927a },
  { name: 'Tenmoku', outer: 0x4a2a1a, inner: 0x6b3a22, clay: 0xb39a7e },
  { name: 'Persimmon', outer: 0xc0602e, inner: 0xe0b48c, clay: 0xbba184 },
  { name: 'Ink', outer: 0x22252b, inner: 0x8a8f96, clay: 0xb7a58f },
];

export interface VesselSpec {
  seed: number;
  shape: ShapeKind;
  glaze: Glaze;
  shardCount: number;
  height: number;
}

/** Radius and height of the outer wall at v in [0, 1]. */
export function profile(shape: ShapeKind, height: number, v: number): { r: number; y: number } {
  const y = v * height;
  let r: number;
  switch (shape) {
    case 'chawan': // tea bowl: steep, slightly flared walls
      r = 0.042 + 0.036 * Math.pow(v, 0.7) + 0.006 * Math.sin(v * Math.PI);
      break;
    case 'bowl': // wide open bowl
      r = 0.04 + 0.068 * Math.sin((v * Math.PI) / 2);
      break;
    case 'vase': // round belly, narrow neck, flared lip
      r =
        0.038 +
        0.04 * Math.sin(Math.min(v / 0.8, 1) * Math.PI) -
        0.012 * Math.max(0, v - 0.7) / 0.3 +
        0.016 * Math.pow(Math.max(0, v - 0.85) / 0.15, 2);
      break;
    case 'cup':
    default: // tall cup with a soft waist
      r = 0.04 + 0.01 * v - 0.004 * Math.sin(v * Math.PI * 1.2);
      break;
  }
  return { r, y };
}

export function shapeHeight(shape: ShapeKind): number {
  return { chawan: 0.085, bowl: 0.07, vase: 0.13, cup: 0.105 }[shape];
}

export function specForSeed(seed: number, shardBonus = 0): VesselSpec {
  const random = seededRandom(seed * 7919 + 13);
  const shapes: ShapeKind[] = ['chawan', 'bowl', 'vase', 'cup'];
  const shape = shapes[Math.floor(random() * shapes.length)];
  const glaze = GLAZES[Math.floor(random() * GLAZES.length)];
  const shardCount = 6 + Math.floor(random() * 3) + shardBonus;
  return { seed, shape, glaze, shardCount, height: shapeHeight(shape) };
}

const NU = 160; // cells around
const NV = 40; // cells foot to rim
export const WALL = 0.0045; // wall thickness in meters

export interface ShardData {
  index: number;
  /** Rest position of the shard's pivot in vessel space. */
  rest: Vector3;
  geometry: BufferGeometry;
  /** Approximate size, used for the proximity ghost. */
  radius: number;
}

export interface SeamData {
  /** Shard indexes on each side; -1 is the foot, which is always placed. */
  a: number;
  b: number;
  geometry: BufferGeometry;
}

export interface Vessel {
  spec: VesselSpec;
  shards: ShardData[];
  seams: SeamData[];
  foot: BufferGeometry;
}

function outerPoint(spec: VesselSpec, u: number, v: number, out: Vector3): Vector3 {
  const { r, y } = profile(spec.shape, spec.height, v);
  const a = u * Math.PI * 2;
  return out.set(Math.cos(a) * r, y + WALL, Math.sin(a) * r);
}

function innerPoint(spec: VesselSpec, u: number, v: number, out: Vector3): Vector3 {
  const { r, y } = profile(spec.shape, spec.height, v);
  const a = u * Math.PI * 2;
  const ri = Math.max(0.004, r - WALL);
  return out.set(Math.cos(a) * ri, y + WALL * 2, Math.sin(a) * ri);
}

function surfaceNormal(spec: VesselSpec, u: number, v: number, out: Vector3): Vector3 {
  const e = 0.002;
  const p0 = profile(spec.shape, spec.height, Math.max(0, v - e));
  const p1 = profile(spec.shape, spec.height, Math.min(1, v + e));
  const dr = p1.r - p0.r;
  const dy = p1.y - p0.y;
  // normal of the profile curve in (r, y), pointing outward
  const nr = dy;
  const ny = -dr;
  const len = Math.hypot(nr, ny) || 1;
  const a = u * Math.PI * 2;
  return out.set((Math.cos(a) * nr) / len, ny / len, (Math.sin(a) * nr) / len);
}

/** Build a vessel and break it into shards. */
export function buildVessel(spec: VesselSpec): Vessel {
  const random = seededRandom(spec.seed);
  const avgR = profile(spec.shape, spec.height, 0.5).r;
  const circ = Math.PI * 2 * avgR;
  const seeds: { u: number; v: number }[] = [];
  // Stratified seeds so pieces are of similar size.
  const n = spec.shardCount;
  const rows = n >= 7 ? 2 : 2;
  const perRow = [Math.ceil(n / rows), Math.floor(n / rows)];
  let made = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = perRow[row];
    const offset = random();
    for (let k = 0; k < count; k += 1) {
      seeds.push({
        u: (offset + (k + 0.2 + random() * 0.6) / count) % 1,
        v: (row + 0.2 + random() * 0.6) / rows,
      });
      made += 1;
    }
  }
  // Noise for jagged edges.
  const noiseTable = new Float32Array(NU * NV);
  for (let i = 0; i < noiseTable.length; i += 1) noiseTable[i] = random();

  const owner = new Int16Array(NU * NV);
  for (let j = 0; j < NV; j += 1) {
    for (let i = 0; i < NU; i += 1) {
      const u = (i + 0.5) / NU;
      const v = (j + 0.5) / NV;
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < seeds.length; s += 1) {
        let du = Math.abs(u - seeds[s].u);
        du = Math.min(du, 1 - du) * circ;
        const dv = (v - seeds[s].v) * spec.height * 1.15;
        const d = Math.hypot(du, dv) + noiseTable[j * NU + i] * 0.0035;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      owner[j * NU + i] = best;
    }
  }
  // Two passes of a majority filter remove one-cell islands.
  for (let pass = 0; pass < 2; pass += 1) {
    const copy = owner.slice();
    for (let j = 0; j < NV; j += 1) {
      for (let i = 0; i < NU; i += 1) {
        const me = copy[j * NU + i];
        const neighbors = [
          copy[j * NU + ((i + 1) % NU)],
          copy[j * NU + ((i - 1 + NU) % NU)],
          j > 0 ? copy[(j - 1) * NU + i] : me,
          j < NV - 1 ? copy[(j + 1) * NU + i] : me,
        ];
        const same = neighbors.filter((x) => x === me).length;
        if (same <= 1) {
          const counts = new Map<number, number>();
          neighbors.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
          let top = me;
          let topCount = 0;
          counts.forEach((c, k) => {
            if (c > topCount) {
              top = k;
              topCount = c;
            }
          });
          owner[j * NU + i] = top;
        }
      }
    }
  }

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const tmpD = new Vector3();
  const tmpN = new Vector3();

  const shards: ShardData[] = [];
  const seedToShard = new Map<number, number>();
  const seamBuilders = new Map<string, { a: number; b: number; pos: number[]; nor: number[] }>();

  const seamFor = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    let s = seamBuilders.get(key);
    if (!s) {
      s = { a: lo, b: hi, pos: [], nor: [] };
      seamBuilders.set(key, s);
    }
    return s;
  };

  // Gold ribbon along an edge between (u0,v0) and (u1,v1), on both faces.
  const addSeam = (s: { pos: number[]; nor: number[] }, u0: number, v0: number, u1: number, v1: number) => {
    const half = 0.0011;
    const lift = 0.0007;
    for (const face of [0, 1]) {
      const p0 = face === 0 ? outerPoint(spec, u0, v0, new Vector3()) : innerPoint(spec, u0, v0, new Vector3());
      const p1 = face === 0 ? outerPoint(spec, u1, v1, new Vector3()) : innerPoint(spec, u1, v1, new Vector3());
      const n0 = surfaceNormal(spec, (u0 + u1) / 2, (v0 + v1) / 2, new Vector3());
      if (face === 1) n0.negate();
      const dir = p1.clone().sub(p0).normalize();
      const side = new Vector3().crossVectors(n0, dir).normalize().multiplyScalar(half);
      const lift0 = n0.clone().multiplyScalar(lift);
      const a = p0.clone().add(lift0).add(side);
      const b = p0.clone().add(lift0).sub(side);
      const c = p1.clone().add(lift0).add(side);
      const d = p1.clone().add(lift0).sub(side);
      const quad = face === 0 ? [a, b, c, c, b, d] : [a, c, b, c, d, b];
      for (const p of quad) {
        s.pos.push(p.x, p.y, p.z);
        s.nor.push(n0.x, n0.y, n0.z);
      }
    }
  };

  for (let s = 0; s < seeds.length; s += 1) {
    const outer: number[] = [];
    const outerN: number[] = [];
    const inner: number[] = [];
    const innerN: number[] = [];
    const walls: number[] = [];
    const wallsN: number[] = [];
    let cellCount = 0;
    const center = new Vector3();

    const pushTri = (arr: number[], narr: number[], ps: Vector3[], ns: Vector3[]) => {
      for (let k = 0; k < ps.length; k += 1) {
        arr.push(ps[k].x, ps[k].y, ps[k].z);
        narr.push(ns[k].x, ns[k].y, ns[k].z);
      }
    };

    const wall = (ua: number, va: number, ub: number, vb: number) => {
      const oa = outerPoint(spec, ua, va, new Vector3());
      const ob = outerPoint(spec, ub, vb, new Vector3());
      const ia = innerPoint(spec, ua, va, new Vector3());
      const ib = innerPoint(spec, ub, vb, new Vector3());
      const nrm = new Vector3()
        .subVectors(ob, oa)
        .cross(new Vector3().subVectors(ia, oa))
        .normalize();
      const ps = [oa, ob, ia, ia, ob, ib];
      pushTri(walls, wallsN, ps, ps.map(() => nrm));
    };

    for (let j = 0; j < NV; j += 1) {
      for (let i = 0; i < NU; i += 1) {
        if (owner[j * NU + i] !== s) continue;
        cellCount += 1;
        const u0 = i / NU;
        const u1 = (i + 1) / NU;
        const v0 = j / NV;
        const v1 = (j + 1) / NV;
        outerPoint(spec, (u0 + u1) / 2, (v0 + v1) / 2, tmpA);
        center.add(tmpA);
        // outer face
        const o00 = outerPoint(spec, u0, v0, new Vector3());
        const o10 = outerPoint(spec, u1, v0, new Vector3());
        const o01 = outerPoint(spec, u0, v1, new Vector3());
        const o11 = outerPoint(spec, u1, v1, new Vector3());
        const n00 = surfaceNormal(spec, u0, v0, new Vector3());
        const n10 = surfaceNormal(spec, u1, v0, new Vector3());
        const n01 = surfaceNormal(spec, u0, v1, new Vector3());
        const n11 = surfaceNormal(spec, u1, v1, new Vector3());
        pushTri(outer, outerN, [o00, o01, o10, o10, o01, o11], [n00, n01, n10, n10, n01, n11]);
        // inner face (reversed winding, flipped normals)
        const i00 = innerPoint(spec, u0, v0, new Vector3());
        const i10 = innerPoint(spec, u1, v0, new Vector3());
        const i01 = innerPoint(spec, u0, v1, new Vector3());
        const i11 = innerPoint(spec, u1, v1, new Vector3());
        pushTri(
          inner,
          innerN,
          [i00, i10, i01, i10, i11, i01],
          [n00, n10, n01, n10, n11, n01].map((x) => x.clone().negate()),
        );
        // walls where the neighbor belongs to another piece (or the rim/foot)
        const right = owner[j * NU + ((i + 1) % NU)];
        const left = owner[j * NU + ((i - 1 + NU) % NU)];
        const up = j < NV - 1 ? owner[(j + 1) * NU + i] : -2;
        const down = j > 0 ? owner[(j - 1) * NU + i] : -1;
        if (right !== s) {
          wall(u1, v1, u1, v0);
          addSeam(seamFor(s, right), u1, v0, u1, v1);
        }
        if (left !== s) {
          wall(u0, v0, u0, v1);
        }
        if (up !== s) {
          wall(u0, v1, u1, v1);
          if (up >= 0) addSeam(seamFor(s, up), u0, v1, u1, v1);
        }
        if (down !== s) {
          wall(u1, v0, u0, v0);
          if (down === -1) addSeam(seamFor(-1, s), u0, v0, u1, v0);
        }
      }
    }
    if (cellCount === 0) continue;
    center.multiplyScalar(1 / cellCount);
    // Pull the pivot slightly inward so it sits inside the wall.
    const pivot = center.clone();

    const all = [...outer, ...inner, ...walls];
    const allN = [...outerN, ...innerN, ...wallsN];
    for (let k = 0; k < all.length; k += 3) {
      all[k] -= pivot.x;
      all[k + 1] -= pivot.y;
      all[k + 2] -= pivot.z;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(all), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(allN), 3));
    geometry.addGroup(0, outer.length / 3, 0);
    geometry.addGroup(outer.length / 3, inner.length / 3, 1);
    geometry.addGroup((outer.length + inner.length) / 3, walls.length / 3, 2);
    geometry.computeBoundingSphere();
    shards.push({
      index: shards.length,
      rest: pivot,
      geometry,
      radius: geometry.boundingSphere?.radius ?? 0.03,
    });
    seedToShard.set(s, shards.length - 1);
  }

  const seams: SeamData[] = [];
  seamBuilders.forEach((sb) => {
    if (sb.pos.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(sb.pos), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(sb.nor), 3));
    const fix = (x: number) => (x >= 0 ? seedToShard.get(x) ?? -1 : -1);
    seams.push({ a: fix(sb.a), b: fix(sb.b), geometry });
  });

  // Foot: a thick disc with a ring, always in place.
  const foot = buildFoot(spec);
  void tmpB;
  void tmpC;
  void tmpD;
  void tmpN;
  return { spec, shards, seams, foot };
}

function buildFoot(spec: VesselSpec): BufferGeometry {
  const r0 = profile(spec.shape, spec.height, 0).r;
  const segs = NU;
  const pos: number[] = [];
  const nor: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
  };
  const topY = WALL * 2;
  for (let i = 0; i < segs; i += 1) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const ri = Math.max(0.004, r0 - WALL);
    // top (inside of vessel)
    push(0, topY, 0, 0, 1, 0);
    push(c1 * ri, topY, s1 * ri, 0, 1, 0);
    push(c0 * ri, topY, s0 * ri, 0, 1, 0);
    // bottom
    push(0, 0, 0, 0, -1, 0);
    push(c0 * r0, 0, s0 * r0, 0, -1, 0);
    push(c1 * r0, 0, s1 * r0, 0, -1, 0);
    // side band
    push(c0 * r0, 0, s0 * r0, c0, 0, s0);
    push(c0 * r0, WALL, s0 * r0, c0, 0, s0);
    push(c1 * r0, 0, s1 * r0, c1, 0, s1);
    push(c1 * r0, 0, s1 * r0, c1, 0, s1);
    push(c0 * r0, WALL, s0 * r0, c0, 0, s0);
    push(c1 * r0, WALL, s1 * r0, c1, 0, s1);
    // ledge between outer and inner at the foot top
    push(c0 * r0, WALL, s0 * r0, 0, 1, 0);
    push(c0 * ri, topY, s0 * ri, 0, 1, 0);
    push(c1 * r0, WALL, s1 * r0, 0, 1, 0);
    push(c1 * r0, WALL, s1 * r0, 0, 1, 0);
    push(c0 * ri, topY, s0 * ri, 0, 1, 0);
    push(c1 * ri, topY, s1 * ri, 0, 1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  return g;
}
