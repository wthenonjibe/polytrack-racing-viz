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

    this.pml = null;
    this.mixinApplied = false;
    this.lastPoll = 0;
  }

  /* =========================
     REQUIRED LIFECYCLE HOOK
     ========================= */
  init = (pml) => {
    this.pml = pml;
    console.log("[RacingViz] init()");
  };

  postInit = () => {
    console.log("[RacingViz] postInit()");

    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) {
      console.error("[RacingViz] No game canvas found");
      return;
    }

    /* ===== Overlay canvas ===== */
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:9998;";
    gameCanvas.parentNode.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d");

    /* ===== Minimap canvas ===== */
    this.minimap = document.createElement("canvas");
    this.minimap.style.cssText =
      "position:fixed;bottom:10px;right:10px;width:220px;height:220px;" +
      "background:rgba(0,0,0,0.55);border:2px solid #00ffaa;border-radius:10px;" +
      "pointer-events:none;z-index:9999;";
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
    new ResizeObserver(resize).observe(gameCanvas);

    /* ===== Keybinds ===== */
    document.addEventListener("keydown", (e) => {
      if (e.code === "Digit7" || e.code === "Numpad7") {
        this.enabled = !this.enabled;
        console.log("[RacingViz]", this.enabled ? "ON" : "OFF");
      }
      if (e.code === "Digit9" || e.code === "Numpad9") {
        this.trail.length = 0;
        console.log("[RacingViz] Trail cleared");
      }
    });

    /* ===== Safe Car.update hook ===== */
    try {
      this.pml.registerClassMixin(
        "Car.prototype",
        "update",
        MixinType.INSERT,
        "this.position",
        (code) => `
          ${code}
          try {
            const mod = ActivePolyModLoader.getMod("racing-viz-minimap-mod");
            if (mod && game?.localPlayer?.car === this) {
              const vel = this.velocity || {x:0,y:0,z:0};
              const speed = Math.hypot(vel.x, vel.z);
              mod.trail.push({
                pos: {x:this.position.x, y:this.position.y-0.5, z:this.position.z},
                speed
              });
              if (mod.trail.length > mod.maxTrail) mod.trail.shift();
            }
          } catch {}
        `
      );
      this.mixinApplied = true;
      console.log("[RacingViz] Car.update hook applied");
    } catch (e) {
      console.warn("[RacingViz] Hook failed, using polling fallback");
    }

    this.loop();
  };

  /* =========================
     MAIN LOOP
     ========================= */
  loop = () => {
    requestAnimationFrame(this.loop);
    if (!this.enabled) return;

    const game = window.game;
    const car = game?.localPlayer?.car;
    const cam = game?.camera;
    if (!car || !cam) return;

    /* Fallback polling */
    if (!this.mixinApplied) {
      const now = performance.now();
      if (now - this.lastPoll > 33) {
        const vel = car.velocity || {x:0,y:0,z:0};
        const speed = Math.hypot(vel.x, vel.z);
        this.trail.push({
          pos: {x:car.position.x, y:car.position.y-0.5, z:car.position.z},
          speed
        });
        if (this.trail.length > this.maxTrail) this.trail.shift();
        this.lastPoll = now;
      }
    }

    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.minimapCtx.clearRect(0, 0, 220, 220);

    const pred = this.predict(car.position, car.velocity || {x:0,y:0,z:0});
    this.drawRacingLine(this.ctx, cam, pred);
    this.drawMinimap(this.minimapCtx, this.trail, pred, car);
  };

  /* =========================
     PREDICTION
     ========================= */
  predict(pos, vel) {
    const out = [{pos:{...pos}, speed:Math.hypot(vel.x,vel.z)}];
    let p = {...pos}, v = {...vel};
    const dt = 1/60;

    for (let i=0;i<this.predSteps;i++) {
      const s = Math.hypot(v.x,v.z) || 0.01;
      v.x += (v.x/s) * 3.5 * dt;
      v.z += (v.z/s) * 3.5 * dt;
      v.x *= 0.985; v.z *= 0.985;

      p.x += v.x * dt;
      p.z += v.z * dt;
      p.y = pos.y - 0.5;

      out.push({pos:{...p}, speed:Math.hypot(v.x,v.z)});
    }
    return out;
  }

  /* =========================
     DRAWING
     ========================= */
  drawRacingLine(ctx, cam, path) {
    for (let i=0;i<path.length-1;i++) {
      const a = this.worldToScreen(path[i].pos, cam);
      const b = this.worldToScreen(path[i+1].pos, cam);
      if (!a || !b) continue;

      const dv = path[i+1].speed - path[i].speed;
      const hue = dv > 0.3 ? 120 : dv > -0.3 ? 50 : 5;
      ctx.strokeStyle = `hsla(${hue},100%,50%,${1-i/path.length})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.stroke();
    }
  }

  drawMinimap(ctx, trail, pred, car) {
    const cx = 110, cy = 110, scale = 0.25;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0,0,220,220);

    ctx.strokeStyle = "#00ffaa";
    ctx.beginPath();
    trail.forEach((t,i)=>{
      const x = cx + t.pos.x*scale;
      const y = cy + t.pos.z*scale;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#ffaa00";
    ctx.beginPath();
    pred.forEach((p,i)=>{
      const x = cx + p.pos.x*scale;
      const y = cy + p.pos.z*scale;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();

    ctx.fillStyle="#fff";
    ctx.beginPath();
    ctx.arc(cx + car.position.x*scale, cy + car.position.z*scale, 4, 0, Math.PI*2);
    ctx.fill();
  }

  worldToScreen(pos, cam) {
    let dx = pos.x - cam.position.x;
    let dy = pos.y - cam.position.y;
    let dz = pos.z - cam.position.z;

    const yaw = cam.rotation?.yaw || 0;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    [dx,dz] = [dx*cy - dz*sy, dx*sy + dz*cy];

    if (dz < 0.1) return null;
    const f = 600/dz;
    return {
      x: dx*f + this.overlay.clientWidth/2,
      y: -dy*f + this.overlay.clientHeight/2,
      z: dz
    };
  }
}

export let polyMod = new RacingVizMod();
