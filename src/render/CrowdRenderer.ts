/**
 * CrowdRenderer — draws every soldier and villager with a handful of draw calls.
 *
 * Characters are baked into vertex animation textures (VatBaker) and drawn as one
 * InstancedMesh per model (knight, archer, villager), plus instanced team rings,
 * selection rings, carried loads and order markers. Only display state lives here
 * (last positions / headings); everything else is read from GameState.
 *
 * API
 * - `sync(state, dtSec, selected, zoomDistance)` — call once per frame. `selected` = ids
 *   (units or villagers) that get a yellow selection ring. `zoomDistance` (camera
 *   distance) picks the level of detail: the simplified mesh is used when zoomed out
 *   or when the full meshes would exceed the crowd triangle budget.
 * - `showMarker(tiles, kind)` — pulsing ground ring (~1 s) on each tile, for order
 *   feedback: 'move' (white-green), 'harvest' (gold), 'attack' (red).
 * - `screenPositions(camera, width, height)` — screen-space positions (pixels, origin
 *   top-left) of everything drawn at the last sync, for tap / box picking:
 *   `{ id, kind: 'unit' | 'villager', x, y }[]`, where (x, y) is the character's chest.
 *   Entities behind the camera are left out.
 */
import * as THREE from 'three';
import type { GameState, ResourceType, TileType } from '../core/types';
import { drawnUnitIds } from '../systems/ArmySystem';
import type { Assets, CrowdModelKind } from './Assets';
import { TILE_HEIGHT } from './Terrain';
import { teamStyle } from './teams';
import type { CrowdClip, VatModel } from './VatBaker';

export type CrowdKind = 'unit' | 'villager';
export type MarkerKind = 'move' | 'harvest' | 'attack';

export interface ScreenEntity {
  id: string;
  kind: CrowdKind;
  x: number;
  y: number;
}

const START_CAPACITY = 32;
/** Zoomed out further than this: simplified meshes, no character shadows. */
const LOD_DISTANCE = 28;
/** Zoomed out further than this: coarsest meshes. */
const LOD_FAR_DISTANCE = 36;
/** Full-detail triangles allowed for the whole crowd (one pass; shadows double it). */
const FULL_DETAIL_BUDGET = 150_000;
const TURN_RATE = 12;
const MARKER_MS = 1000;
const CHEST_Y = 0.45;
const LOAD_Y = 0.93;
const VILLAGER_TINT = new THREE.Color(0xffffff);
const FOUNDER_TINT = new THREE.Color(1.0, 0.84, 0.62);
const TEAM_TINT = 0.22;
const MARKER_COLORS: Record<MarkerKind, THREE.Color> = {
  move: new THREE.Color(0xb8ff9a),
  harvest: new THREE.Color(0xffc93c),
  attack: new THREE.Color(0xff4a3a),
};
const LOADS: Record<ResourceType, { size: [number, number, number]; color: number }> = {
  wood: { size: [0.34, 0.09, 0.09], color: 0x7a4a22 },
  stone: { size: [0.15, 0.12, 0.15], color: 0xc4c4bc },
  ore: { size: [0.14, 0.11, 0.13], color: 0x9a4a1c },
  iron: { size: [0.16, 0.06, 0.1], color: 0x8c96a3 },
};

/** InstancedMesh that grows (doubles) when more instances are needed. */
class Pool {
  mesh!: THREE.InstancedMesh;
  capacity = 0;
  count = 0;

  constructor(
    private root: THREE.Object3D,
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private setup: (mesh: THREE.InstancedMesh) => void,
    private onGrow?: (capacity: number) => void,
  ) {
    this.build(START_CAPACITY);
  }

  begin(): void {
    this.count = 0;
  }

  /** Reserves the next instance slot and returns its index. */
  next(): number {
    if (this.count >= this.capacity) this.build(this.capacity * 2);
    return this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private build(capacity: number): void {
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      if (old.instanceColor && mesh.instanceColor) mesh.instanceColor.array.set(old.instanceColor.array);
      this.root.remove(old);
      old.dispose();
    }
    this.setup(mesh);
    this.onGrow?.(capacity);
    this.root.add(mesh);
    this.mesh = mesh;
    this.capacity = capacity;
  }
}

/** Character model pool with its per-instance animation attribute. */
class CrowdBatch {
  readonly pool: Pool;
  anim!: THREE.InstancedBufferAttribute;
  private lod = 0;
  private shadow = true;

  constructor(
    root: THREE.Object3D,
    readonly model: VatModel,
  ) {
    this.pool = new Pool(
      root,
      model.geometry,
      model.material,
      (m) => {
        m.castShadow = this.shadow;
        m.customDepthMaterial = model.depthMaterial;
      },
      (capacity) => {
        const next = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        next.setUsage(THREE.DynamicDrawUsage);
        if (this.anim) next.array.set(this.anim.array);
        this.anim = next;
        model.geometry.setAttribute('vatAnim', next);
      },
    );
  }

  get fullTriangles(): number {
    return (this.model.lods[0].count / 3) * this.pool.count;
  }

  setLod(level: number, shadow: boolean): void {
    this.shadow = shadow;
    this.pool.mesh.castShadow = shadow;
    if (level === this.lod) return;
    this.lod = level;
    this.model.geometry.setIndex(this.model.lods[level]);
  }
}

interface Track {
  x: number;
  y: number;
  yaw: number;
  phase: number;
  seen: number;
}

interface Marker {
  x: number;
  z: number;
  kind: MarkerKind;
  bornMs: number;
}

export class CrowdRenderer {
  readonly root = new THREE.Group();
  private batches: Record<CrowdModelKind, CrowdBatch>;
  private teamRings: Pool;
  private selectRings: Pool;
  private markerRings: Pool;
  private loads: Pool;
  private tracks = new Map<string, Track>();
  private markers: Marker[] = [];
  private drawn: { id: string; kind: CrowdKind; x: number; z: number }[] = [];
  private timeSec = 0;
  private frameNo = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    assets: Assets,
    private tileAt: (tx: number, ty: number) => TileType,
  ) {
    this.root.name = 'crowd';
    this.batches = {
      knight: new CrowdBatch(this.root, assets.crowdModel('knight')),
      archer: new CrowdBatch(this.root, assets.crowdModel('archer')),
      villager: new CrowdBatch(this.root, assets.crowdModel('villager')),
    };
    const ring = (inner: number, outer: number, opacity: number, additive = false): [THREE.BufferGeometry, THREE.Material] => [
      new THREE.RingGeometry(inner, outer, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    ];
    const flat = (mesh: THREE.InstancedMesh, order: number): void => {
      mesh.renderOrder = order;
    };
    this.teamRings = new Pool(this.root, ...ring(0.22, 0.3, 0.9), (m) => flat(m, 1));
    this.selectRings = new Pool(this.root, ...ring(0.3, 0.42, 0.95), (m) => flat(m, 2));
    this.markerRings = new Pool(this.root, ...ring(0.32, 0.46, 1, true), (m) => flat(m, 3));
    this.loads = new Pool(this.root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), () => {});
  }

  sync(state: GameState, dtSec: number, selected: ReadonlySet<string>, zoomDistance = 0): void {
    this.timeSec += dtSec;
    this.frameNo++;
    this.drawn.length = 0;
    for (const b of Object.values(this.batches)) b.pool.begin();
    this.teamRings.begin();
    this.selectRings.begin();
    this.loads.begin();

    for (const id of drawnUnitIds(state)) {
      const u = state.units[id];
      if (!u) continue;
      const tint = this.c.setRGB(1, 1, 1).lerp(teamStyle(u.ownerId).marker, TEAM_TINT);
      const yaw = this.track(id, u.x, u.y, dtSec);
      this.addCharacter(this.batches[u.type], id, u.x, u.y, yaw, u.path.length > 0 ? 'walk' : 'idle', tint, false);
      this.addRings(id, u.ownerId, u.x, u.y, selected);
      this.drawn.push({ id, kind: 'unit', x: u.x + 0.5, z: u.y + 0.5 });
    }
    for (const v of Object.values(state.villagers)) {
      if (v.inside) continue;
      const yaw = this.track(v.id, v.x, v.y, dtSec);
      const clip: CrowdClip = v.path.length > 0 ? (v.carrying ? 'carry' : 'walk') : v.task === 'working' ? 'work' : 'idle';
      const founder = !v.enlistable;
      this.addCharacter(this.batches.villager, v.id, v.x, v.y, yaw, clip, founder ? FOUNDER_TINT : VILLAGER_TINT, founder);
      this.addRings(v.id, v.ownerId, v.x, v.y, selected);
      if (v.carrying) this.addLoad(v.carrying.type, v.x, v.y, yaw);
      this.drawn.push({ id: v.id, kind: 'villager', x: v.x + 0.5, z: v.y + 0.5 });
    }

    const batches = Object.values(this.batches);
    const full = batches.reduce((sum, b) => sum + b.fullTriangles, 0);
    const far = zoomDistance > LOD_DISTANCE;
    const lod = zoomDistance > LOD_FAR_DISTANCE ? 2 : far || full > FULL_DETAIL_BUDGET ? 1 : 0;
    for (const b of batches) {
      // Zoomed out, characters are a few pixels tall: the ground ring replaces the shadow.
      b.setLod(lod, !far);
      b.pool.end();
      b.anim.needsUpdate = true;
    }
    this.teamRings.end();
    this.selectRings.end();
    this.loads.end();
    this.syncMarkers();
    for (const [id, t] of this.tracks) if (t.seen !== this.frameNo) this.tracks.delete(id);
  }

  showMarker(tiles: { tx: number; ty: number }[], kind: MarkerKind): void {
    const now = performance.now();
    for (const t of tiles) this.markers.push({ x: t.tx + 0.5, z: t.ty + 0.5, kind, bornMs: now });
  }

  screenPositions(camera: THREE.Camera, width: number, height: number): ScreenEntity[] {
    const out: ScreenEntity[] = [];
    const v = new THREE.Vector3();
    for (const d of this.drawn) {
      v.set(d.x, this.ground(d.x - 0.5, d.z - 0.5) + CHEST_Y, d.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      out.push({ id: d.id, kind: d.kind, x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height });
    }
    return out;
  }

  /** Top of the tile under a mover (rock / ore tiles are raised). */
  private ground(x: number, y: number): number {
    return Math.max(0, TILE_HEIGHT[this.tileAt(Math.floor(x + 0.5), Math.floor(y + 0.5))]);
  }

  /** Remembers the last position to face the walking direction (display state only). */
  private track(id: string, x: number, y: number, dtSec: number): number {
    let t = this.tracks.get(id);
    if (!t) {
      t = { x, y, yaw: hash(id) * Math.PI * 2, phase: hash(id), seen: 0 };
      this.tracks.set(id, t);
    }
    const dx = x - t.x;
    const dy = y - t.y;
    if (dx * dx + dy * dy > 1e-7) {
      const target = Math.atan2(dx, dy);
      let diff = target - t.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      t.yaw += diff * Math.min(1, dtSec * TURN_RATE);
    }
    t.x = x;
    t.y = y;
    t.seen = this.frameNo;
    return t.yaw;
  }

  private addCharacter(
    batch: CrowdBatch,
    id: string,
    x: number,
    y: number,
    yaw: number,
    clipName: CrowdClip,
    tint: THREE.Color,
    showProp: boolean,
  ): void {
    const clip = batch.model.clips[clipName] ?? batch.model.clips.idle;
    if (!clip) return;
    const i = batch.pool.next();
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(this.p.set(x + 0.5, this.ground(x, y), y + 0.5), this.q, this.s.set(1, 1, 1));
    batch.pool.mesh.setMatrixAt(i, this.m);
    batch.pool.mesh.setColorAt(i, tint);
    const phase = this.tracks.get(id)?.phase ?? 0;
    const pos = (((this.timeSec / clip.duration + phase) % 1) * clip.frames) % clip.frames;
    batch.anim.setXYZW(i, clip.start, clip.frames, pos, showProp ? 1 : 0);
  }

  private addRings(id: string, ownerId: string, x: number, y: number, selected: ReadonlySet<string>): void {
    const h = this.ground(x, y);
    this.q.identity();
    this.m.compose(this.p.set(x + 0.5, h + 0.02, y + 0.5), this.q, this.s.set(1, 1, 1));
    const i = this.teamRings.next();
    this.teamRings.mesh.setMatrixAt(i, this.m);
    this.teamRings.mesh.setColorAt(i, teamStyle(ownerId).marker);
    if (!selected.has(id)) return;
    this.m.setPosition(x + 0.5, h + 0.03, y + 0.5);
    const j = this.selectRings.next();
    this.selectRings.mesh.setMatrixAt(j, this.m);
    this.selectRings.mesh.setColorAt(j, this.c.setHex(0xffe14a));
  }

  private addLoad(type: ResourceType, x: number, y: number, yaw: number): void {
    const load = LOADS[type];
    this.q.setFromAxisAngle(this.up, yaw + Math.PI / 2);
    this.m.compose(this.p.set(x + 0.5, this.ground(x, y) + LOAD_Y + load.size[1] / 2, y + 0.5), this.q, this.s.set(...load.size));
    const i = this.loads.next();
    this.loads.mesh.setMatrixAt(i, this.m);
    this.loads.mesh.setColorAt(i, this.c.setHex(load.color));
  }

  private syncMarkers(): void {
    const now = performance.now();
    this.markers = this.markers.filter((mk) => now - mk.bornMs < MARKER_MS);
    this.markerRings.begin();
    this.q.identity();
    for (const mk of this.markers) {
      const t = (now - mk.bornMs) / MARKER_MS;
      const scale = 0.6 + 0.6 * t + 0.08 * Math.sin(t * Math.PI * 6);
      this.m.compose(this.p.set(mk.x, 0.04, mk.z), this.q, this.s.set(scale, 1, scale));
      const i = this.markerRings.next();
      this.markerRings.mesh.setMatrixAt(i, this.m);
      // Additive blending: darker color = more transparent, so this fades the ring out.
      this.markerRings.mesh.setColorAt(i, this.c.copy(MARKER_COLORS[mk.kind]).multiplyScalar(1 - t));
    }
    this.markerRings.end();
  }
}

/** Stable pseudo-random 0..1 from an id (animation phase desync). */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
