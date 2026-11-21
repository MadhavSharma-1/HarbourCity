import * as THREE from 'three';

/** Lightweight GPU point-sprite particle pool (smoke, fire, bubbles, sparks, splashes). */
export class Particles {
  constructor(scene, max, { additive = false, soft = 1 } = {}) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.col = new Float32Array(max * 4); this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aSize', this.aSize);
    this.geo.setAttribute('aCol', this.aCol);
    this.uniforms = { uScale: { value: 800 }, uSoft: { value: soft } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float aSize; attribute vec4 aCol; varying vec4 vCol; uniform float uScale;
        void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 512.0); }`,
      fragmentShader: `varying vec4 vCol; uniform float uSoft;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard;
        float a = pow(1.0 - d, uSoft); gl_FragColor = vec4(vCol.rgb, vCol.a * a); }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 1, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1;
    this.col.set([r, g, b, a], i * 4); this.a0[i] = a; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt, camHeight) {
    this.uniforms.uScale.value = camHeight;
    let w = 0;
    const P = this.aPos.array, S = this.aSize.array, C = this.aCol.array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const k = this.age[i] / this.life[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr - this.grav[i] * dt; this.v[i * 3 + 2] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (w !== i) {
        for (let c = 0; c < 3; c++) { this.p[w * 3 + c] = this.p[i * 3 + c]; this.v[w * 3 + c] = this.v[i * 3 + c]; }
        for (let c = 0; c < 4; c++) this.col[w * 4 + c] = this.col[i * 4 + c];
        this.life[w] = this.life[i]; this.age[w] = this.age[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i];
        this.a0[w] = this.a0[i]; this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i];
      }
      P[w * 3] = this.p[w * 3]; P[w * 3 + 1] = this.p[w * 3 + 1]; P[w * 3 + 2] = this.p[w * 3 + 2];
      S[w] = this.s0[w] + (this.s1[w] - this.s0[w]) * k;
      C[w * 4] = this.col[w * 4]; C[w * 4 + 1] = this.col[w * 4 + 1]; C[w * 4 + 2] = this.col[w * 4 + 2];
      C[w * 4 + 3] = this.a0[w] * (1 - k) * Math.min(1, k * 8);
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
  }
}
