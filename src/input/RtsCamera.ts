import * as THREE from 'three';

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
  onTap?: (ndc: THREE.Vector2) => void;

  private pointers = new Map<number, { x: number; y: number }>();
  private startPinchDist = 0;
  private startPinchDistance = 0;
  private downPos = new THREE.Vector2();
  private dragged = false;
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
  }

  private toNdc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragged = false;
      this.downPos.set(e.clientX, e.clientY);
    } else if (this.pointers.size === 2) {
      this.startPinchDist = this.pinchDistance();
      this.startPinchDistance = this.distance;
      this.dragged = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    if (this.pointers.size >= 2) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = this.pinchDistance();
      if (this.startPinchDist > 0) this.setZoomDistance(this.startPinchDistance * (this.startPinchDist / d));
      return;
    }
    if (!this.dragged && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) < 8) return;
    this.dragged = true;
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
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (wasSingle && !this.dragged && e.type === 'pointerup') this.onTap?.(this.toNdc(e.clientX, e.clientY));
    if (this.pointers.size < 2) this.startPinchDist = 0;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setZoomDistance(this.distance * (e.deltaY > 0 ? 1.1 : 0.9));
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}
