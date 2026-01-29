import { PolyMod } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.trail = [];                    // array of {pos: {x,y,z}, speed}
    this.maxTrail = 300;                // ~5 seconds at 60 fps
    this.predSteps = 80;                // prediction length
    this.enabled = true;
    this.overlay = null;
    this.ctx = null;
    this.minimap = null;
    this.minimapCtx = null;
    this.lastRecordTime = 0;
    this.gameReady = false;
  }

  postInit = () => {
    const gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) {
      console.error('[RacingVizMod] No game canvas found - cannot initialize overlays');
      return;
    }

    // Main overlay for racing line on track
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:9998;background:transparent;';
    gameCanvas.parentNode.insertBefore(this.overlay, gameCanvas.nextSibling || gameCanvas);
    this.ctx = this.overlay.getContext('2d');
    if (!this.ctx) {
      console.error('[RacingVizMod] Failed to get 2D context on main overlay');
      return;
    }

    // Minimap for trajectory history
    this.minimap = document.createElement('canvas');
    this.minimap.style.cssText = 'position:fixed;bottom:10px;right:10px;width:200px;height:200px;pointer-events:none;z-index:9999;background:rgba(0,0,0,0.4);border:2px solid #444;border-radius:8px;';
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext('2d');
    if (!this.minimapCtx) {
      console.error('[RacingVizMod] Failed to get 2D context on minimap');
      return;
    }

    // Handle resize + device pixel ratio
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      this.overlay.width = gameCanvas.clientWidth * dpr;
      this.overlay.height = gameCanvas.clientHeight * dpr;
      this.ctx.scale(dpr, dpr);

      this.minimap.width = 200 * dpr;
      this.minimap.height = 200 * dpr;
      this.minimapCtx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(gameCanvas);

    // Keybinds
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') {
        this.enabled = !this.enabled;
        console.log(`[RacingVizMod] Visualization ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
      }
      if (e.code === 'KeyR') {
        this.trail = [];
        console.log('[RacingVizMod] Trail history cleared');
      }
    });

    // Wait until window.game is fully available
    const waitInterval = setInterval(() => {
      if (window.game && window.game.localPlayer && window.game.camera) {
        this.gameReady = true;
        clearInterval(waitInterval);
        console.log('[RacingVizMod] Game ready – visualization loop started');
        this.startVisualizationLoop();
      }
    }, 100);
  };

  startVisualizationLoop = () => {
    const loop = () => {
      requestAnimationFrame(loop);

      if (!this.enabled || !this.gameReady) return;

      try {
        // Clear canvases
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        this.minimapCtx.clearRect(0, 0, 200, 200);

        const car = window.game?.localPlayer?.car;
        if (!car || !car.position) return;

        // Record current position ~30 times per second
        const now = performance.now();
        if (now - this.lastRecordTime > 33) {
          const vel = car.velocity || {x:0, y:0, z:0};
          const speed = Math.hypot(vel.x, vel.z);
          this.trail.push({
            pos: {x: car.position.x, y: (car.position.y || 0) - 0.5, z: car.position.z},
            speed
          });
          if (this.trail.length > this.maxTrail) this.trail.shift();
          this.lastRecordTime = now;
        }

        const cam = window.game?.camera;
        if (!cam || !cam.position) return;

        const predictedPath = this.predictPath(car.position, car.velocity || {x:0,y:0,z:0});

        // Draw racing line on main view (on track)
        this.drawRacingLine(this.ctx, cam, predictedPath);

        // Draw trajectory history + prediction on minimap
        this.drawTrajectoryMinimap(this.minimapCtx, this.trail);
        this.drawPredMinimap(this.minimapCtx, predictedPath);
      } catch (err) {
        console.warn('[RacingVizMod] Error in visualization loop:', err);
      }
    };

    loop();
    console.log('[RacingVizMod] Visualization fully active – T = toggle, R = clear trail');
  };

  predictPath(startPos, startVel) {
    const path = [{pos: {...startPos}, speed: Math.hypot(startVel.x, startVel.z)}];
    let pos = {...startPos};
    let vel = {...startVel};

    const dt = 1 / 60;
    const drag = 0.985;
    const accel = 3.5;
    const maxTurn = 1.8;

    for (let i = 0; i < this.predSteps; i++) {
      const speed = Math.hypot(vel.x, vel.z) || 0.01;
      const fwdX = vel.x / speed;
      const fwdZ = vel.z / speed;

      vel.x += fwdX * accel * dt;
      vel.z += fwdZ * accel * dt;
      vel.x *= drag;
      vel.z *= drag;

      const perpX = -fwdZ;
      const perpZ = fwdX;
      const steer = Math.sin(i * 0.12 + performance.now() * 0.00005) * maxTurn * dt * speed * 0.015;
      vel.x += perpX * steer;
      vel.z += perpZ * steer;

      pos.x += vel.x * dt;
      pos.y = startPos.y - 0.5; // snap to track surface
      pos.z += vel.z * dt;

      path.push({pos: {...pos}, speed: Math.hypot(vel.x, vel.z)});
    }
    return path;
  }

  drawRacingLine(ctx, cam, path) {
    const n = path.length;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let prevDir = null;

    for (let i = 0; i < n - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const dir = {x: p2.pos.x - p1.pos.x, z: p2.pos.z - p1.pos.z};
      const len = Math.hypot(dir.x, dir.z) || 0.01;
      const normDir = {x: dir.x / len, z: dir.z / len};
      const speedAvg = (p1.speed + p2.speed) / 2;

      let turnAngle = 0;
      if (prevDir) {
        const dot = prevDir.x * normDir.x + prevDir.z * normDir.z;
        turnAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
      }
      prevDir = normDir;

      const sharpness = Math.min(1, (turnAngle * speedAvg) / (Math.PI * 40));
      const hue = 120 - sharpness * 120; // green 120 → yellow 60 → red 0
      const alpha = (1 - i / n) * 0.9;

      ctx.lineWidth = 6 + sharpness * 4;
      ctx.strokeStyle = `hsla(${hue}, 100%, 50%, ${alpha})`;

      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);

      if (s1?.z > 0 && s2?.z > 0) {
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();

        // Arrow every 8 segments
        if (i % 8 === 0 && i > 5) {
          const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x);
          const alen = 12;
          const aang = Math.PI / 5;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(s2.x, s2.y);
          ctx.lineTo(s2.x - alen * Math.cos(ang - aang), s2.y - alen * Math.sin(ang - aang));
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s2.x - alen * Math.cos(ang + aang), s2.y - alen * Math.sin(ang + aang));
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
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();

    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const x = (p.pos.x % 1024 / 1024) * w;
      const y = (p.pos.z % 1024 / 1024) * h;
      const alpha = i / trail.length;
      ctx.globalAlpha = alpha * 0.8;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      ctx.fillStyle = `rgba(0,255,136,${alpha})`;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawPredMinimap(ctx, pred) {
    const w = 200, h = 200;
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();

    for (let i = 0; i < pred.length; i += 3) {
      const p = pred[i];
      const x = (p.pos.x % 1024 / 1024) * w;
      const y = (p.pos.z % 1024 / 1024) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
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
