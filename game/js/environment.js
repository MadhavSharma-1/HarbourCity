import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smoothstep, lerp } from './util.js';

/** Day/night cycle: sun, moon, sky, stars, fog, hemisphere light, reflections. */
export class Environment {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.hours = 17.2;                    // start in the late afternoon
    this.daySeconds = 14 * 60;             // a full day takes 14 real minutes
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    this.sky.renderOrder = -1;
    this.sky.material.depthWrite = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.25; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    // separate sky used only to render the reflection environment
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000);
    
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(game.renderer);
    this.envTimer = 0; this.envTarget = null;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const sc = this.light.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 900;
    this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.6;
    scene.add(this.light, this.light.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 0.6);
    scene.add(this.hemi);

    // stars
    const n = 3500, sp = new Float32Array(n * 3), sc2 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.05; v.normalize().multiplyScalar(3800);
      sp.set([v.x, v.y, v.z], i * 3);
      const b = 0.5 + Math.random() * 1.6, warm = Math.random();
      sc2.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1.05 - warm * 0.2)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc2, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = 0;
    scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0), fog: false }));
    scene.add(this.moon);

    this.fog = new THREE.FogExp2(0x9fb4c8, 0.00045);
    this.waterFog = new THREE.FogExp2(0x0b4a5a, 0.035);
    scene.fog = this.fog;
    this.fogColor = new THREE.Color();
    this.skyTop = new THREE.Color();
    this.night = 0;
    this.underwater = false;
  }

  timeString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, center, fast) {
    this.hours = (this.hours + (dt * 24 / this.daySeconds) * (fast ? 40 : 1)) % 24;
    const th = ((this.hours - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(th) * 0.9, Math.sin(th), 0.42).normalize();
    this.moonDir.set(-Math.cos(th) * 0.8, -Math.sin(th) * 0.9 + 0.15, 0.35).normalize();
    const sy = this.sunDir.y;
    this.night = 1 - smoothstep(-0.14, 0.06, sy);
    const g = this.game;
    g.shared.uNight.value = this.night;

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.rayleigh.value = lerp(1.25, 0.4, this.night);
    this.sky.position.copy(center);
    this.stars.position.copy(center);
    this.starMat.opacity = smoothstep(0.55, 1, this.night);
    this.moon.position.copy(center).addScaledVector(this.moonDir, 3500);
    this.moon.visible = this.moonDir.y > -0.05;

    // key light: sun by day, moon by night (they swap while dark)
    const sunI = smoothstep(-0.04, 0.22, sy);
    const moonI = smoothstep(-0.04, -0.2, sy);
    const dir = sy > -0.04 ? this.sunDir : this.moonDir;
    const warm = 1 - smoothstep(0.02, 0.35, sy);
    if (sy > -0.04) this.light.color.setRGB(1.0, lerp(0.96, 0.62, warm), lerp(0.9, 0.38, warm));
    else this.light.color.setRGB(0.55, 0.65, 1.0);
    this.light.intensity = sunI * 2.6 + moonI * 0.4;
    g.shared.uSunIntensity.value = sunI + moonI * 0.15;
    // keep the shadow map centred on the player and snapped to texels to avoid shimmering
    const tex = (110 * 2) / (this.light.shadow.mapSize.x || 2048);
    const cx = Math.round(center.x / tex) * tex, cz = Math.round(center.z / tex) * tex;
    this.light.target.position.set(cx, 0, cz);
    this.light.position.set(cx, 0, cz).addScaledVector(dir, 400);

    // fog + ambient colours
    const day = new THREE.Color(0.66, 0.75, 0.85), sunset = new THREE.Color(0.95, 0.6, 0.42), nightC = new THREE.Color(0.018, 0.028, 0.055);
    const sunsetK = Math.exp(-Math.pow((sy - 0.03) / 0.12, 2));
    this.fogColor.copy(day).lerp(sunset, sunsetK * 0.75).lerp(nightC, this.night);
    this.skyTop.setRGB(0.25, 0.45, 0.8).lerp(new THREE.Color(0.01, 0.015, 0.04), this.night);
    this.hemi.color.setRGB(0.75, 0.85, 1.0).lerp(new THREE.Color(0.22, 0.28, 0.5), this.night);
    this.hemi.groundColor.setRGB(0.42, 0.36, 0.3).lerp(new THREE.Color(0.06, 0.05, 0.06), this.night);
    this.hemi.intensity = lerp(0.75, 0.32, this.night);

    // underwater switches fog/background
    const cam = g.camera;
    const under = cam.position.y < g.waterSurfaceAt(cam.position.x, cam.position.z) && g.isOverWater(cam.position.x, cam.position.z);
    this.underwater = under;
    if (under) {
      const depth = Math.max(0, -1.2 - cam.position.y);
      const k = Math.exp(-depth / 28) * (0.25 + 0.75 * (1 - this.night));
      this.waterFog.color.setRGB(0.03 * k + 0.004, 0.25 * k + 0.012, 0.3 * k + 0.02);
      this.waterFog.density = 0.028 + depth * 0.0006;
      g.scene.fog = this.waterFog;
      g.scene.background = this.waterFog.color;
      this.sky.visible = false; this.stars.visible = false; this.moon.visible = false;
    } else {
      g.scene.fog = this.fog;
      this.fog.color.copy(this.fogColor);
      this.fog.density = lerp(0.00042, 0.0007, this.night);
      g.scene.background = null;
      this.sky.visible = true; this.stars.visible = true;
    }
    g.renderer.toneMappingExposure = lerp(0.46, 0.72, this.night) * (under ? 1.15 : 1);

    // ocean shader uniforms
    if (g.ocean) {
      const ou = g.ocean.uniforms;
      ou.uSunDir.value.copy(dir);
      ou.uSunColor.value.copy(this.light.color).multiplyScalar(sunI + moonI * 0.2);
      ou.uSkyColor.value.copy(this.skyTop);
      ou.uHorizon.value.copy(this.fogColor);
      ou.uNight.value = this.night;
    }

    // re-render reflection probe from the sky every few seconds
    this.envTimer -= dt * (fast ? 20 : 1);
    if (this.envTimer <= 0) {
      this.envTimer = 4;
      const eu = this.envSky.material.uniforms;
      eu.sunPosition.value.copy(this.sunDir);
      eu.rayleigh.value = u.rayleigh.value; eu.turbidity.value = u.turbidity.value;
      eu.mieCoefficient.value = u.mieCoefficient.value; eu.mieDirectionalG.value = u.mieDirectionalG.value;
      const prevExposure = g.renderer.toneMappingExposure;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      g.renderer.toneMappingExposure = prevExposure;
      if (this.envTarget) this.envTarget.dispose();
      this.envTarget = rt;
      g.scene.environment = rt.texture;
      g.scene.environmentIntensity = lerp(1.0, 0.25, this.night);
    }
  }
}
