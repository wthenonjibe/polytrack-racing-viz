import { PolyMod, MixinType } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingVizMod extends PolyMod {
  constructor() {
    super();
    this.trail = [];
    this.maxTrail = 300;
    this.predSteps = 90;
    this.enabled = true;

    this.overlay = null;
    this.ctx = null;
    this.minimap = null;
    this.minimapCtx = null;

    this.pml = null;
    this.mixinApplied = false;
    this.lastPoll = 0;
  }

  /* ================= INIT ================= */
  init = (pml) => {
    this.pml = pml;
    console.log("[RacingViz] init()");
  };

  /* ================= POST INIT ================= */
  postInit = () => {
    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) return;

    /* Overlay */
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:9998;";
    gameCanvas.parentNode.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d");

    /* Minimap */
    this.minimap = document.createElement("canvas");
    this.minimap.style.cssText =
      "position:fixed;bottom:10px;right:10px;width:220px;height:220px;" +
      "background:rgba(0,0,0,0.6);border:2px solid #00ffaa;border-radius:10px;" +
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

    /* Keybinds */
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

    /* Car.update hook */
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
              const v = this.velocity || {x:0,y:0,z:0};
              const s = Math.hypot(v.x,v.z);
              mod.trail.push({
                pos:{x:this.position.x,y:this.position.y-0.5,z:this.position.z},
                speed:s
              });
              if (mod.trail.length > mod.maxTrail) mod.trail.shift();
            }
          } catch {}
        `
      );
      this.mixinApplied = true;
      console.log("[RacingViz] Car.update hooked");
    } catch {
      console.warn("[RacingViz] Hook failed, polling enabled");
    }

    this.loop();
  };

  /* ================= MAIN LOOP ================= */
  loop = () => {
    requestAnimationFrame(this.loop);
    if (!this.enabled) return;

    const game = window.game;
    const car = game?.localPlayer?.car;
    const cam = game?.camera;
    if (!car || !cam) return;

    if (!this.mixinApplied) {
      const now = performance.now();
      if (now - this.lastPoll > 33) {
        const v = car.velocity || {x:0,y:0,z:0};
        const s = Math.hypot(v.x,v.z);
        this.trail.push({
          pos:{x:car.position.x,y:car.position.y-0.5,z:car.position.z},
          speed:s
        });
        if (this.trail.length > this.maxTrail) this.trail.shift();
        this.lastPoll = now;
      }
    }

    this.ctx.clearRect(0,0,this.overlay.width,this.overlay.height);
    this.minimapCtx.clearRect(0,0,220,220);

    const pred = this.predict(car.position, car.velocity || {x:0,y:0,z:0});
    this.drawRacingLine(this.ctx, cam, pred);
    this.drawMinimap(this.minimapCtx, this.trail, pred, car);
  };

  /* ================= PREDICTION ================= */
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

  /* ================= DRAWING ================= */
  drawRacingLine(ctx, cam, path) {
    const spacing = 2;
    for (let i=0;i<path.length-spacing;i+=spacing) {
      const p1 = path[i], p2 = path[i+1];
      const a = this.worldToScreen(p1.pos, cam);
      const b = this.worldToScreen(p2.pos, cam);
      if (!a || !b) continue;

      const dx=b.x-a.x, dy=b.y-a.y;
      const ang=Math.atan2(dy,dx);
      const dv=p2.speed-p1.speed;

      let col="#00ff55";
      if (dv<-0.6) col="#ff3333";
      else if (dv<-0.15) col="#ffaa00";

      ctx.save();
      ctx.translate(a.x,a.y);
      ctx.rotate(ang);
      ctx.shadowColor=col;
      ctx.shadowBlur=10;
      ctx.fillStyle=col;
      ctx.fillRect(-20,-6,40,12);
      ctx.restore();
    }
  }

  drawMinimap(ctx, trail, pred, car) {
    const cx=110, cy=110, scale=0.25;
    ctx.fillStyle="rgba(0,0,0,0.7)";
    ctx.fillRect(0,0,220,220);

    ctx.strokeStyle="#00ffaa";
    ctx.beginPath();
    trail.forEach((t,i)=>{
      const x=cx+t.pos.x*scale;
      const y=cy+t.pos.z*scale;
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    });
    ctx.stroke();

    for(let i=0;i<pred.length-3;i+=3){
      const p1=pred[i], p2=pred[i+1];
      const dv=p2.speed-p1.speed;
      let col="#00ff55";
      if(dv<-0.6)col="#ff3333";
      else if(dv<-0.15)col="#ffaa00";
      ctx.strokeStyle=col;
      ctx.beginPath();
      ctx.moveTo(cx+p1.pos.x*scale, cy+p1.pos.z*scale);
      ctx.lineTo(cx+p2.pos.x*scale, cy+p2.pos.z*scale);
      ctx.stroke();
    }

    ctx.fillStyle="#fff";
    ctx.beginPath();
    ctx.arc(cx+car.position.x*scale, cy+car.position.z*scale, 4, 0, Math.PI*2);
    ctx.fill();
  }

  worldToScreen(pos, cam) {
    let dx=pos.x-cam.position.x;
    let dy=pos.y-cam.position.y;
    let dz=pos.z-cam.position.z;
    const yaw=cam.rotation?.yaw||0;
    const cy=Math.cos(-yaw), sy=Math.sin(-yaw);
    [dx,dz]=[dx*cy-dz*sy, dx*sy+dz*cy];
    if(dz<0.1) return null;
    const f=600/dz;
    return {
      x:dx*f+this.overlay.clientWidth/2,
      y:-dy*f+this.overlay.clientHeight/2,
      z:dz
    };
  }
}

export let polyMod = new RacingVizMod();
