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

    // fluffy cumulus layer: a big dome-ish plane with an fbm shader lit by the sun
    this.cloudU = { uTime: game.shared.uTime, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uCover: { value: 0.45 }, uNight: { value: 0 } };
    const cg = new THREE.PlaneGeometry(16000, 16000, 1, 1); cg.rotateX(Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: this.cloudU, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uCover; uniform float uNight; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
        void main(){
          vec2 p = vW.xz * 0.0011 + vec2(uTime * 0.004, uTime * 0.002);
          float d = fbm(p);
          float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, d);
          float edge = smoothstep(0.0, 0.25, c);
          // fake self-shadowing: sample towards the sun
          float s = fbm(p + normalize(uSun.xz + 1e-4) * 0.06);
          float lit = clamp(1.0 - (s - d) * 3.0, 0.35, 1.25);
          vec3 col = mix(uSky * 0.9, uSunCol * lit + uSky * 0.35, edge);
          float fade = 1.0 - smoothstep(3000.0, 7500.0, length(vW.xz - cameraPosition.xz));
          gl_FragColor = vec4(col * mix(1.0, 0.25, uNight), c * 0.92 * fade);
        }`,
    }));
    this.clouds.renderOrder = -0.5; this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    // twilight glow: purple overhead, orange-pink along the horizon on the sun's side, as the sun sets
    this.twiU = { uSun: { value: new THREE.Vector3() }, uK: { value: 0 } };
    this.twilight = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.twiU, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; uniform float uK; varying vec3 vD;
        void main(){
          float up = clamp(vD.y, 0.0, 1.0);
          float horizon = exp(-up * 5.0) * step(-0.05, vD.y);
          float side = pow(max(dot(normalize(vD.xz), normalize(uSun.xz + 1e-4)), 0.0), 2.0);
          vec3 c = mix(vec3(0.16, 0.06, 0.28), vec3(0.95, 0.35, 0.18), horizon * (0.35 + 0.65 * side)) * (0.25 + horizon);
          gl_FragColor = vec4(c * uK, 1.0);
        }`,
    }));
    this.twilight.renderOrder = -0.8; this.twilight.frustumCulled = false;
    scene.add(this.twilight);

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
    this.starMat.opacity = smoothstep(0.8, 1, this.night);
    this.moon.position.copy(center).addScaledVector(this.moonDir, 3500);
    this.moon.visible = this.moonDir.y > -0.05;
    this.clouds.position.set(center.x, center.y + 900, center.z);
    this.twilight.position.copy(center);
    this.twiU.uSun.value.copy(this.sunDir);
    this.twiU.uK.value = Math.exp(-Math.pow((sy + 0.04) / 0.1, 2)) * 1.4;
    this.twilight.visible = !this.underwater;
    this.cloudU.uSun.value.copy(this.sunDir);
    this.cloudU.uSunCol.value.setRGB(1.6, 1.5, 1.4).lerp(new THREE.Color(2.2, 1.0, 0.6), 1 - smoothstep(0.02, 0.3, sy)).lerp(new THREE.Color(0.9, 0.5, 0.9), Math.exp(-Math.pow((sy + 0.05) / 0.08, 2)) * 0.6);
    this.cloudU.uSky.value.setRGB(0.55, 0.65, 0.85).lerp(new THREE.Color(0.06, 0.07, 0.12), this.night);
    this.cloudU.uNight.value = this.night;
    this.cloudU.uCover.value = 0.4 + (g.weather ? g.weather.rain * 0.5 : 0);
    this.clouds.visible = !this.underwater;

    // key light: sun by day, moon by night (they swap while dark)
    const sunI = smoothstep(-0.04, 0.22, sy);
    const moonI = smoothstep(-0.04, -0.2, sy);
    const dir = sy > -0.04 ? this.sunDir : this.moonDir;
    const warm = 1 - smoothstep(0.02, 0.35, sy);
    if (sy > -0.04) this.light.color.setRGB(1.0, lerp(0.96, 0.62, warm), lerp(0.9, 0.38, warm));
    else this.light.color.setRGB(0.55, 0.65, 1.0);
    this.light.intensity = sunI * 3.4 + moonI * 0.4;
    g.shared.uSunIntensity.value = sunI + moonI * 0.15;
    // keep the shadow map centred on the player and snapped to texels to avoid shimmering
    const tex = (110 * 2) / (this.light.shadow.mapSize.x || 2048);
    const cx = Math.round(center.x / tex) * tex, cz = Math.round(center.z / tex) * tex;
    this.light.target.position.set(cx, 0, cz);
    this.light.position.set(cx, 0, cz).addScaledVector(dir, 400);

    // fog + ambient colours
    const day = new THREE.Color(0.66, 0.75, 0.85), sunset = new THREE.Color(0.95, 0.6, 0.42), nightC = new THREE.Color(0.018, 0.028, 0.055);
    const sunsetK = Math.exp(-Math.pow((sy - 0.03) / 0.12, 2));
    const dusk = new THREE.Color(0.42, 0.28, 0.55);
    const duskK = Math.exp(-Math.pow((sy + 0.06) / 0.08, 2));
    this.fogColor.copy(day).lerp(sunset, sunsetK * 0.75).lerp(dusk, duskK * 0.6).lerp(nightC, this.night * (1 - duskK * 0.5));
    this.skyTop.setRGB(0.25, 0.45, 0.8).lerp(new THREE.Color(0.01, 0.015, 0.04), this.night);
    this.hemi.color.setRGB(0.75, 0.85, 1.0).lerp(new THREE.Color(0.22, 0.28, 0.5), this.night);
    this.hemi.groundColor.setRGB(0.42, 0.36, 0.3).lerp(new THREE.Color(0.06, 0.05, 0.06), this.night);
    this.hemi.intensity = lerp(0.42, 0.3, this.night);

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
    g.renderer.toneMappingExposure = lerp(0.4, 0.72, this.night) * (under ? 1.15 : 1);

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
    const hdr = g.assets?.env;
    if (hdr && hdr.city) {
      // real captured skies for reflections: city by day, sunset around dusk/dawn, night after dark
      const want = sy > 0.18 ? hdr.city : sy > -0.08 ? (hdr.sunset || hdr.city) : (hdr.night || hdr.city);
      if (g.scene.environment !== want) g.scene.environment = want;
      this.envTimer = 1e9;
    }
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
