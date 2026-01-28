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
  }

  init = (pml) => {
    this.pml = pml;

    // expose mod instance for injected code
    window.__racingVizMod = this;

    pml.registerClassMixin(
      "Car.prototype",
      "update",
      MixinType.INSERT,
      "this.position",
      (code) => {
        return `${code}
          const mod = window.__racingVizMod;
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
  };

  postInit = () => {
    const gameCanvas = document.querySelector("canvas");
    if (!gameCanvas) return;

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

    console.log("Racing Viz initialized successfully");
  };

  /* rest of your code unchanged */
}

export let polyMod = new RacingVizMod();
