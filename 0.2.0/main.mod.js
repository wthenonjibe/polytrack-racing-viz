import { PolyMod } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();

    this.enabled = true;
    this.trail = [];
    this.maxTrail = 200;
    this.predSteps = 60;

    this.overlay = null;
    this.ctx = null;

    this.minimap = null;
    this.minimapCtx = null;

    this.lastSample = 0;
  }

  postInit = () => {
    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) return;

    /* ===== OVERLAY ===== */
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:9999;";
    gameCanvas.parentNode.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d");

    /* ===== MINIMAP ===== */
    this.minimap = document.createElement("canvas");
    this.minimap.style.cssText =
      "position:fixed;bottom:12px;right:12px;width:220px;height:220px;" +
      "background:rgba(0,0,0,0.6);border:2px solid #0f8;border-radius:10px;" +
      "pointer-events:none;z-index:10000;";
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext("2d");

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

    /* ===== KEYBINDS ===== */
    document.addEventListener("keydown", (e) => {
      if (e.code === "Digit7") this.enabled = !this.enabled;
      if (e.code === "Digit9") this.trail = [];
    });

    this.loop();
  };

  loop = () => {
    requestAnimationFrame(this.loop);

    if (!this.enabled) return;
    if (!window.game?.localPlayer?.car || !window.game?.camera) return;

    const car = window.game.localPlayer.car;
    const cam = window.game.camera;

    /* ===== SAMPLE ===== */
    const now = performance.now();
    if (now - this.lastSample > 33) {
      const vel = car.velocity || { x: 0, z: 0 };
      this.trail.push({
        pos: { ...car.position },
        speed: Math.hypot(vel.x, vel.z),
      });
      if (this.trail.length > this.maxTrail) this.trail.shift();
      this.lastSample = now;
    }

    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.minimapCtx.clearRect(0, 0, 220, 220);

    const prediction = this.predict(car.position, car.velocity || { x: 0, z: 0 });

    this.drawTrajectory(this.ctx, cam, this.trail);
    this.drawPrediction(this.ctx, cam, prediction);
    this.drawMinimap(this.minimapCtx, car, this.trail, prediction);
  };

  predict(pos, vel) {
    const path = [];
    let p = { ...pos };
    let v = { ...vel };
    const dt = 1 / 60;

    for (let i = 0; i < this.predSteps; i++) {
      p = {
        x: p.x + v.x * dt,
        y: p.y,
        z: p.z + v.z * dt,
      };
      path.push({ pos: { ...p } });
    }
    return path;
  }

  drawTrajectory(ctx, cam, trail) {
    for (let i = 0; i < trail.length - 1; i++) {
      const a = this.worldToScreen(trail[i].pos, cam);
      const b = this.worldToScreen(trail[i + 1].pos, cam);
      if (!a || !b) continue;

      ctx.strokeStyle = `rgba(0,255,150,${i / trail.length})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  drawPrediction(ctx, cam, pred) {
    for (let i = 0; i < pred.length - 1; i++) {
      const a = this.worldToScreen(pred[i].pos, cam);
      const b = this.worldToScreen(pred[i + 1].pos, cam);
      if (!a || !b) continue;

      ctx.strokeStyle = `rgba(255,200,0,${1 - i / pred.length})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  drawMinimap(ctx, car, trail, pred) {
    const w = 220, h = 220;
    const cx = w / 2, cy = h / 2;
    const scale = 0.4;

    ctx.fillStyle = "rgba(10,30,10,0.8)";
    ctx.fillRect(0, 0, w, h);

    /* ===== TRAIL (RELATIVE TO CAR) ===== */
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    trail.forEach((t, i) => {
      const dx = (t.pos.x - car.position.x) * scale;
      const dz = (t.pos.z - car.position.z) * scale;
      const x = cx + dx;
      const y = cy + dz;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* ===== PREDICTION ===== */
    ctx.strokeStyle = "#ffaa00";
    ctx.beginPath();
    pred.forEach((p, i) => {
      const dx = (p.pos.x - car.position.x) * scale;
      const dz = (p.pos.z - car.position.z) * scale;
      const x = cx + dx;
      const y = cy + dz;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* ===== CAR DOT ===== */
    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - cam.position.x;
    let dy = pos.y - cam.position.y;
    let dz = pos.z - cam.position.z;

    const yaw = cam.rotation?.yaw || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [dx, dz] = [dx * cy - dz * sy, dx * sy + dz * cy];

    if (dz <= 0.1) return null;

    const scale = 600 / dz;
    return {
      x: dx * scale + this.overlay.clientWidth / 2,
      y: -dy * scale + this.overlay.clientHeight / 2,
    };
  }
}

export let polyMod = new RacingVizMod();
