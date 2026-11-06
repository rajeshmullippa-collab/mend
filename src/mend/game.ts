/**
 * MendSystem: the whole loop.
 *
 *   1. A vessel (the day's seed) sits broken on a small mat in front of you.
 *   2. Pinch a shard (IWSDK OneHandGrabbable, hand pinch), bring it near where
 *      it belongs. A gold ghost of its home fades in as you get close.
 *   3. Let go close enough and it seats itself with a bell tone; every crack
 *      it closes fills with gold.
 *   4. When the vessel is whole it joins your shelf. One new vessel a day.
 *
 * Everything fits within ~0.5 m of the head (seated, 2 ft radius). Progress
 * is saved after every shard, so taking the headset off is a clean pause.
 */
import {
  CircleGeometry,
  Color,
  createSystem,
  DoubleSide,
  Entity,
  Grabbed,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OneHandGrabbable,
  Pressed,
  Quaternion,
  RayInteractable,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { MendAudio } from './audio.js';
import { MendButton, Shard } from './components.js';
import { Label } from './label.js';
import { buildVessel, seededRandom, specForSeed, Vessel, VesselSpec } from './vessel.js';

const SNAP_DISTANCE = 0.04; // m
const SNAP_ANGLE = (55 * Math.PI) / 180;
const GHOST_DISTANCE = 0.11; // m
const STORE_KEY = 'mend.v1';

interface ShelfItem {
  seed: number;
  date: string;
  seconds: number;
  daily: boolean;
}

interface Saved {
  shelf: ShelfItem[];
  current?: { seed: number; daily: boolean; placed: number[]; elapsed: number };
  muted?: boolean;
}

function todaySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

interface ShardState {
  entity: Entity;
  mesh: Mesh;
  materials: MeshStandardMaterial[];
  ghost: Mesh;
  seated: Mesh; // static copy inside the vessel once placed
  placed: boolean;
  home: Vector3; // scatter position in stage space
  homeQuat: Quaternion;
  snapAnim: number; // <0 idle; 0..1 animating into place
  snapFromPos: Vector3;
  snapFromQuat: Quaternion;
}

interface SeamState {
  a: number;
  b: number;
  mesh: Mesh;
  material: MeshStandardMaterial;
  t: number; // reveal progress, <0 hidden
}

export class MendSystem extends createSystem({
  grabbed: { required: [Shard, Grabbed] },
  pressed: { required: [MendButton, Pressed] },
}) {
  private audio = new MendAudio();
  private save: Saved = { shelf: [] };

  private stage!: Group; // positioned at the anchor, faces the player
  private stageEntity!: Entity;
  private vesselRoot!: Group;
  private shelfRoot!: Group;
  private vessel: Vessel | null = null;
  private spec: VesselSpec | null = null;
  private daily = true;
  private shards: ShardState[] = [];
  private seams: SeamState[] = [];
  private grabbedIndex = -1;
  private elapsed = 0;
  private started = false;
  private complete = false;
  private completeTime = 0;
  private idle = 0;
  private hintIndex = -1;
  private anchoredInXR = false;
  private xrFrames = 0;

  private title!: Label;
  private status!: Label;
  private doneCard!: Label;
  private buttons: { entity: Entity; label: Label; action: string }[] = [];

  // scratch
  private v1 = new Vector3();
  private v2 = new Vector3();
  private q1 = new Quaternion();
  private q2 = new Quaternion();
  private m = new Object3D();

  init(): void {
    this.load();
    this.audio.setMuted(!!this.save.muted);

    this.stage = new Group();
    this.stage.name = 'Mend Stage';
    this.stageEntity = this.world.createTransformEntity(this.stage);
    this.vesselRoot = new Group();
    this.stage.add(this.vesselRoot);
    this.shelfRoot = new Group();
    this.stage.add(this.shelfRoot);

    // A dark felt mat with a thin gold rim: the "work table".
    const mat = new Mesh(
      new CircleGeometry(0.27, 64),
      new MeshStandardMaterial({ color: 0x23201d, roughness: 1, transparent: true, opacity: 0.92 }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = -0.001;
    this.stage.add(mat);
    const rim = new Mesh(
      new RingGeometry(0.268, 0.272, 96),
      new MeshBasicMaterial({ color: 0xc9a14a, side: DoubleSide, transparent: true, opacity: 0.8 }),
    );
    rim.rotation.x = -Math.PI / 2;
    this.stage.add(rim);

    this.title = new Label({ width: 0.26, height: 0.075 });
    this.title.mesh.position.set(0, 0.235, -0.03);
    this.stage.add(this.title.mesh);

    this.status = new Label({ width: 0.15, height: 0.032, bg: 'rgba(20,18,16,0.6)' });
    this.status.mesh.position.set(0, 0.012, 0.215);
    this.status.mesh.rotation.x = -Math.PI / 2 + 0.6;
    this.stage.add(this.status.mesh);

    this.doneCard = new Label({ width: 0.3, height: 0.1 });
    this.doneCard.mesh.position.set(0, 0.27, -0.03);
    this.doneCard.mesh.visible = false;
    this.stage.add(this.doneCard.mesh);

    this.addButton('recenter', 'Recenter', new Vector3(-0.19, 0.03, 0.17));
    this.addButton('sound', this.save.muted ? 'Sound: off' : 'Sound: on', new Vector3(0.19, 0.03, 0.17));
    this.addButton('next', 'Next vessel', new Vector3(-0.075, 0.2, 0.02), true);
    this.addButton('again', 'Break it again', new Vector3(0.075, 0.2, 0.02), true);

    // Default placement for non-XR preview: on a table in front of the camera.
    this.stage.position.set(0, 1.0, -0.5);

    const cur = this.save.current;
    if (cur) this.startVessel(cur.seed, cur.daily, cur.placed, cur.elapsed);
    else {
      const seed = this.firstSeed();
      this.startVessel(seed, seed === todaySeed());
    }

    this.queries.grabbed.subscribe('qualify', (entity) => {
      const index = entity.getValue(Shard, 'index') as number;
      this.grabbedIndex = index;
      this.idle = 0;
      this.clearHint();
      this.audio.ensure();
      if (!this.started) {
        this.started = true;
        this.audio.startDrone();
      }
      this.audio.clink(1, 0.25);
    });
    this.queries.grabbed.subscribe('disqualify', (entity) => {
      const index = entity.getValue(Shard, 'index') as number;
      if (this.grabbedIndex === index) this.grabbedIndex = -1;
      this.release(index);
    });
    this.queries.pressed.subscribe('qualify', (entity) => {
      const action = entity.getValue(MendButton, 'action') as string;
      this.onButton(action);
    });

    const onHide = () => this.persist();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    });
    (window as any).__MEND__ = this;
    (window as any).__MEND_AUDIO__ = MendAudio; // handy for automated demo recording
  }

  // ---------- persistence ----------
  private load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.save = { shelf: [], ...JSON.parse(raw) };
    } catch {
      this.save = { shelf: [] };
    }
  }

  private persist() {
    try {
      if (this.spec && !this.complete) {
        this.save.current = {
          seed: this.spec.seed,
          daily: this.daily,
          placed: this.shards.map((s, i) => (s.placed ? i : -1)).filter((i) => i >= 0),
          elapsed: this.elapsed,
        };
      } else {
        delete this.save.current;
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(this.save));
    } catch {
      /* storage may be unavailable; the session still works */
    }
  }

  private firstSeed(): number {
    const t = todaySeed();
    const doneToday = this.save.shelf.some((s) => s.daily && s.seed === t);
    return doneToday ? Math.floor(Math.random() * 1e9) : t;
  }

  // ---------- building ----------
  private disposeVessel() {
    this.shards.forEach((s) => {
      s.entity.dispose();
      s.ghost.removeFromParent();
      s.seated.removeFromParent();
    });
    this.seams.forEach((s) => s.mesh.removeFromParent());
    this.vesselRoot.clear();
    this.shards = [];
    this.seams = [];
  }

  private startVessel(seed: number, daily: boolean, placed: number[] = [], elapsed = 0) {
    this.disposeVessel();
    const shelfBonus = Math.min(3, Math.floor(this.save.shelf.length / 3));
    const spec = specForSeed(seed, shelfBonus);
    const vessel = buildVessel(spec);
    this.spec = spec;
    this.vessel = vessel;
    this.daily = daily;
    this.complete = false;
    this.elapsed = elapsed;
    this.idle = 0;
    this.hintIndex = -1;
    this.vesselRoot.rotation.set(0, 0, 0);
    this.doneCard.mesh.visible = false;
    this.setDoneButtons(false);

    const glaze = spec.glaze;
    const outerMat = new MeshStandardMaterial({ color: glaze.outer, roughness: 0.32, metalness: 0.05 });
    const innerMat = new MeshStandardMaterial({ color: glaze.inner, roughness: 0.38, metalness: 0.02 });
    const clayMat = new MeshStandardMaterial({ color: glaze.clay, roughness: 0.95 });

    const foot = new Mesh(vessel.foot, clayMat);
    this.vesselRoot.add(foot);

    const random = seededRandom(seed + 99);
    const n = vessel.shards.length;
    vessel.shards.forEach((shard, i) => {
      const materials = [outerMat.clone(), innerMat.clone(), clayMat.clone()];
      const mesh = new Mesh(shard.geometry, materials);
      mesh.name = `Shard ${i + 1}`;
      // Scatter on the near half of the mat, within easy reach.
      const ang = Math.PI * (0.05 + (0.9 * (i + 0.5)) / n) + (random() - 0.5) * 0.12;
      const rad = 0.165 + random() * 0.05;
      const home = new Vector3(Math.cos(ang) * rad, 0.025 + random() * 0.01, Math.sin(ang) * rad * 0.9 + 0.01);
      // Start orientation: its true orientation, turned a little (still matchable).
      const rest = new Quaternion();
      const twist = new Quaternion().setFromAxisAngle(
        new Vector3(random() - 0.5, 1, random() - 0.5).normalize(),
        (random() - 0.5) * 0.7,
      );
      const homeQuat = twist.multiply(rest);

      const entity = this.world.createTransformEntity(mesh);
      entity.addComponent(Shard, { index: i });
      this.placeInWorld(mesh, home, homeQuat);

      const ghost = new Mesh(
        shard.geometry,
        new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false }),
      );
      ghost.position.copy(shard.rest);
      ghost.visible = false;
      this.vesselRoot.add(ghost);

      const seated = new Mesh(shard.geometry, materials);
      seated.position.copy(shard.rest);
      seated.visible = false;
      this.vesselRoot.add(seated);

      const state: ShardState = {
        entity,
        mesh,
        materials,
        ghost,
        seated,
        placed: false,
        home,
        homeQuat,
        snapAnim: -1,
        snapFromPos: new Vector3(),
        snapFromQuat: new Quaternion(),
      };
      this.shards.push(state);
      if (placed.includes(i)) {
        this.seatInstant(i);
      } else {
        entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
      }
    });

    vessel.seams.forEach((seam) => {
      const material = new MeshStandardMaterial({
        color: 0xd9a632,
        metalness: 1,
        roughness: 0.22,
        emissive: new Color(0x8a5a00),
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0,
      });
      const mesh = new Mesh(seam.geometry, material);
      mesh.visible = false;
      this.vesselRoot.add(mesh);
      const s: SeamState = { a: seam.a, b: seam.b, mesh, material, t: -1 };
      this.seams.push(s);
    });
    this.seams.forEach((s) => {
      if (this.isPlaced(s.a) && this.isPlaced(s.b)) {
        s.t = 1;
        s.mesh.visible = true;
        s.material.opacity = 1;
        s.material.emissiveIntensity = 0.35;
      }
    });

    this.started = placed.length > 0;
    this.title.set(
      placed.length > 0
        ? ['Welcome back', `${spec.glaze.name} ${spec.shape}`, '*Pick up where you left off']
        : [daily ? "Today's vessel" : 'A new vessel', `${spec.glaze.name} ${spec.shape} · ${n} shards`, '*Pinch a shard. Bring it home.'],
    );
    this.title.mesh.visible = true;
    this.updateStatus();
    this.rebuildShelf();
    this.persist();
  }

  /** Put a shard's object at a stage-space pose, in world space. */
  private placeInWorld(obj: Object3D, pos: Vector3, quat: Quaternion) {
    this.stage.updateMatrixWorld(true);
    this.v1.copy(pos).applyMatrix4(this.stage.matrixWorld);
    this.stage.getWorldQuaternion(this.q1);
    obj.position.copy(this.v1);
    obj.quaternion.copy(this.q1).multiply(quat);
  }

  private addButton(action: string, text: string, pos: Vector3, done = false) {
    const label = new Label({ width: 0.11, height: 0.034, radius: 0.5 });
    label.set([text]);
    label.mesh.position.copy(pos);
    if (!done) label.mesh.rotation.x = -0.5;
    this.stage.add(label.mesh);
    const entity = this.world.createTransformEntity(label.mesh, { parent: this.stageEntity });
    entity.addComponent(RayInteractable);
    entity.addComponent(MendButton, { action });
    label.mesh.visible = !done;
    this.buttons.push({ entity, label, action });
  }

  private setDoneButtons(visible: boolean) {
    this.buttons.forEach((b) => {
      if (b.action === 'next' || b.action === 'again') b.label.mesh.visible = visible;
    });
  }

  private isPlaced(i: number) {
    return i < 0 || !!this.shards[i]?.placed;
  }

  // ---------- interaction ----------
  private slotWorld(i: number, pos: Vector3, quat: Quaternion) {
    const s = this.shards[i];
    this.vesselRoot.updateMatrixWorld(true);
    pos.copy(s.ghost.position).applyMatrix4(this.vesselRoot.matrixWorld);
    this.vesselRoot.getWorldQuaternion(quat);
  }

  private release(i: number) {
    const s = this.shards[i];
    if (!s || s.placed) return;
    s.ghost.visible = false;
    this.slotWorld(i, this.v1, this.q1);
    const d = s.mesh.position.distanceTo(this.v1);
    const ang = s.mesh.quaternion.angleTo(this.q1);
    if (d < SNAP_DISTANCE && ang < SNAP_ANGLE) {
      s.placed = true;
      s.entity.removeComponent(OneHandGrabbable);
      s.snapAnim = 0;
      s.snapFromPos.copy(s.mesh.position);
      s.snapFromQuat.copy(s.mesh.quaternion);
      return;
    }
    this.audio.clink(0.8, 0.18);
    // Dropped out of reach or below the mat: float it back home.
    this.stage.updateMatrixWorld(true);
    this.v2.copy(s.mesh.position);
    this.stage.worldToLocal(this.v2);
    if (this.v2.length() > 0.45 || this.v2.y < -0.02) {
      s.snapAnim = 0;
      s.snapFromPos.copy(s.mesh.position);
      s.snapFromQuat.copy(s.mesh.quaternion);
      (s as any).returning = true;
    }
  }

  private seatInstant(i: number) {
    const s = this.shards[i];
    s.placed = true;
    s.mesh.visible = false;
    s.seated.visible = true;
    if (s.entity.hasComponent(OneHandGrabbable)) s.entity.removeComponent(OneHandGrabbable);
  }

  private onSeated(i: number) {
    const s = this.shards[i];
    s.mesh.visible = false;
    s.seated.visible = true;
    s.mesh.position.set(0, -50, 0); // park the grab entity far away
    const count = this.shards.filter((x) => x.placed).length;
    this.audio.seat(count);
    let revealed = 0;
    this.seams.forEach((seam) => {
      if (seam.t < 0 && this.isPlaced(seam.a) && this.isPlaced(seam.b)) {
        seam.t = 0;
        seam.mesh.visible = true;
        revealed += 1;
      }
    });
    if (revealed) this.audio.shimmer(0.25);
    this.title.mesh.visible = false;
    this.updateStatus();
    this.persist();
    if (count === this.shards.length) this.finish();
  }

  private finish() {
    this.complete = true;
    this.completeTime = 0;
    const spec = this.spec!;
    this.save.shelf.push({ seed: spec.seed, date: todayString(), seconds: Math.round(this.elapsed), daily: this.daily });
    if (this.save.shelf.length > 30) this.save.shelf.shift();
    delete this.save.current;
    this.persist();
    const streak = this.streak();
    this.doneCard.set([
      'Mended',
      `${spec.glaze.name} ${spec.shape} · ${formatTime(this.elapsed)}`,
      `*${this.save.shelf.length} on your shelf${streak > 1 ? ` · ${streak}-day streak` : ''}`,
    ]);
  }

  private streak(): number {
    const days = new Set(this.save.shelf.filter((s) => s.daily).map((s) => s.date));
    let n = 0;
    const d = new Date();
    for (;;) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!days.has(key)) break;
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  private onButton(action: string) {
    this.audio.ensure();
    this.audio.clink(1.4, 0.2);
    switch (action) {
      case 'recenter':
        this.recenter();
        break;
      case 'sound': {
        this.save.muted = !this.save.muted;
        this.audio.setMuted(!!this.save.muted);
        this.buttons.find((b) => b.action === 'sound')?.label.set([this.save.muted ? 'Sound: off' : 'Sound: on']);
        this.persist();
        break;
      }
      case 'next':
        if (this.complete) {
          const seed = this.firstSeed();
          this.startVessel(seed, seed === todaySeed());
        }
        break;
      case 'again':
        if (this.complete && this.spec) this.startVessel(this.spec.seed, false);
        break;
    }
  }

  /** Move the whole table to sit ~45 cm in front of and below the eyes. */
  recenter() {
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.v1);
    head.getWorldDirection(this.v2); // camera looks down -Z; getWorldDirection returns +Z of object
    this.v2.y = 0;
    if (this.v2.lengthSq() < 1e-6) this.v2.set(0, 0, 1);
    this.v2.normalize().negate(); // forward
    const yaw = Math.atan2(-this.v2.x, -this.v2.z);
    const target = new Vector3().copy(this.v1).addScaledVector(this.v2, 0.43);
    target.y = this.v1.y - 0.4;

    // Carry unplaced shards with the table.
    this.stage.updateMatrixWorld(true);
    const locals = this.shards.map((s) => {
      const lp = this.stage.worldToLocal(s.mesh.position.clone());
      const lq = this.stage.getWorldQuaternion(new Quaternion()).invert().multiply(s.mesh.quaternion);
      return { lp, lq };
    });
    this.stage.position.copy(target);
    this.stage.rotation.set(0, yaw, 0);
    this.stage.updateMatrixWorld(true);
    this.shards.forEach((s, i) => {
      if (s.placed) return;
      this.placeInWorld(s.mesh, locals[i].lp, locals[i].lq);
    });
  }

  private clearHint() {
    if (this.hintIndex >= 0) {
      const s = this.shards[this.hintIndex];
      s?.materials.forEach((m) => m.emissive.setRGB(0, 0, 0));
      if (s && this.grabbedIndex !== this.hintIndex) s.ghost.visible = false;
    }
    this.hintIndex = -1;
  }

  private updateStatus() {
    const placed = this.shards.filter((s) => s.placed).length;
    this.status.set([`${placed} of ${this.shards.length}  ·  ${formatTime(this.elapsed)}`]);
  }

  private rebuildShelf() {
    this.shelfRoot.clear();
    const items = this.save.shelf.slice(-5);
    items.forEach((item, k) => {
      const spec = specForSeed(item.seed);
      const v = buildVessel(spec);
      const g = new Group();
      const outer = new MeshStandardMaterial({ color: spec.glaze.outer, roughness: 0.32 });
      const inner = new MeshStandardMaterial({ color: spec.glaze.inner, roughness: 0.4 });
      const clay = new MeshStandardMaterial({ color: spec.glaze.clay, roughness: 0.95 });
      g.add(new Mesh(v.foot, clay));
      v.shards.forEach((s) => {
        const m = new Mesh(s.geometry, [outer, inner, clay]);
        m.position.copy(s.rest);
        g.add(m);
      });
      const gold = new MeshStandardMaterial({ color: 0xd9a632, metalness: 1, roughness: 0.22, emissive: 0x6b4500 });
      v.seams.forEach((s) => g.add(new Mesh(s.geometry, gold)));
      g.scale.setScalar(0.45);
      const x = -0.21 + (k * 0.42) / Math.max(1, 4);
      g.position.set(x, 0.0, -0.215);
      this.shelfRoot.add(g);
    });
  }

  // ---------- frame ----------
  update(delta: number, time: number): void {
    const xr = this.renderer.xr;
    if (xr.isPresenting) {
      this.xrFrames += 1;
      if (!this.anchoredInXR && this.xrFrames > 15) {
        this.anchoredInXR = true;
        this.recenter();
        this.audio.ensure();
      }
    } else if (this.anchoredInXR) {
      this.anchoredInXR = false;
      this.xrFrames = 0;
      this.persist();
    }

    if (this.started && !this.complete) {
      this.elapsed += delta;
      this.idle += delta;
      if (Math.floor(this.elapsed) !== Math.floor(this.elapsed - delta)) this.updateStatus();
    }

    // Proximity ghost while holding a shard.
    if (this.grabbedIndex >= 0) {
      const s = this.shards[this.grabbedIndex];
      if (s && !s.placed) {
        this.slotWorld(this.grabbedIndex, this.v1, this.q1);
        const d = s.mesh.position.distanceTo(this.v1);
        const ang = s.mesh.quaternion.angleTo(this.q1);
        const near = d < GHOST_DISTANCE;
        s.ghost.visible = near;
        if (near) {
          const k = 1 - d / GHOST_DISTANCE;
          const ready = d < SNAP_DISTANCE && ang < SNAP_ANGLE;
          const mat = s.ghost.material as MeshBasicMaterial;
          mat.opacity = ready ? 0.55 + 0.2 * Math.sin(time * 12) : 0.1 + 0.3 * k;
          mat.color.setHex(ready ? 0xfff0b8 : 0xffd36b);
        }
      }
    }

    // Snap / return animations.
    this.shards.forEach((s, i) => {
      if (s.snapAnim < 0) return;
      s.snapAnim = Math.min(1, s.snapAnim + delta / 0.22);
      const e = 1 - Math.pow(1 - s.snapAnim, 3);
      if ((s as any).returning) {
        this.stage.updateMatrixWorld(true);
        this.v1.copy(s.home).applyMatrix4(this.stage.matrixWorld);
        this.stage.getWorldQuaternion(this.q1).multiply(s.homeQuat);
      } else {
        this.slotWorld(i, this.v1, this.q1);
      }
      s.mesh.position.lerpVectors(s.snapFromPos, this.v1, e);
      this.q2.copy(s.snapFromQuat).slerp(this.q1, e);
      s.mesh.quaternion.copy(this.q2);
      if (s.snapAnim >= 1) {
        s.snapAnim = -1;
        if ((s as any).returning) {
          (s as any).returning = false;
        } else {
          s.ghost.visible = false;
          this.onSeated(i);
        }
      }
    });

    // Gold flowing into seams.
    this.seams.forEach((seam) => {
      if (seam.t < 0 || seam.t >= 1) return;
      seam.t = Math.min(1, seam.t + delta / 0.9);
      seam.material.opacity = Math.min(1, seam.t * 2);
      seam.material.emissiveIntensity = 0.35 + 2.2 * Math.sin(seam.t * Math.PI);
    });

    // Gentle hint after a quiet spell.
    if (!this.complete && this.grabbedIndex < 0 && this.idle > 18 && this.hintIndex < 0) {
      const open = this.shards.map((s, i) => (s.placed ? -1 : i)).filter((i) => i >= 0);
      if (open.length) {
        this.hintIndex = open[0];
        this.shards[this.hintIndex].ghost.visible = true;
      }
    }
    if (this.hintIndex >= 0) {
      const s = this.shards[this.hintIndex];
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      s.materials.forEach((m) => m.emissive.setRGB(0.35 * pulse, 0.25 * pulse, 0.05 * pulse));
      (s.ghost.material as MeshBasicMaterial).opacity = 0.12 + 0.25 * pulse;
      if (s.placed) this.clearHint();
    }

    // Finished vessel turns slowly, catching the light on its seams.
    if (this.complete) {
      const before = this.completeTime;
      this.completeTime += delta;
      if (before < 0.5 && this.completeTime >= 0.5) this.audio.complete();
      if (before < 1.6 && this.completeTime >= 1.6) {
        this.doneCard.mesh.visible = true;
        this.setDoneButtons(true);
        this.rebuildShelf();
      }
      this.vesselRoot.rotation.y += delta * 0.35;
      const lift = Math.min(1, this.completeTime / 1.5);
      this.vesselRoot.position.y = 0.03 * (1 - Math.pow(1 - lift, 3));
    } else {
      this.vesselRoot.position.y = 0;
    }

    // Labels face the player.
    const head = this.player.head;
    head.getWorldPosition(this.v1);
    for (const lbl of [this.title.mesh, this.doneCard.mesh]) {
      if (!lbl.visible) continue;
      this.m.position.copy(lbl.getWorldPosition(this.v2));
      this.m.lookAt(this.v1);
      lbl.parent!.getWorldQuaternion(this.q1).invert();
      lbl.quaternion.copy(this.q1.multiply(this.m.quaternion));
    }
  }
}
