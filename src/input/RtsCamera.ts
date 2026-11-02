import * as THREE from 'three';

const LONG_PRESS_MS = 350;
const MOUSE_DRAG_PX = 5;
const A_TAP_MS = 220;
const EDGE_PX = 8;
/** Keyboard pan speed: ground units per second per unit of camera distance. */
const PAN_SPEED_PER_DISTANCE = 0.9;

export interface RtsCameraOptions {
  minDistance: number;
  maxDistance: number;
  initialDistance: number;
  pitchDeg: number;
  yawDeg: number;
  fovDeg: number;
}

/**
 * Clash-of-Clans-style camera: fixed pitch and yaw, looking at a ground target.
 * 1 finger drag = pan, 2 finger pinch = zoom, mouse wheel = zoom, short tap = onTap.
 */
export class RtsCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  distance: number;
  /** Short tap / left click (`shift`: Maj held, `mouse`: pointer is a mouse). */
  onTap?: (ndc: THREE.Vector2, shift: boolean, mouse: boolean) => void;
  /** Right click without dragging (desktop order). */
  onOrder?: (ndc: THREE.Vector2) => void;
  /** Mouse hover (no button pressed), client px. */
  onHover?: (x: number, y: number) => void;
  /** Key that is not a camera key (shortcuts); Ctrl+A etc. Return value ignored. */
  onKey?: (key: string, e: KeyboardEvent) => void;
  /** Long press (one finger, still): the next drag draws a rectangle instead of panning. Screen (client) px. */
  onBoxStart?: (x: number, y: number) => void;
  onBoxMove?: (x0: number, y0: number, x1: number, y1: number) => void;
  onBoxEnd?: (x0: number, y0: number, x1: number, y1: number, additive: boolean) => void;

  private pointers = new Map<number, { x: number; y: number }>();
  private startPinchDist = 0;
  private startPinchDistance = 0;
  private downPos = new THREE.Vector2();
  private dragged = false;
  private longPressTimer = 0;
  private boxMode = false;
  private boxStart = new THREE.Vector2();
  private boxShift = false;
  // Mouse state (desktop).
  private mouseBtn = -1;
  private mouseMoved = false;
  private mouseShift = false;
  private mouseLast = new THREE.Vector2();
  private mouseX = 0;
  private mouseY = 0;
  private mouseIn = false;
  private keys = new Set<string>();
  private aDownAt = 0;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: RtsCameraOptions,
  ) {
    this.camera = new THREE.PerspectiveCamera(opts.fovDeg, 1, 0.5, 400);
    this.distance = opts.initialDistance;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    document.documentElement.addEventListener('mouseleave', () => (this.mouseIn = false));
    document.documentElement.addEventListener('mouseenter', () => (this.mouseIn = true));
    this.apply();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Ground-plane radius worth of terrain to keep loaded. */
  get viewRadius(): number {
    return this.distance * 1.15 + 6;
  }

  setZoomDistance(d: number): void {
    this.distance = THREE.MathUtils.clamp(d, this.opts.minDistance, this.opts.maxDistance);
    this.apply();
  }

  lookAt(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.apply();
  }

  /** Converts a screen point (NDC) to a world point on the ground plane. */
  groundPoint(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  raycast(ndc: THREE.Vector2, objects: THREE.Object3D[]): THREE.Intersection[] {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  private apply(): void {
    const pitch = THREE.MathUtils.degToRad(this.opts.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(this.opts.yawDeg);
    const horiz = Math.cos(pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * horiz,
      this.target.y + Math.sin(pitch) * this.distance,
      this.target.z + Math.cos(yaw) * horiz,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private toNdc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') {
      this.onMouseDown(e);
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragged = false;
      this.downPos.set(e.clientX, e.clientY);
      this.cancelLongPress();
      if (this.onBoxStart) {
        this.longPressTimer = window.setTimeout(() => {
          this.longPressTimer = 0;
          if (this.pointers.size !== 1 || this.dragged) return;
          this.boxMode = true;
          this.dragged = true;
          this.boxStart.copy(this.downPos);
          navigator.vibrate?.(15);
          this.onBoxStart?.(this.downPos.x, this.downPos.y);
        }, LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      this.cancelLongPress();
      this.endBox(null);
      this.startPinchDist = this.pinchDistance();
      this.startPinchDistance = this.distance;
      this.dragged = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.onMouseMove(e);
      return;
    }
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    if (this.boxMode) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.onBoxMove?.(this.boxStart.x, this.boxStart.y, e.clientX, e.clientY);
      return;
    }
    if (this.pointers.size >= 2) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = this.pinchDistance();
      if (this.startPinchDist > 0) this.setZoomDistance(this.startPinchDistance * (this.startPinchDist / d));
      return;
    }
    if (!this.dragged && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) < 8) return;
    this.dragged = true;
    this.cancelLongPress();
    // Pan so the ground point under the finger stays under the finger.
    const a = this.groundPoint(this.toNdc(prev.x, prev.y));
    const b = this.groundPoint(this.toNdc(e.clientX, e.clientY));
    if (a && b) {
      this.target.add(a.sub(b));
      this.apply();
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.onMouseUp(e);
      return;
    }
    const wasSingle = this.pointers.size === 1;
    this.cancelLongPress();
    if (this.boxMode) this.endBox(e.type === 'pointerup' ? { x: e.clientX, y: e.clientY } : null);
    this.pointers.delete(e.pointerId);
    if (wasSingle && !this.dragged && e.type === 'pointerup') this.onTap?.(this.toNdc(e.clientX, e.clientY), false, false);
    if (this.pointers.size < 2) this.startPinchDist = 0;
  };

  private cancelLongPress(): void {
    if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = 0;
  }

  /** Leaves rectangle mode; `end` = release point (null = cancelled). */
  private endBox(end: { x: number; y: number } | null): void {
    if (!this.boxMode) return;
    this.boxMode = false;
    const { x, y } = this.boxStart;
    // Cancelled: collapse the rectangle onto its start so listeners can clean up.
    this.onBoxEnd?.(x, y, end ? end.x : x, end ? end.y : y, this.boxShift);
    this.boxShift = false;
  }

  /** Zoom centered on the cursor: the ground point under the cursor stays under it. */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const ndc = this.toNdc(e.clientX, e.clientY);
    const before = this.groundPoint(ndc);
    this.setZoomDistance(this.distance * Math.exp(THREE.MathUtils.clamp(e.deltaY, -100, 100) * 0.0012));
    const after = this.groundPoint(ndc);
    if (before && after) {
      this.target.add(before.sub(after));
      this.apply();
    }
  };

  // ---------- mouse ----------

  private onMouseDown(e: PointerEvent): void {
    if (this.mouseBtn !== -1) return;
    this.mouseBtn = e.button;
    this.mouseMoved = false;
    this.mouseShift = e.shiftKey;
    this.downPos.set(e.clientX, e.clientY);
    this.mouseLast.set(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.button === 1) e.preventDefault();
  }

  private onMouseMove(e: PointerEvent): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseIn = true;
    if (this.mouseBtn === -1) {
      this.onHover?.(e.clientX, e.clientY);
      return;
    }
    if (!this.mouseMoved && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) < MOUSE_DRAG_PX) return;
    this.mouseMoved = true;
    if (this.mouseBtn === 0) {
      if (!this.boxMode) {
        this.boxMode = true;
        this.boxShift = this.mouseShift;
        this.boxStart.copy(this.downPos);
        this.onBoxStart?.(this.downPos.x, this.downPos.y);
      }
      this.onBoxMove?.(this.boxStart.x, this.boxStart.y, e.clientX, e.clientY);
    } else {
      // Middle / right button held: pan, the ground point under the cursor follows the cursor.
      this.canvas.style.cursor = 'grabbing';
      const a = this.groundPoint(this.toNdc(this.mouseLast.x, this.mouseLast.y));
      const b = this.groundPoint(this.toNdc(e.clientX, e.clientY));
      if (a && b) {
        this.target.add(a.sub(b));
        this.apply();
      }
    }
    this.mouseLast.set(e.clientX, e.clientY);
  }

  private onMouseUp(e: PointerEvent): void {
    const btn = this.mouseBtn;
    this.mouseBtn = -1;
    this.pointers.delete(e.pointerId);
    const ok = e.type === 'pointerup';
    if (this.boxMode) this.endBox(ok ? { x: e.clientX, y: e.clientY } : null);
    else if (ok && !this.mouseMoved) {
      const ndc = this.toNdc(e.clientX, e.clientY);
      if (btn === 0) this.onTap?.(ndc, this.mouseShift, true);
      else if (btn === 2) this.onOrder?.(ndc);
    }
    if (btn === 1 || btn === 2) this.canvas.style.cursor = '';
    this.onHover?.(e.clientX, e.clientY);
  }

  // ---------- keyboard + edge scrolling ----------

  private static readonly PAN_KEYS: Record<string, [number, number]> = {
    arrowup: [0, 1], z: [0, 1], w: [0, 1],
    arrowdown: [0, -1], s: [0, -1],
    arrowleft: [-1, 0], q: [-1, 0], a: [-1, 0],
    arrowright: [1, 0], d: [1, 0],
  };

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e)) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.onKey?.(key, e);
      return;
    }
    if (key in RtsCamera.PAN_KEYS) {
      if (key.startsWith('arrow')) e.preventDefault();
      if (key === 'a' && !this.keys.has('a')) this.aDownAt = performance.now();
      this.keys.add(key);
      return;
    }
    if (!e.repeat) this.onKey?.(key, e);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (!this.keys.delete(key)) return;
    // "A" is both pan-left (WASD) and the Armée shortcut: a short tap is the shortcut.
    if (key === 'a' && performance.now() - this.aDownAt < A_TAP_MS) this.onKey?.('a', e);
  };

  /** Per frame: smooth keyboard panning and full-screen edge scrolling. */
  update(dtSec: number): void {
    let right = 0;
    let up = 0;
    for (const k of this.keys) {
      const v = RtsCamera.PAN_KEYS[k];
      if (v) (right += v[0], (up += v[1]));
    }
    if (document.fullscreenElement && this.mouseIn && this.mouseBtn === -1) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (this.mouseX <= EDGE_PX) right -= 1;
      else if (this.mouseX >= w - 1 - EDGE_PX) right += 1;
      if (this.mouseY <= EDGE_PX) up += 1;
      else if (this.mouseY >= h - 1 - EDGE_PX) up -= 1;
    }
    if (right === 0 && up === 0) return;
    const len = Math.hypot(right, up);
    const yaw = THREE.MathUtils.degToRad(this.opts.yawDeg);
    const speed = this.distance * PAN_SPEED_PER_DISTANCE * Math.min(dtSec, 0.1);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    this.target.x += ((fx * up + -fz * right) / len) * speed;
    this.target.z += ((fz * up + fx * right) / len) * speed;
    this.apply();
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}
