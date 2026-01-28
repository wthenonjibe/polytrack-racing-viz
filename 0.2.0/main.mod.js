import { PolyMod, MixinType } from "https://cdn.jsdelivr.net/gh/PolyModLoader/PolyTrackMods/PolyModLoader@0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.trail = [];
    this.maxTrail = 300;
    this.predSteps = 80;
    this.enabled = true;
    this.overlay = null;
    this.ctx = null;
    this.resize = null;
    this.loop = null;
  }

  init = (pml) => {
    this.pml = pml;

    const waitForCar = () => {
      if (typeof Car === "undefined") return setTimeout(waitForCar, 50);

      pml.registerClassMixin(
        "Car.prototype",
        "update",
        MixinType.INSERT,
        "this.position",
        (code) => {
          return `${code}
            const mod = ActivePolyModLoader.getMod("racing-viz-mod");
            if (!mod) return;

            if (game.localPlayer && game.localPlayer.car === this) {
              const vel = this.velocity || {x:0,y:0,z:0};
              const speed = Math.hypot(vel.x, vel.z);
              mod.trail.push({
                pos: {x: this.position.x, y: this.position.y, z: this.position.z},
                speed
              });
              if (mod.trail.length > mod.maxTrail) mod.trail.shift();
            }
          `;
        }
      );

      console.log("Registered mixin: Car.prototype.update");
    };

    waitForCar();
  };

  postInit = () => {
    const waitCanvas = () => {
      const gameCanvas = document.querySelector("canvas");
      if (!gameCanvas) return setTimeout(waitCanvas, 100);

      this.overlay = document.createElement("canvas");
      this.overlay.style.cssText =
        "position:absolute;top:0;left:0;pointer-events:none;z-index:9999;background:transparent;";
      gameCanvas.parentNode.insertBefore(this.overlay, gameCanvas.nextSibling);
      this.ctx = this.overlay.getContext("2d");

      this.resize = () => {
        this.overlay.width = gameCanvas.clientWidth * window.devicePixelRatio;
        this.overlay.height = gameCanvas.clientHeight * window.devicePixelRatio;
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      };
      this.resize();
      new ResizeObserver(this.resize).observe(gameCanvas);

      document.addEventListener("keydown", (e) => {
        if (e.code === "KeyT") this.enabled = !this.enabled;
        if (e.code === "KeyR") this.trail = [];
      });

      this.loop = () => {
        if (!this.enabled) return requestAnimationFrame(this.loop);
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        const car = game?.localPlayer?.car;
        const cam = game?.camera;
        if (!car?.position || !cam?.position || !this.trail.length)
          return requestAnimationFrame(this.loop);

        this.drawTrajectory(this.ctx, cam, this.trail);
        const currVel = car.velocity || { x: 0, y: 0, z: 0 };
        const predTrail = this.predictPath(car.position, currVel);
        this.drawPrediction(this.ctx, cam, predTrail);
        requestAnimationFrame(this.loop);
      };
      this.loop();

      console.log("Racing Viz initialized (T = toggle, R = clear)");
    };

    waitCanvas();
  };

  predictPath(pos, vel) {
    const path = [{ pos: { ...pos }, speed: Math.hypot(vel.x, vel.z) }];
    let cpos = { ...pos };
    let cvel = { ...vel };
    const dt = 1 / 60;
    const drag = 0.985;
    const accel = 4.2;
    const turn = 1.2;

    for (let i = 0; i < this.predSteps; i++) {
      const speed = Math.hypot(cvel.x, cvel.z) || 0.01;
      const fwdX = cvel.x / speed;
      const fwdZ = cvel.z / speed;

      cvel.x += fwdX * accel * dt;
      cvel.z += fwdZ * accel * dt;
      cvel.x *= drag;
      cvel.z *= drag;

      const perpX = -fwdZ;
      const perpZ = fwdX;
      const steer =
        Math.sin(i * 0.15 + Date.now() * 0.0001) * turn * dt * speed * 0.02;

      cvel.x += perpX * steer;
      cvel.z += perpZ * steer;

      cpos.x += cvel.x * dt;
      cpos.y += cvel.y * dt;
      cpos.z += cvel.z * dt;

      path.push({
        pos: { ...cpos },
        speed: Math.hypot(cvel.x, cvel.z)
      });
    }
    return path;
  }

  drawTrajectory(ctx, cam, trail) {
    const n = trail.length;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";

    for (let i = 0; i < n - 1; i++) {
      const p1 = trail[i];
      const p2 = trail[i + 1];
      const alpha = (i / n) * 0.85;
      const normSpeed = Math.min(1, (p1.speed + p2.speed) / 2 / 85);
      const hue = 220 - normSpeed * 60;

      ctx.strokeStyle = `hsla(${hue},85%,65%,${alpha})`;
      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);
      if (s1?.z > 0.1 && s2?.z > 0.1) {
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
      }
    }
  }

  drawPrediction(ctx, cam, pred) {
    const n = pred.length;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";

    for (let i = 0; i < n - 1; i++) {
      const p1 = pred[i];
      const p2 = pred[i + 1];
      const deltaV = p2.speed - p1.speed;
      const hue = deltaV > 0.8 ? 130 : deltaV > -0.8 ? 50 : 5;
      const alpha = (1 - i / n) * 0.95;

      ctx.strokeStyle = `hsla(${hue},100%,55%,${alpha})`;
      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);
      if (s1?.z > 0.1 && s2?.z > 0.1) {
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
      }
    }
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - cam.position.x;
    let dy = pos.y - cam.position.y;
    let dz = pos.z - cam.position.z;

    const yaw = cam.rotation?.yaw || cam.heading || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [dx, dz] = [dx * cy - dz * sy, dx * sy + dz * cy];

    const pitch = cam.rotation?.pitch || cam.pitch || 0;
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    [dy, dz] = [dy * cp - dz * sp, dy * sp + dz * cp];

    if (dz < 0.1) return null;

    const fovScale = 550;
    return {
      x: dx / dz * this.overlay.clientWidth / 2 + this.overlay.clientWidth / 2,
      y: -(dy / dz) * this.overlay.clientHeight / 2 + this.overlay.clientHeight / 2,
      z: dz
    };
  }
}

export let polyMod = new RacingVizMod();
