const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uWorld;   // world size in sim units
uniform float uPx;     // pixels per world unit
vec4 toClip(vec2 p) {
  vec2 c = p / uWorld * 2.0 - 1.0;
  return vec4(c.x, -c.y, 0.0, 1.0);
}
`;

const COLOR = /* glsl */ `
uniform int uColorMode;   // 0 rainbow (per-ball hue), 1 solid, 2 hue cycles with bounces
uniform vec3 uSolid;
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
vec3 ballColor(float hue, float bounces) {
  if (uColorMode == 1) return uSolid;
  if (uColorMode == 2) hue += bounces * 25.0;
  return hsl2rgb(mod(hue, 360.0), 0.9, 0.6);
}
`;

/** Balls, particles, gems and power-ups: an instanced quad shaded with an anti-aliased SDF shape. */
export const CIRCLE_VS = COMMON + COLOR + /* glsl */ `
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA; // x y r hue (power-ups: x y r kind)
layout(location = 2) in vec4 aB; // balls: px py bounces frozen | particles/gems: alpha mult | power-ups: life pulse
uniform int uKind;               // 0 ball, 1 particle, 2 gem, 3 power-up
uniform vec3 uHeroColor;
uniform float uExtent;           // quad half-size in radii (bigger when glowing)
out vec2 vLocal;
out vec3 vColor;
out float vAlpha;
out float vRadiusPx;
flat out float vFrozen;
// split, speed, grow, shrink, portal A, portal B, magnet / black hole
const float POWERUP_HUES[7] = float[7](130.0, 48.0, 205.0, 290.0, 28.0, 210.0, 285.0);
void main() {
  float r = aA.z;
  vFrozen = 0.0;
  if (uKind == 0) {
    // aB.w flags: 1 = stuck on a spike, 2 = the special "hero" ball.
    bool hero = aB.w >= 2.0;
    vColor = hero ? uHeroColor : ballColor(aA.w, aB.z);
    vAlpha = 1.0;
    vFrozen = mod(aB.w, 2.0);
  } else if (uKind == 1) {
    vColor = uColorMode == 1 ? uSolid : hsl2rgb(mod(aA.w, 360.0), 0.9, 0.62);
    vAlpha = aB.x;
  } else if (uKind == 2) {
    vColor = hsl2rgb(aA.w + aB.y * 25.0, 0.85, 0.72);
    vAlpha = aB.x;
  } else {
    vColor = hsl2rgb(POWERUP_HUES[clamp(int(aA.w), 0, 6)], 0.9, 0.58);
    vAlpha = clamp(aB.x * 4.0, 0.0, 1.0);
    r *= 1.0 + 0.08 * aB.y;
  }
  vLocal = aCorner * uExtent;
  vec2 p = aA.xy + vLocal * r;
  vRadiusPx = r * uPx;
  gl_Position = toClip(p);
}
`;

export const CIRCLE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vLocal;
in vec3 vColor;
in float vAlpha;
in float vRadiusPx;
flat in float vFrozen;
uniform int uKind;
uniform float uGlow;     // 0..1
uniform float uOutline;  // 0/1
out vec4 o;
void main() {
  float aa = 1.0 / max(vRadiusPx, 0.5);
  float d = uKind == 2 ? (abs(vLocal.x) + abs(vLocal.y)) * 0.85 : length(vLocal);
  float core = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  vec3 col = vColor;
  if (uKind == 3) {
    // Power-up: a bright ring with a soft fill; the icon comes from the text layer.
    float band = 1.0 - smoothstep(0.12 - aa, 0.12 + aa, abs(d - 0.86));
    core = max(band, core * 0.28);
  } else if (uKind == 2) {
    float facet = step(0.0, vLocal.x * vLocal.y);
    col = mix(col, vec3(1.0), 0.25 * facet + 0.5 * smoothstep(0.75, 1.0, d));
  }
  if (uOutline > 0.5 || vFrozen > 0.5) {
    float ring = smoothstep(0.78 - aa, 0.78 + aa, d);
    col = mix(col, vec3(1.0), ring * 0.85);
  }
  float glow = uGlow * 0.55 * exp(-max(d - 1.0, 0.0) * 2.6) * (1.0 - core);
  float a = (core + glow) * vAlpha;
  o = vec4(col * a, a);
}
`;

/** Capsule segments: used for motion trails and for the persistent paint layer. */
export const SEGMENT_VS = COMMON + COLOR + /* glsl */ `
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA; // x1 y1 x2 y2
layout(location = 2) in vec4 aB; // radius hue alpha bounces
out vec2 vWorldPos;
flat out vec4 vSeg;
flat out float vRadius;
out vec3 vColor;
out float vAlpha;
void main() {
  vec2 p1 = aA.xy, p2 = aA.zw;
  vec2 d = p2 - p1;
  float len = length(d);
  vec2 u = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 v = vec2(-u.y, u.x);
  float pad = 1.5 / uPx;
  float r = aB.x;
  vec2 c = (p1 + p2) * 0.5;
  vec2 p = c + u * aCorner.x * (len * 0.5 + r + pad) + v * aCorner.y * (r + pad);
  vWorldPos = p;
  vSeg = aA;
  vRadius = r;
  vColor = ballColor(aB.y, aB.w);
  vAlpha = aB.z;
  gl_Position = toClip(p);
}
`;

export const SEGMENT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform float uPx;
in vec2 vWorldPos;
flat in vec4 vSeg;
flat in float vRadius;
in vec3 vColor;
in float vAlpha;
out vec4 o;
void main() {
  vec2 pa = vWorldPos - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float bb = dot(ba, ba);
  float h = bb > 1e-8 ? clamp(dot(pa, ba) / bb, 0.0, 1.0) : 0.0;
  float sd = (length(pa - ba * h) - vRadius) * uPx;
  float a = (1.0 - smoothstep(-0.75, 0.75, sd)) * vAlpha;
  o = vec4(vColor * a, a);
}
`;

/** Rotating rings or regular polygons with a gap, spikes and glass — matching the physics. */
export const RING_VS = COMMON + /* glsl */ `
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA; // cx cy r thickness
layout(location = 2) in vec4 aB; // rot gap hue flash
layout(location = 3) in vec4 aC; // spikeCenter spikeArc glassFrac spikeLen
layout(location = 4) in vec4 aD; // sides toothWidth - -
uniform float uGlow;
out vec2 vWorldPos;
flat out vec4 vA;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main() {
  float ext = aA.z + aA.w * (0.5 + 2.5 * uGlow) + 2.0 / uPx;
  vec2 p = aA.xy + aCorner * ext;
  vWorldPos = p;
  vA = aA;
  vB = aB;
  vC = aC;
  vD = aD;
  gl_Position = toClip(p);
}
`;

export const RING_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform float uPx;
uniform float uGlow;
uniform float uTime;
uniform int uRainbow;
uniform vec3 uRingColor;
in vec2 vWorldPos;
flat in vec4 vA;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
out vec4 o;
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
const float PI = 3.14159265359;
float wrapAngle(float a) { return mod(a + PI, 2.0 * PI) - PI; }
vec2 rotate2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main() {
  vec2 p = vWorldPos - vA.xy;
  float R = vA.z, th = vA.w * 0.5;
  float rot = vB.x, gap = vB.y;
  float sides = vD.x;
  float ang = atan(p.y, p.x);
  float len = length(p);
  float rel = wrapAngle(ang - rot);

  // dist: signed distance from the wall's centre line (positive = outside);
  // radial: distance from the centre measured along the nearest wall normal;
  // tang: coordinate along the wall (for spacing spike teeth).
  float apo = R, radial = len, tang = 0.0;
  if (sides >= 3.0) {
    vec2 q = rotate2(p, -rot);
    float stepA = 2.0 * PI / sides;
    float k = floor(atan(q.y, q.x) / stepA + 0.5);
    vec2 n = vec2(cos(k * stepA), sin(k * stepA));
    apo = R * cos(PI / sides);
    radial = dot(q, n);
    tang = dot(q, vec2(-n.y, n.x)) + k * 2.0 * apo * tan(PI / sides);
  } else {
    tang = (ang - rot) * R;
  }
  float sd = abs(radial - apo) - th;
  if (gap > 0.0 && abs(rel) < gap * 0.5) {
    // Gap with round caps at its two ends (on the wall line).
    float edgeR = sides >= 3.0 ? apo / cos(gap * 0.5) : R;
    vec2 c1 = vec2(cos(rot + gap * 0.5), sin(rot + gap * 0.5)) * edgeR;
    vec2 c2 = vec2(cos(rot - gap * 0.5), sin(rot - gap * 0.5)) * edgeR;
    sd = min(length(p - c1), length(p - c2)) - th;
  }
  vec3 col = uRainbow == 1 ? hsl2rgb(mod(vB.z + uTime * 40.0, 360.0), 0.9, 0.6) : uRingColor;
  float alphaMul = 1.0;

  // Glass: translucent with a bright rim and cracks that multiply as it takes hits.
  float glass = vC.z;
  if (glass >= 0.0) {
    float rim = 1.0 - smoothstep(0.0, th * 0.6, abs(abs(radial - apo) - th * 0.7));
    col = mix(col * 0.7 + 0.3, vec3(1.0), rim * 0.6);
    alphaMul = 0.55 + rim * 0.35;
    float cracks = floor((1.0 - glass) * 28.0);
    for (int k = 0; k < 28; k++) {
      if (float(k) >= cracks) break;
      float a = hash(float(k) + 1.0) * 2.0 * PI;
      float wobble = (hash(float(k) + 7.0) - 0.5) * 0.04 * (radial - apo) / max(th, 1.0);
      float dist = abs(wrapAngle(ang - a - wobble)) * len * uPx;
      if (dist < 1.2) { col = vec3(1.0); alphaMul = 1.0; }
    }
  }

  float sdPx = sd * uPx;
  float core = 1.0 - smoothstep(-0.75, 0.75, sdPx);

  // Spikes: triangular teeth pointing inward over the spike arc; they can grow long.
  float spikes = 0.0;
  if (vC.y > 0.0 && vC.w > 0.0) {
    float sr = wrapAngle(ang - vC.x);
    if (abs(sr) < vC.y * 0.5) {
      float inner = apo - th;
      float depth = inner - radial;
      float width = max(vD.y, 4.0);
      float f = fract(tang / width);
      float tooth = vC.w * (1.0 - abs(2.0 * f - 1.0));
      float sdTooth = max(depth - tooth, -depth) * uPx;
      spikes = 1.0 - smoothstep(-0.75, 0.75, sdTooth);
    }
  }

  float glow = uGlow * 0.45 * exp(-max(sd, 0.0) / max(th * 2.0, 2.0)) * (1.0 - core);
  col = mix(col, vec3(1.0), vB.w * 0.7);
  vec3 spikeCol = mix(vec3(1.0, 0.25, 0.35), vec3(1.0), vB.w * 0.5);
  float a = (core + glow) * alphaMul;
  vec3 outc = col * a;
  float sa = spikes;
  o = vec4(outc * (1.0 - sa) + spikeCol * sa, a * (1.0 - sa) + sa);
}
`;

/** Full-screen textured quad (paint layer and text overlay). Textures hold premultiplied alpha. */
export const QUAD_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
out vec2 vUv;
uniform int uFlipY;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  if (uFlipY == 1) vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

export const QUAD_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() {
  o = texture(uTex, vUv);
}
`;
