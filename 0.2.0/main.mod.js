import { PolyMod, MixinType } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.trail = [];
    this.maxTrail = 300;
    this.predSteps = 80;
    this.enabled = true;
    this.overlay = null;
    this.ctx = null;
    this.minimap = null;
    this.minimapCtx = null;
  }

  init = (pml) => {
    this.pml = pml;
    pml.registerClassMixin(
      "Car.prototype",
      "update",
      MixinType.INSERT,
      "this.position.x =",
      (code) => `${code}
        const mod = ActivePolyModLoader.getMod("racing-viz-mod");
        if (mod && game?.localPlayer?.car === this) {
          const vel = this.velocity || {x:0,y:0,z:0};
          const speed = Math.hypot(vel.x, vel.z);
          mod.trail.push({pos: {x: this.position.x, y: this.position.y - 0.5, z: this.position.z}, speed});
          if (mod.trail.length > mod.maxTrail) mod.trail.shift();
        }
      `
    );
  };

  postInit = () => {
    const gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) return console.error('RacingViz: Canvas missing');
    // Main track overlay (racing line only)
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:9998;';
    gameCanvas.parentNode.insertBefore(this.overlay, gameCanvas);
    this.ctx = this.overlay.getContext('2d');
    // Minimap (trajectory only)
    this.minimap = document.createElement('canvas');
    this.minimap.style.cssText = 'position:fixed;bottom:10px;right:10px;width:200px;height:200px;pointer-events:none;z-index:9999;background:rgba(0,0,0,0.4);border:2px solid #444;border-radius:8px;';
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext('2d');
    // Resize
    const resize = () => {
      const dpr = window.devicePixelRatio;
      this.overlay.width = gameCanvas.clientWidth * dpr;
      this.overlay.height = gameCanvas.clientHeight * dpr;
      this.ctx.scale(dpr, dpr);
      this.minimap.width = 200 * dpr;
      this.minimap.height = 200 * dpr;
      this.minimapCtx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    new ResizeObserver(gameCanvas, resize);
    // Keys
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.enabled = !this.enabled, console.log(`Viz ${this.enabled ? 'ON' : 'OFF'}`);
      if (e.code === 'KeyR') this.trail = [], console.log('Cleared');
    });
    // Loop
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!this.enabled) return;
      this.ctx.clearRect(0, 0, gameCanvas.clientWidth, gameCanvas.clientHeight);
      this.minimapCtx.clearRect(0, 0, 200, 200);
      const car = game?.localPlayer?.car;
      if (!car?.position || !this.trail.length) return;
      const cam = game?.camera;
      if (!cam?.position) return;
      // Predict
      const vel = car.velocity || {x:0,y:0,z:0};
      const pred = this.predictPath(car.position, vel);
      // Main: dynamic racing line on track
      this.drawRacingLine(this.ctx, cam, pred);
      // Minimap: trajectory viz
      this.drawTrajectoryMinimap(this.minimapCtx, this.trail);
      this.drawPredMinimap(this.minimapCtx, pred);
    };
    loop();
    console.log('Minimap Trajectory + Track Racing Line - T/R');
  };

  predictPath(pos, vel) {
    const path = [{pos: {...pos}, speed: Math.hypot(vel.x, vel.z)}];
    let cpos = {...pos}, cvel = {...vel};
    const dt = 1/60, drag = 0.985, accel = 3.5, maxTurn = 1.8;
    for (let i = 0; i < this.predSteps; i++) {
      const speed = Math.hypot(cvel.x, cvel.z) || 0.01;
      const fwdX = cvel.x / speed, fwdZ = cvel.z / speed;
      cvel.x += fwdX * accel * dt;
      cvel.z += fwdZ * accel * dt;
      cvel.x *= drag; cvel.z *= drag;
      const perpX = -fwdZ, perpZ = fwdX;
      const steer = Math.sin(i * 0.12 + performance.now() * 0.00005) * maxTurn * dt * speed * 0.015;
      cvel.x += perpX * steer; cvel.z += perpZ * steer;
      cpos.x += cvel.x * dt;
      cpos.y = pos.y - 0.5; // Snap to track
      cpos.z += cvel.z * dt;
      path.push({pos: cpos, speed: Math.hypot(cvel.x, cvel.z)});
    }
    return path;
  }

  drawRacingLine(ctx, cam, pred) {
    const n = pred.length;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let prevDir = null;
    for (let i = 0; i < n - 1; i++) {
      const p1 = pred[i], p2 = pred[i+1];
      const dir = {x: p2.pos.x - p1.pos.x, z: p2.pos.z - p1.pos.z};
      const len = Math.hypot(dir.x, dir.z) || 0.01;
      const normDir = {x: dir.x/len, z: dir.z/len};
      const speedAvg = (p1.speed + p2.speed)/2;
      let turnAngle = 0;
      if (prevDir) {
        const dot = prevDir.x * normDir.x + prevDir.z * normDir.z;
        turnAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
      }
      prevDir = normDir;
      const sharpness = Math.min(1, (turnAngle * speedAvg) / (Math.PI * 40)); // Tune max ~40
      const hue = 120 - sharpness * 120; // Green 120 → Red 0
      const alpha = (1 - i/n) * 0.9;
      ctx.lineWidth = 6 + sharpness * 4;
      ctx.strokeStyle = `hsla(${hue}, 100%, 50%, ${alpha})`;
      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);
      if (s1?.z > 0 && s2?.z > 0) {
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        // Arrows every 8 segs
        if (i % 8 === 0 && i > 5) {
          const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x);
          const alen = 12, aang = Math.PI/5;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(s2.x, s2.y);
          ctx.lineTo(s2.x - alen*Math.cos(ang - aang), s2.y - alen*Math.sin(ang - aang));
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s2.x - alen*Math.cos(ang + aang), s2.y - alen*Math.sin(ang + aang));
          ctx.closePath();
          ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${alpha})`;
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  drawTrajectoryMinimap(ctx, trail) {
    const w = 200, h = 200;
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const x = (p.pos.x % 1024 / 1024) * w;
      const y = (p.pos.z % 1024 / 1024) * h;
      const alpha = i / trail.length;
      ctx.globalAlpha = alpha * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      // Dots
      ctx.fillStyle = `rgba(0,255,136,${alpha})`;
      ctx.fillRect(x-1, y-1, 2, 2);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  drawPredMinimap(ctx, pred) {
    const w = 200, h = 200;
    ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < pred.length; i += 3) {
      const p = pred[i];
      const x = (p.pos.x % 1024 / 1024) * w;
      const y = (p.pos.z % 1024 / 1024) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - (cam.position?.x || 0);
    let dy = pos.y - (cam.position?.y || 0);
    let dz = pos.z - (cam.position?.z || 0);
    const yaw = cam.rotation?.yaw || cam.heading || cam.yaw || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [dx, dz] = [dx * cy - dz * sy, dx * sy + dz * cy];
    const pitch = cam.rotation?.pitch || cam.pitch || 0;
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    [dy, dz] = [dy * cp - dz * sp, dy * sp + dz * cp];
    if (dz < 0.01) return null;
    const fov = 600 / dz;
    return {
      x: dx * fov + this.overlay.clientWidth / 2,
      y: -dy * fov + this.overlay.clientHeight / 2,
      z: dz
    };
  }
}

export let polyMod = new RacingVizMod();
