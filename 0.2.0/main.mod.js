import { PolyMod, MixinType } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.enabled = true;
    this.trail = [];
    this.maxTrail = 240;
    this.predSteps = 70;
    this.overlay = null;
    this.ctx = null;
    this.minimap = null;
    this.minimapCtx = null;
    this.lastSample = 0;
    this.mixinApplied = false;
    this.gameReady = false;
  }

  init = (pml) => {
    this.pml = pml;
    console.log("[RacingVizMod] init() called");
  };

  postInit = () => {
    console.log("[RacingVizMod] postInit() - setting up canvases & mixin");

    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) {
      console.error("[RacingVizMod] No canvas found - cannot initialize");
      return;
    }

    // === MAIN OVERLAY (racing line on track) ===
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;background:transparent;";
    gameCanvas.parentNode.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d");
    if (!this.ctx) console.error("[RacingVizMod] Failed to get main 2D context");

    // === GPS-STYLE MINIMAP ===
    this.minimap = document.createElement("canvas");
    this.minimap.style.cssText =
      "position:fixed;bottom:12px;right:12px;width:220px;height:220px;" +
      "pointer-events:none;z-index:10000;background:rgba(0,40,0,0.9);" +
      "border:3px solid #0f8;border-radius:10px;box-shadow:0 0 10px #0f8;";
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext("2d");

    // Resize handler
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      this.overlay.width = gameCanvas.clientWidth * dpr;
      this.overlay.height = gameCanvas.clientHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.minimap.width = 220 * dpr;
      this.minimap.height = 220 * dpr;
      this.minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    new ResizeObserver(resize).observe(gameCanvas);

    // Keybinds
    document.addEventListener("keydown", (e) => {
      if (e.code === "Digit7" || e.code === "Numpad7") {
        this.enabled = !this.enabled;
        console.log("[RacingVizMod] Visualization", this.enabled ? "ENABLED" : "DISABLED");
      }
      if (e.code === "Digit9" || e.code === "Numpad9") {
        this.trail = [];
        console.log("[RacingVizMod] Trail cleared");
      }
    });

    // === SAFE MIXIN REGISTRATION (postInit = after game classes loaded) ===
    try {
      if (window.Car && window.Car.prototype && this.pml) {
        this.pml.registerClassMixin(
          "Car.prototype",
          "update",
          MixinType.INSERT,
          "this.position.x =",  // reliable token
          (code) => `${code}
            const mod = ActivePolyModLoader?.getMod?.("racing-viz-mod");
            if (mod && game?.localPlayer?.car === this) {
              const vel = this.velocity || {x:0,y:0,z:0};
              const speed = Math.hypot(vel.x, vel.z);
              mod.trail.push({
                pos: {x: this.position.x, y: this.position.y - 0.5, z: this.position.z},
                speed
              });
              if (mod.trail.length > mod.maxTrail) mod.trail.shift();
            }
          `
        );
        this.mixinApplied = true;
        console.log("[RacingVizMod] Mixin successfully registered on Car.update");
      } else {
        console.warn("[RacingVizMod] Car not defined yet - skipping mixin");
      }
    } catch (e) {
      console.warn("[RacingVizMod] Mixin failed:", e.message, "- using polling fallback");
    }

    // Wait until game is ready
    const waitInterval = setInterval(() => {
      if (window.game && window.game.localPlayer && window.game.localPlayer.car && window.game.camera) {
        this.gameReady = true;
        clearInterval(waitInterval);
        console.log("[RacingVizMod] Game globals ready - starting visualization loop");
        this.startLoop();
      }
    }, 100);
  };

  startLoop = () => {
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.enabled || !this.gameReady) return;

      try {
        const car = window.game.localPlayer.car;
        const cam = window.game.camera;
        if (!car?.position || !cam?.position) return;

        // Polling fallback if mixin didn't work
        const now = performance.now();
        if (!this.mixinApplied && now - this.lastSample > 33) {
          const vel = car.velocity || { x: 0, y: 0, z: 0 };
          const speed = Math.hypot(vel.x, vel.z);
          this.trail.push({
            pos: { x: car.position.x, y: car.position.y - 0.5, z: car.position.z },
            speed,
          });
          if (this.trail.length > this.maxTrail) this.trail.shift();
          this.lastSample = now;
        }

        // Clear canvases
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        this.minimapCtx.clearRect(0, 0, 220, 220);

        const pred = this.predict(car.position, car.velocity || { x: 0, y: 0, z: 0 });

        // Draw main racing line
        this.drawTrajectory(this.ctx, cam, this.trail);
        this.drawPrediction(this.ctx, cam, pred);

        // Draw GPS minimap
        this.drawMinimap(this.minimapCtx, this.trail, pred, car);
      } catch (e) {
        console.warn("[RacingVizMod] loop error:", e.message);
      }
    };
    loop();
  };

  predict(pos, vel) {
    const path = [];
    let p = { ...pos };
    let v = { ...vel };
    const dt = 1 / 60;
    const drag = 0.985;
    const accel = 3.8;
    for (let i = 0; i < this.predSteps; i++) {
      const s = Math.hypot(v.x, v.z) || 0.01;
      v.x += (v.x / s) * accel * dt;
      v.z += (v.z / s) * accel * dt;
      v.x *= drag;
      v.z *= drag;
      p = {
        x: p.x + v.x * dt,
        y: p.y,
        z: p.z + v.z * dt,
      };
      path.push({ pos: { ...p }, speed: Math.hypot(v.x, v.z) });
    }
    return path;
  }

  drawTrajectory(ctx, cam, trail) {
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i];
      const b = trail[i + 1];
      const s1 = this.worldToScreen(a.pos, cam);
      const s2 = this.worldToScreen(b.pos, cam);
      if (!s1 || !s2) continue;
      const alpha = i / trail.length;
      ctx.strokeStyle = `rgba(0,255,150,${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }
  }

  drawPrediction(ctx, cam, pred) {
    for (let i = 0; i < pred.length - 1; i++) {
      const a = pred[i];
      const b = pred[i + 1];
      const s1 = this.worldToScreen(a.pos, cam);
      const s2 = this.worldToScreen(b.pos, cam);
      if (!s1 || !s2) continue;
      const dv = b.speed - a.speed;
      const hue = dv > 0 ? 120 : dv > -0.5 ? 60 : 0;
      ctx.strokeStyle = `hsla(${hue},100%,50%,${1 - i / pred.length})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }
  }

  drawMinimap(ctx, trail, pred, car) {
    const w = 220, h = 220;
    const cx = w / 2, cy = h / 2;
    const scale = 0.25;

    // Debug background to prove minimap is visible
    ctx.fillStyle = "rgba(0,40,0,0.9)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#0f8";
    ctx.font = "16px Arial";
    ctx.fillText("GPS ACTIVE", 40, 110);

    // Trail
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    trail.forEach((t, i) => {
      const x = cx + t.pos.x * scale;
      const y = cy + t.pos.z * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      ctx.globalAlpha = i / trail.length;
      ctx.fillStyle = `rgba(0,255,136,${ctx.globalAlpha})`;
      ctx.fillRect(x-1.5, y-1.5, 3, 3);
    });
    ctx.globalAlpha = 1;
    ctx.stroke();

    // Prediction
    ctx.strokeStyle = "#ffaa00";
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    pred.forEach((p, i) => {
      if (i % 3 !== 0) return;
      const x = cx + p.pos.x * scale;
      const y = cy + p.pos.z * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Player position (big yellow arrow)
    if (car?.position) {
      const px = cx + car.position.x * scale;
      const py = cy + car.position.z * scale;
      ctx.save();
      ctx.translate(px, py);
      const heading = car.rotation?.yaw || car.heading || 0;
      ctx.rotate(heading + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-10, 14);
      ctx.lineTo(10, 14);
      ctx.closePath();
      ctx.fillStyle = "#ffff00";
      ctx.fill();
      ctx.restore();
    }
  }

  worldToScreen(pos, cam) {
    if (!cam?.position) return null;
    let dx = pos.x - cam.position.x;
    let dy = pos.y - cam.position.y;
    let dz = pos.z - cam.position.z;
    const yaw = cam.rotation?.yaw || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [dx, dz] = [dx * cy - dz * sy, dx * sy + dz * cy];
    if (dz <= 0.01) return null;
    const scale = 600 / dz;
    return {
      x: dx * scale + this.overlay.clientWidth / 2,
      y: -dy * scale + this.overlay.clientHeight / 2,
      z: dz,
    };
  }
}

export let polyMod = new RacingVizMod();
