import Phaser from 'phaser';

interface Options {
  minZoom: number;
  maxZoom: number;
  /** Pixels a pointer must move before it counts as a drag (not a tap). */
  dragThreshold?: number;
}

/**
 * Touch camera: 1-finger drag to pan, 2-finger pinch to zoom, mouse wheel on desktop.
 * Exposes `isDragging` so tap handlers can ignore the end of a pan gesture.
 */
export class CameraController {
  isDragging = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private dragStart = new Phaser.Math.Vector2();
  private camStart = new Phaser.Math.Vector2();

  constructor(
    private scene: Phaser.Scene,
    private opts: Options,
  ) {
    const input = scene.input;
    input.addPointer(1); // enable a 2nd touch pointer for pinch

    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('wheel', this.onWheel, this);
  }

  private get cam(): Phaser.Cameras.Scene2D.Camera {
    return this.scene.cameras.main;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (pointer1.isDown && pointer2.isDown) {
      this.pinchStartDist = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y);
      this.pinchStartZoom = this.cam.zoom;
      return;
    }
    this.isDragging = false;
    this.dragStart.set(pointer.x, pointer.y);
    this.camStart.set(this.cam.scrollX, this.cam.scrollY);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (pointer1.isDown && pointer2.isDown && this.pinchStartDist > 0) {
      const dist = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y);
      this.setZoom(this.pinchStartZoom * (dist / this.pinchStartDist));
      this.isDragging = true;
      return;
    }
    if (!pointer.isDown) return;
    const dx = pointer.x - this.dragStart.x;
    const dy = pointer.y - this.dragStart.y;
    if (!this.isDragging && Math.hypot(dx, dy) < (this.opts.dragThreshold ?? 8)) return;
    this.isDragging = true;
    this.cam.setScroll(this.camStart.x - dx / this.cam.zoom, this.camStart.y - dy / this.cam.zoom);
  }

  private onUp(): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (!pointer1.isDown || !pointer2.isDown) this.pinchStartDist = 0;
    // When one finger of a pinch remains, restart the pan from its current position.
    const remaining = pointer1.isDown ? pointer1 : pointer2.isDown ? pointer2 : null;
    if (remaining) {
      this.dragStart.set(remaining.x, remaining.y);
      this.camStart.set(this.cam.scrollX, this.cam.scrollY);
    }
  }

  private onWheel(_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void {
    this.setZoom(this.cam.zoom * (dy > 0 ? 0.9 : 1.1));
  }

  private setZoom(z: number): void {
    this.cam.setZoom(Phaser.Math.Clamp(z, this.opts.minZoom, this.opts.maxZoom));
  }
}
