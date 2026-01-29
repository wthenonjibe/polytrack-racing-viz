import { PolyMod, MixinType } from "https://cdn.polymodloader.com/PolyTrackMods/PolyModLoader/0.5.2/PolyModLoader.js";

class RacingViz3DMod extends PolyMod {
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
    this.mixinApplied = false;
    this.gameReady = false;
    this.lastRecordTime = 0;
  }

  postInit = () => {
    const gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) return console.error('[RacingViz3D] Canvas not found');

    // Main overlay
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:9998;background:transparent;';
    gameCanvas.parentNode.insertBefore(this.overlay, gameCanvas.nextSibling || gameCanvas);
    this.ctx = this.overlay.getContext('2d');

    // Minimap
    this.minimap = document.createElement('canvas');
    this.minimap.style.cssText = 'position:fixed;bottom:10px;right:10px;width:220px;height:220px;pointer-events:none;z-index:9999;background:rgba(0,0,0,0.5);border:2px solid #0f8;border-radius:10px;';
    document.body.appendChild(this.minimap);
    this.minimapCtx = this.minimap.getContext('2d');

    // Resize & DPR
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      this.overlay.width = gameCanvas.clientWidth * dpr;
      this.overlay.height = gameCanvas.clientHeight * dpr;
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale(dpr,dpr);

      this.minimap.width = 220*dpr;
      this.minimap.height = 220*dpr;
      this.minimapCtx.setTransform(1,0,0,1,0,0);
      this.minimapCtx.scale(dpr,dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(gameCanvas);

    // Keybinds
    document.addEventListener('keydown', e => {
      if (e.code === 'Digit7') {
        this.enabled = !this.enabled;
        console.log(`[RacingViz3D] Overlay ${this.enabled ? 'ON' : 'OFF'}`);
      }
      if (e.code === 'Digit9') {
        this.trail = [];
        console.log('[RacingViz3D] Trajectory cleared');
      }
    });

    // Register mixin
    try {
      if (window.Car && window.Car.prototype) {
        this.pml.registerClassMixin(
          "Car.prototype",
          "update",
          MixinType.INSERT,
          "this.position.x =",
          (code) => `${code}
            try {
              const mod = ActivePolyModLoader?.getMod?.("racing-viz-mod");
              if (mod && game?.localPlayer?.car === this) {
                const vel = this.velocity || {x:0,y:0,z:0};
                const speed = Math.hypot(vel.x, vel.z);
                mod.trail.push({
                  pos: {x:this.position.x, y:this.position.y, z:this.position.z},
                  speed
                });
                if (mod.trail.length > mod.maxTrail) mod.trail.shift();
              }
            } catch(e){}
          `
        );
        this.mixinApplied = true;
      }
    } catch(e){console.warn('[RacingViz3D] Mixin failed, using fallback');}

    // Wait for game ready
    const wait = setInterval(() => {
      if (window.game && window.game.localPlayer && window.game.camera && window.game.track) {
        clearInterval(wait);
        this.gameReady = true;
        this.startLoop();
        console.log('[RacingViz3D] Game ready, visualization active');
      }
    }, 100);
  };

  startLoop = () => {
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.enabled || !this.gameReady) return;

      const car = window.game.localPlayer.car;
      if (!car || !car.position) return;

      // Fallback if mixin didn't record
      const now = performance.now();
      if (!this.mixinApplied && now - this.lastRecordTime > 33) {
        const vel = car.velocity || {x:0,y:0,z:0};
        const speed = Math.hypot(vel.x, vel.z);
        this.trail.push({pos:{...car.position}, speed});
        if (this.trail.length>this.maxTrail) this.trail.shift();
        this.lastRecordTime = now;
      }

      const cam = window.game.camera;
      const pred = this.predictPath3D(car.position, car.velocity || {x:0,y:0,z:0}, window.game.track);

      this.ctx.clearRect(0,0,this.overlay.width,this.overlay.height);
      this.minimapCtx.clearRect(0,0,220,220);

      this.drawRacingLine3D(this.ctx, cam, pred);
      this.drawMinimap3D(this.minimapCtx, this.trail, pred, car, window.game.track);
    };
    loop();
  };

  predictPath3D(pos, vel, track) {
    const path = [{pos:{...pos}, speed: Math.hypot(vel.x, vel.z)}];
    let cpos = {...pos}, cvel = {...vel};
    const dt = 1/60, drag=0.985, accel=3.5, maxTurn=1.8, gravity=-9.81;

    for(let i=0;i<this.predSteps;i++){
      let speed = Math.hypot(cvel.x,cvel.z) || 0.01;
      let fwdX = cvel.x/speed, fwdZ = cvel.z/speed;

      // Basic acceleration & drag
      cvel.x += fwdX*accel*dt;
      cvel.z += fwdZ*accel*dt;
      cvel.x *= drag; cvel.z *= drag;

      // Simple steering oscillation
      const perpX=-fwdZ, perpZ=fwdX;
      const steer=Math.sin(i*0.12+performance.now()*0.00005)*maxTurn*dt*speed*0.015;
      cvel.x += perpX*steer; cvel.z += perpZ*steer;

      // Apply to position
      cpos.x += cvel.x*dt;
      cpos.z += cvel.z*dt;

      // Track-aligned Y
      cpos.y = track.getHeightAt?.(cpos.x, cpos.z) ?? pos.y;

      // Gravity fallback for jumps
      if(track.isAirborne?.(cpos)) cvel.y += gravity*dt;
      else cvel.y = 0;

      cpos.y += cvel.y*dt;

      path.push({pos:{...cpos}, speed: Math.hypot(cvel.x,cvel.z)});
    }
    return path;
  }

  drawRacingLine3D(ctx, cam, path){
    const n=path.length;
    ctx.lineCap='round'; ctx.lineJoin='round';
    let prevDir=null;
    for(let i=0;i<n-1;i++){
      const p1=path[i], p2=path[i+1];
      const dir={x:p2.pos.x-p1.pos.x,z:p2.pos.z-p1.pos.z};
      const len=Math.hypot(dir.x,dir.z)||0.01;
      const normDir={x:dir.x/len,z:dir.z/len};
      const speedAvg=(p1.speed+p2.speed)/2;
      let turnAngle=0;
      if(prevDir){
        const dot=prevDir.x*normDir.x+prevDir.z*normDir.z;
        turnAngle=Math.acos(Math.max(-1,Math.min(1,dot)));
      }
      prevDir=normDir;
      const sharpness=Math.min(1,(turnAngle*speedAvg)/(Math.PI*40));
      const hue=120-sharpness*120;
      const alpha=(1-i/n)*0.9;
      ctx.lineWidth=6+sharpness*4;
      ctx.strokeStyle=`hsla(${hue},100%,50%,${alpha})`;
      const s1=this.worldToScreen(p1.pos,cam);
      const s2=this.worldToScreen(p2.pos,cam);
      if(s1?.z>0 && s2?.z>0){
        ctx.beginPath();
        ctx.moveTo(s1.x,s1.y);
        ctx.lineTo(s2.x,s2.y);
        ctx.stroke();
      }
    }
  }

  drawMinimap3D(ctx, trail, pred, car, track){
    const w=220,h=220;
    const cx=w/2,cy=h/2;
    const scale=0.25;

    ctx.fillStyle='rgba(10,30,10,0.7)';
    ctx.fillRect(0,0,w,h);

    // Trail
    ctx.strokeStyle='#00ff88';
    ctx.lineWidth=2;
    ctx.beginPath();
    for(let i=0;i<trail.length;i++){
      const p=trail[i].pos;
      const x=cx+p.x*scale;
      const y=cy+p.z*scale;
      const alpha=i/trail.length;
      ctx.globalAlpha=alpha*0.9;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
      ctx.fillRect(x-1.5,y-1.5,3,3);
    }
    ctx.stroke(); ctx.globalAlpha=1;

    // Prediction
    ctx.strokeStyle='#ffaa00';
    ctx.lineWidth=1.8;
    ctx.globalAlpha=0.7;
    ctx.beginPath();
    for(let i=0;i<pred.length;i+=4){
      const p=pred[i].pos;
      const x=cx+p.x*scale;
      const y=cy+p.z*scale;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.stroke(); ctx.globalAlpha=1;

    // Car arrow
    if(car?.rotation){
      const heading=car.rotation.yaw||car.heading||0;
      const px=cx+car.position.x*scale;
      const py=cy+car.position.z*scale;
      ctx.save();
      ctx.translate(px,py);
      ctx.rotate(heading+Math.PI/2);
      ctx.beginPath();
      ctx.moveTo(0,-10); ctx.lineTo(-8,12); ctx.lineTo(8,12); ctx.closePath();
      ctx.fillStyle='#ffff00';
      ctx.fill();
      ctx.restore();
    }
  }

  worldToScreen(pos,cam){
    let dx=pos.x-(cam.position?.x||0), dy=pos.y-(cam.position?.y||0), dz=pos.z-(cam.position?.z||0);
    const yaw=cam.rotation?.yaw||cam.heading||cam.yaw||0;
    const cy=Math.cos(-yaw),sy=Math.sin(-yaw);
    [dx,dz]=[dx*cy-dz*sy, dx*sy+dz*cy];
    const pitch=cam.rotation?.pitch||cam.pitch||0;
    const cp=Math.cos(-pitch),sp=Math.sin(-pitch);
    [dy,dz]=[dy*cp-dz*sp, dy*sp+dz*cp];
    if(dz<0.01) return null;
    const fov=600/dz;
    return {x:dx*fov+this.overlay.clientWidth/2, y:-dy*fov+this.overlay.clientHeight/2, z:dz};
  }
}

export let polyMod = new RacingViz3DMod();
