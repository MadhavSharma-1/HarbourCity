import * as THREE from 'three';
import { WATER_LEVEL, SHORE_Z, seabedHeight } from './world.js';

const vert = /* glsl */`
uniform float uTime;
attribute float aDepth;
varying vec3 vW;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float a = clamp(aDepth / 3.0, 0.15, 1.0);
  float t = uTime;
  w.y += (0.18 * sin(0.08 * w.x + 0.6 * t) + 0.12 * sin(0.11 * w.z - 0.9 * t + 1.3) + 0.06 * sin(0.21 * (w.x + w.z) + 1.7 * t)) * a;
  vW = w.xyz; vDepth = aDepth;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizon;
uniform float uNight;
varying vec3 vW;
varying float vDepth;
#include <fog_pars_fragment>

vec3 waveNormal(vec2 p, float t, float amp) {
  float s = 0.21 * (p.x + p.y) + 1.7 * t;
  float dx = (0.18 * 0.08 * cos(0.08 * p.x + 0.6 * t) + 0.06 * 0.21 * cos(s)) * amp;
  float dz = (0.12 * 0.11 * cos(0.11 * p.y - 0.9 * t + 1.3) + 0.06 * 0.21 * cos(s)) * amp;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 dir = vec2(cos(fi * 2.39 + 0.4), sin(fi * 2.39 + 0.4));
    float f = 0.45 + fi * 0.62;
    float ph = dot(dir, p) * f + t * (1.1 + fi * 0.37);
    float a = 0.045 / (1.0 + fi * 0.8);
    dx += a * f * dir.x * cos(ph);
    dz += a * f * dir.y * cos(ph);
  }
  return normalize(vec3(-dx, 1.0, -dz));
}

void main() {
  float amp = clamp(vDepth / 3.0, 0.15, 1.0);
  vec3 n = waveNormal(vW.xz, uTime, amp);
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // flatten normals in the distance to avoid sparkle aliasing
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp(dist / 900.0, 0.0, 0.8)));
  vec3 col; float alpha;
  if (cameraPosition.y >= vW.y) {
    float ndv = max(dot(n, V), 0.0);
    float fres = min(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.7);
    float dz = smoothstep(0.0, 14.0, vDepth);
    vec3 shallow = vec3(0.06, 0.36, 0.38);
    vec3 deep = vec3(0.004, 0.045, 0.1);
    float dayK = 0.18 + 0.82 * (1.0 - uNight);
    vec3 water = mix(shallow, deep, dz) * dayK;
    // subsurface glow facing the sun
    water += vec3(0.0, 0.12, 0.1) * pow(max(dot(-V, uSunDir), 0.0), 3.0) * (1.0 - uNight) * (1.0 - dz * 0.5);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon * vec3(0.8, 0.9, 1.0), uSkyColor, clamp(R.y * 2.5 + 0.15, 0.0, 1.0));
    float sd = max(dot(R, uSunDir), 0.0);
    float spec = pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 0.5;
    col = mix(water, sky, fres) + uSunColor * spec;
    float fn = sin(vW.x * 0.9 + uTime * 1.4) * sin(vW.z * 1.1 - uTime * 1.1) * 0.5 + 0.5;
    float foam = (1.0 - smoothstep(0.0, 0.8, vDepth)) * (0.55 + 0.45 * fn);
    col = mix(col, vec3(0.92) * dayK, foam * 0.75);
    alpha = mix(0.45, 0.96, smoothstep(0.0, 4.5, vDepth));
    alpha = max(alpha, fres);
  } else {
    // seen from below: Snell's window + total internal reflection
    float c = clamp(-V.y, 0.0, 1.0);
    vec3 nb = -n;
    float window = smoothstep(0.62, 0.78, c + nb.x * 0.15);
    vec3 tir = vec3(0.02, 0.12, 0.15) * (0.25 + 0.75 * (1.0 - uNight));
    vec3 through = mix(uHorizon, uSkyColor, c) * 1.3 + uSunColor * pow(max(dot(-V, -uSunDir), 0.0), 50.0) * 3.0;
    col = mix(tir, through, window);
    alpha = 0.97;
  }
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export function createOcean(scene, shared) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyColor: { value: new THREE.Color(0.3, 0.5, 0.8) },
    uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uNight: { value: 0 },
  }]);
  uniforms.uTime = shared.uTime;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, fog: true, side: THREE.DoubleSide, depthWrite: true,
  });
  const make = (w, d, sx, sz, cz, depthFn) => {
    const g = new THREE.PlaneGeometry(w, d, sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(0, WATER_LEVEL, cz);
    const p = g.attributes.position;
    const dep = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) dep[i] = depthFn(p.getX(i), p.getZ(i));
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  };
  const z0 = SHORE_Z + 40, d = 1700;
  const near = make(8000, d, 400, 170, z0 + d / 2, (x, z) => Math.max(WATER_LEVEL - seabedHeight(x, z), 0));
  const far = make(14000, 7000, 1, 1, z0 + d + 3500 - 2, () => 60);
  return { mat, uniforms, meshes: [near, far] };
}
