import { PolyMod, MixinType } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.id = "racing-viz-mod";
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
    console.log("[RacingVizMod] init() - waiting for postInit to apply mixin");
  };

  postInit = () => {
    console.log("[RacingVizMod] postInit() started");

    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) {
      console.error("[RacingVizMod] canvas not found");
      return;
    }

    // === MAIN OVERLAY (racing line) ===
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:9999;";
    gameCanvas.parentNode.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d");
    if (!this.ctx) {
      console.error("[RacingVizMod] failed to get main 2D context");
      return;
    }

    // === MINIMAP (GPS style) ===
    this.minimap = document.createElement("canvas");
    this.minimap.style.cssText =
      "position:fixed;bottom:12px;right:12px;width:220px;height:220px;" +
      "pointer-events:none;z-index:10000;background:rgba(0,0,0,0.55);" +
      "border:2px solid #0f8;border-radius:10px;";
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext("2d");
    if (!this.minimapCtx) {
      console.error("[RacingVizMod] failed to get minimap 2D context");
      return;
    }

    // Resize + DPR support
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

    // Keybinds (7 toggle, 9 clear)
    document.addEventListener("keydown", (e) => {
      if (e.code === "Digit7" || e.code === "Numpad7") {
        this.enabled = !this.enabled;
        console.log("[RacingVizMod] toggled:", this.enabled);
      }
      if (e.code === "Digit9" || e.code === "Numpad9") {
        this.trail = [];
        console.log("[RacingVizMod] trail cleared");
      }
    });

    // === SAFE MIXIN REGISTRATION (in postInit) ===
    try {
      if (window.Car && window.Car.prototype && this.pml) {
        this.pml.registerClassMixin(
          "Car.prototype",
          "update",
          MixinType.INSERT,
          "this.position.x =",  // common position update token
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
        console.log("[RacingVizMod] Mixin registered successfully on Car.update");
      } else {
        console.warn("[RacingVizMod] Car or pml not available yet - mixin skipped");
      }
    } catch (e) {
      console.warn("[RacingVizMod] Mixin registration failed:", e.message, "- using polling fallback");
    }

    // Wait for game globals before starting loop
    const waitGame = setInterval(() => {
      if (window.game && window.game.localPlayer && window.game.camera) {
        this.gameReady = true;
        clearInterval(waitGame);
        console.log("[RacingVizMod] Game ready - visualization loop starting");
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

        // Polling fallback if mixin didn't apply
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

        // Draw everything
        const pred = this.predict(car.position, car.velocity || { x: 0, y: 0, z: 0 });
        this.drawTrajectory(this.ctx, cam, this.trail);
        this.drawPrediction(this.ctx, cam, pred);
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

    // Background
    ctx.fillStyle = "rgba(10,25,10,0.8)";
    ctx.fillRect(0, 0, w, h);

    // Trail (past path)
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

    // Prediction (future path)
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

    // Player position arrow (rotates with heading)
    if (car?.rotation) {
      const heading = car.rotation.yaw || car.heading || 0;
      const px = cx + car.position.x * scale;
      const py = cy + car.position.z * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(heading + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-8, 12);
      ctx.lineTo(8, 12);
      ctx.closePath();
      ctx.fillStyle = "#ffff00";
      ctx.fill();
      ctx.restore();
    }

    // Checkpoints & finish (if game exposes them)
    if (window.game?.track?.checkpoints?.length) {
      const cps = window.game.track.checkpoints;
      cps.forEach((cp, idx) => {
        const cxPos = cx + (cp.x || cp.position?.x || 0) * scale;
        const cyPos = cy + (cp.z || cp.position?.z || 0) * scale;
        ctx.beginPath();
        ctx.arc(cxPos, cyPos, 10, 0, Math.PI * 2);
        ctx.fillStyle = idx === cps.length - 1 ? "#ff4444" : "#00aaff";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(idx + 1, cxPos, cyPos);
      });
    }

    // Finish flag
    if (window.game?.track?.finish) {
      const fx = cx + (window.game.track.finish.x || 0) * scale;
      const fy = cy + (window.game.track.finish.z || 0) * scale;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(fx - 8, fy - 16, 16, 32);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(fx - 8, fy - 16, 16, 16);
      ctx.fillStyle = "#000";
      ctx.font = "bold 14px Arial";
      ctx.fillText("FIN", fx, fy - 8);
    }
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - (cam.position?.x || 0);
    let dy = pos.y - (cam.position?.y || 0);
    let dz = pos.z - (cam.position?.z || 0);
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
