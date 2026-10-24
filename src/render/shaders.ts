const COMMON = /* glsl */ `#version 300 es
precision highp float;
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

/** Balls and particles: an instanced quad shaded as an anti-aliased disc with optional glow. */
export const CIRCLE_VS = COMMON + COLOR + /* glsl */ `
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA; // x y r hue
layout(location = 2) in vec4 aB; // balls: px py bounces team | particles: alpha
uniform int uKind;               // 0 ball, 1 particle
uniform float uExtent;           // quad half-size in radii (bigger when glowing)
out vec2 vLocal;
out vec3 vColor;
out float vAlpha;
out float vRadiusPx;
void main() {
  float r = aA.z;
  vLocal = aCorner * uExtent;
  vec2 p = aA.xy + vLocal * r;
  if (uKind == 0) {
    vColor = ballColor(aA.w, aB.z);
    vAlpha = 1.0;
  } else {
    vColor = uColorMode == 1 ? uSolid : hsl2rgb(mod(aA.w, 360.0), 0.9, 0.62);
    vAlpha = aB.x;
  }
  vRadiusPx = r * uPx;
  gl_Position = toClip(p);
}
`;

export const CIRCLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vColor;
in float vAlpha;
in float vRadiusPx;
uniform float uGlow;     // 0..1
uniform float uOutline;  // 0/1
out vec4 o;
void main() {
  float d = length(vLocal);
  float aa = 1.0 / max(vRadiusPx, 0.5);
  float core = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  vec3 col = vColor;
  if (uOutline > 0.5) {
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

/** Rotating rings with a gap and round end caps, matching the physics exactly. */
export const RING_VS = COMMON + /* glsl */ `
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA; // cx cy r thickness
layout(location = 2) in vec4 aB; // rot gap hue flash
uniform float uGlow;
out vec2 vWorldPos;
flat out vec4 vA;
flat out vec4 vB;
void main() {
  float ext = aA.z + aA.w * (0.5 + 2.5 * uGlow) + 2.0 / uPx;
  vec2 p = aA.xy + aCorner * ext;
  vWorldPos = p;
  vA = aA;
  vB = aB;
  gl_Position = toClip(p);
}
`;

export const RING_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float uPx;
uniform float uGlow;
uniform float uTime;
uniform int uRainbow;
uniform vec3 uRingColor;
in vec2 vWorldPos;
flat in vec4 vA;
flat in vec4 vB;
out vec4 o;
vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
const float PI = 3.14159265359;
void main() {
  vec2 p = vWorldPos - vA.xy;
  float R = vA.z, th = vA.w * 0.5;
  float rot = vB.x, gap = vB.y;
  float ang = atan(p.y, p.x);
  float rel = mod(ang - rot + PI, 2.0 * PI) - PI;
  float sd;
  if (gap > 0.0 && abs(rel) < gap * 0.5) {
    vec2 c1 = vec2(cos(rot + gap * 0.5), sin(rot + gap * 0.5)) * R;
    vec2 c2 = vec2(cos(rot - gap * 0.5), sin(rot - gap * 0.5)) * R;
    sd = min(length(p - c1), length(p - c2)) - th;
  } else {
    sd = abs(length(p) - R) - th;
  }
  float sdPx = sd * uPx;
  float core = 1.0 - smoothstep(-0.75, 0.75, sdPx);
  float glow = uGlow * 0.45 * exp(-max(sd, 0.0) / max(th * 2.0, 2.0)) * (1.0 - core);
  vec3 col = uRainbow == 1 ? hsl2rgb(mod(vB.z + uTime * 40.0, 360.0), 0.9, 0.6) : uRingColor;
  col = mix(col, vec3(1.0), vB.w * 0.7);
  float a = core + glow;
  o = vec4(col * a, a);
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
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() {
  o = texture(uTex, vUv);
}
`;
