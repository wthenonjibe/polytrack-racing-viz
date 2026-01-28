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
    this.resize = null;
    this.loop = null;
    this.minimap = null;
    this.minimapCtx = null;
  }

  init = (pml) => {
    this.pml = pml;

    // Track car positions
    pml.registerClassMixin(
      "Car.prototype",
      "update",
      MixinType.INSERT,
      "this.position",
      (code) => {
        return `${code}
          const mod = ActivePolyModLoader.getMod("racing-viz-minimap-mod");
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
  };

  postInit = () => {
    const gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) return;

    // Main overlay
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:9998;background:transparent;';
    gameCanvas.parentNode.insertBefore(this.overlay, gameCanvas.nextSibling);
    this.ctx = this.overlay.getContext('2d');

    // Minimap overlay
    this.minimap = document.createElement('canvas');
    this.minimap.style.cssText = 'position:absolute;bottom:10px;right:10px;width:200px;height:200px;pointer-events:none;z-index:9999;background:rgba(0,0,0,0.3);border:2px solid #fff;border-radius:8px;';
    gameCanvas.parentNode.insertBefore(this.minimap, gameCanvas.nextSibling);
    this.minimapCtx = this.minimap.getContext('2d');

    // Resize observer
    this.resize = () => {
      this.overlay.width = gameCanvas.clientWidth * window.devicePixelRatio;
      this.overlay.height = gameCanvas.clientHeight * window.devicePixelRatio;
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    this.resize();
    new ResizeObserver(this.resize).observe(gameCanvas);

    // Keybinds
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit7') {
        this.enabled = !this.enabled;
        console.log(`Racing Viz ${this.enabled ? 'ON' : 'OFF'}`);
      }
      if (e.code === 'Digit9') {
        this.trail = [];
        console.log('Trajectory cleared');
      }
    });

    // Draw loop
    this.loop = () => {
      if (!this.enabled) return requestAnimationFrame(this.loop);
      this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.minimapCtx.clearRect(0,0,this.minimap.width,this.minimap.height);

      const car = game?.localPlayer?.car;
      if (!car?.position || !this.trail.length) return requestAnimationFrame(this.loop);

      const cam = game?.camera;
      if (!cam?.position) return requestAnimationFrame(this.loop);

      // Draw main trajectory
      this.drawTrajectory(this.ctx, cam, this.trail);

      // Draw predicted racing line
      const currVel = car.velocity || {x:0, y:0, z:0};
      const predTrail = this.predictPath(car.position, currVel);
      this.drawPrediction(this.ctx, cam, predTrail);

      // Draw minimap
      this.drawMinimap(this.minimapCtx, this.trail);

      requestAnimationFrame(this.loop);
    };
    this.loop();

    console.log('Racing Viz + Minimap loaded - 7 toggle, 9 clear');
  };

  predictPath(pos, vel) {
    const path = [{pos: {...pos}, speed: Math.hypot(vel.x, vel.z)}];
    let cpos = {...pos};
    let cvel = {...vel};
    const dt = 1/60;
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
      const steer = Math.sin(i * 0.15 + Date.now() * 0.0001) * turn * dt * speed * 0.02;
      cvel.x += perpX * steer;
      cvel.z += perpZ * steer;
      cpos.x += cvel.x * dt;
      cpos.y += cvel.y * dt;
      cpos.z += cvel.z * dt;
      path.push({pos: {...cpos}, speed: Math.hypot(cvel.x, cvel.z)});
    }
    return path;
  }

  drawTrajectory(ctx, cam, trail) {
    const n = trail.length;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < n-1; i++) {
      const p1 = trail[i], p2 = trail[i+1];
      const alpha = (i/n)*0.85;
      const normSpeed = Math.min(1, (p1.speed+p2.speed)/2/85);
      const hue = 220 - normSpeed*60;
      ctx.strokeStyle = `hsla(${hue},85%,65%,${alpha})`;
      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);
      if (s1?.z>0.1 && s2?.z>0.1) {
        ctx.beginPath();
        ctx.moveTo(s1.x,s1.y);
        ctx.lineTo(s2.x,s2.y);
        ctx.stroke();
      }
    }
  }

  drawPrediction(ctx, cam, pred) {
    const n = pred.length;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i<n-1; i++){
      const p1 = pred[i], p2 = pred[i+1];
      const deltaV = p2.speed - p1.speed;
      const hue = deltaV>0.8?130:deltaV>-0.8?50:5;
      const alpha = (1-i/n)*0.95;
      ctx.strokeStyle = `hsla(${hue},100%,55%,${alpha})`;
      const s1 = this.worldToScreen(p1.pos, cam);
      const s2 = this.worldToScreen(p2.pos, cam);
      if (s1?.z>0.1 && s2?.z>0.1){
        ctx.beginPath();
        ctx.moveTo(s1.x,s1.y);
        ctx.lineTo(s2.x,s2.y);
        ctx.stroke();
      }
    }
  }

  drawMinimap(ctx, trail){
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(0,0,w,h);

    const len = trail.length;
    for(let i=0;i<len;i++){
      const p = trail[i].pos;
      const x = (p.x % 500)/500 * w;
      const y = (p.z % 500)/500 * h;
      ctx.fillStyle = `rgba(50,200,50,0.7)`;
      ctx.fillRect(x,y,2,2);
    }
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - cam.position.x;
    let dy = pos.y - cam.position.y;
    let dz = pos.z - cam.position.z;

    const yaw = cam.rotation?.yaw || cam.heading || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    const rx = dx * cy - dz * sy;
    const rz = dx * sy + dz * cy;
    dx = rx; dz = rz;

    const pitch = cam.rotation?.pitch || cam.pitch || 0;
    const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
    const ry = dy * cp - dz * sp;
    dz = dy * sp + dz * cp;
    dy = ry;

    if (dz < 0.1) return null;

    const fovScale = 550;
    const w = this.overlay.clientWidth / 2;
    const h = this.overlay.clientHeight / 2;
    return {
      x: dx / dz * fovScale + w,
      y: -(dy / dz * fovScale) + h,
      z: dz
    };
  }
}

export let polyMod = new RacingVizMod();
