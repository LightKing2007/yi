/** 全部 GLSL（ES 3.00）着色器。顶点色常被当作参数：见各着色器的说明 */

const HEAD = `#version 300 es
precision highp float;
in vec2 fragTexCoord; in vec4 fragColor; in vec4 fragExt;
out vec4 finalColor;
`;

const COMMON =
  HEAD +
  `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s; }
float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
`;

/** 纯色形状：ext = (类型, 圆角半径, 宽, 高)。类型 0 矩形 1 圆 2 圆角矩形 3 圆角矩形描边（宽 1 像素） */
export const SHAPE_FS =
  COMMON +
  `
void main(){
  int kind = int(fragExt.x + 0.5);
  float a = 1.0;
  if (kind == 1) {
    float r = length(fragTexCoord*2.0 - 1.0), aa = fwidth(r);
    a = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  } else if (kind >= 2) {
    vec2 size = fragExt.zw, p = (fragTexCoord - 0.5)*size;
    float d = sdRR(p, size*0.5, fragExt.y), aa = fwidth(d);
    a = kind == 2 ? 1.0 - smoothstep(-aa*0.5, aa*0.5, d) : 1.0 - smoothstep(0.0, aa, abs(d + 0.5));
  }
  finalColor = vec4(fragColor.rgb, fragColor.a*a);
}`;

/** 贴图：ext.x = 1 时按预乘 alpha 输出 */
export const TEX_FS =
  HEAD +
  `
uniform sampler2D tex;
void main(){
  vec4 c = texture(tex, fragTexCoord)*fragColor;
  finalColor = c;
}`;

/** 榧木棋盘 */
export const WOOD_FS =
  COMMON +
  `
uniform vec2 size;
uniform float radius;
uniform float seed;
void main(){
  vec2 px = fragTexCoord*size;
  vec2 u  = px/size.y;
  float s = seed;
  float w1 = fbm(vec2(u.x*2.2, u.y*0.35) + s);
  float w2 = fbm(vec2(u.x*6.0, u.y*1.10) + s*1.7);
  float g1 = u.x*21.0 + w1*4.2 + w2*0.8 + u.y*0.5;
  float l1 = pow(0.5 + 0.5*sin(g1*6.28318), 9.0);
  float g2 = u.x*88.0 + w1*15.0 + w2*3.0;
  float l2 = pow(0.5 + 0.5*sin(g2*6.28318), 5.0);
  float fib  = noise(vec2(u.x*560.0, u.y*8.0) + s);
  float fib2 = noise(vec2(u.x*190.0, u.y*3.5) + s*3.1);
  float big  = fbm(u*1.5 + s*0.7);
  vec3 cLight = vec3(0.930, 0.800, 0.575);
  vec3 cMid   = vec3(0.890, 0.730, 0.490);
  vec3 cDark  = vec3(0.770, 0.585, 0.355);
  vec3 c = mix(cLight, cMid, smoothstep(0.25, 0.75, big));
  c = mix(c, cDark, l1*0.40 + l2*0.13);
  c *= 0.968 + 0.045*fib + 0.03*fib2;
  vec2 d = (fragTexCoord - vec2(0.26, 0.20))*vec2(1.0, 1.3);
  c += vec3(1.0, 0.94, 0.82)*exp(-dot(d, d)*4.5)*0.075;
  c *= 1.0 - 0.07*length(fragTexCoord - vec2(0.45, 0.4));
  vec2 hp = px - size*0.5;
  float d0 = sdRR(hp, size*0.5, radius);
  float bevel = 1.0 - smoothstep(0.0, 2.5*size.y/900.0 + 1.0, -d0);
  float topSide = clamp(-hp.y/(size.y*0.5), -1.0, 1.0);
  c = mix(c, c*(1.10 + 0.08*topSide), bevel*0.5);
  c = mix(c, c*0.82, bevel*max(-topSide, 0.0)*0.6);
  c += (hash(px) - 0.5)/255.0;
  float a = clamp(0.5 - d0, 0.0, 1.0);
  finalColor = vec4(c*fragColor.rgb, a);
}`;

/** 棋子材质（黑：云子；白：蛤碁石）。n=法线 q=纹理坐标 p=相对棋子中心的位置 r=视线离棋子中心的距离 */
const STONE_MATERIAL = `
vec3 stoneColor(int mode, vec3 n, vec2 q, vec2 p, float r, float seed){
  vec3 L = normalize(vec3(-0.42, 0.52, 0.74));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  vec3 R = reflect(-V, n);
  float ndl = dot(n, L);
  float nh = max(dot(n, H), 0.0);
  float rl = dot(R, L);
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
  float envK = clamp(rl*0.5 + 0.5, 0.0, 1.0); envK *= envK;
  float win = smoothstep(0.955, 0.992, rl);
  float rim = smoothstep(0.35, 0.99, r);
  vec2 ld = normalize(L.xy);
  vec2 pd = normalize(p + vec2(1e-5));
  float away = clamp(dot(pd, -ld), 0.0, 1.0);
  vec3 col;
  if (mode == 1) {
    vec3 base = vec3(0.034, 0.036, 0.040);
    col = base*(0.60 + 0.70*max(ndl, 0.0));
    vec3 env = mix(vec3(0.012, 0.013, 0.015), vec3(0.50, 0.50, 0.49), envK);
    col += env*(0.035 + 0.50*fres);
    col += vec3(1.0, 0.985, 0.955)*(pow(nh, 10.0)*0.050 + win*0.20 + pow(nh, 300.0)*0.30);
    col += vec3(0.020, 0.064, 0.054)*pow(rim, 1.6)*pow(away, 1.1)*2.3;
    col *= 0.975 + 0.05*noise(q*16.0 + seed);
  } else {
    float ang = seed*0.0246;
    vec2 qq = mat2(cos(ang), -sin(ang), sin(ang), cos(ang))*q;
    float st = sin(qq.y*30.0 + noise(qq*2.5 + seed)*5.0)*0.5 + 0.5;
    vec3 base = vec3(0.945, 0.940, 0.915)*(1.0 - 0.016*st);
    float wrap = clamp((ndl + 0.6)/1.6, 0.0, 1.0);
    col = base*(0.70 + 0.36*wrap);
    col += vec3(0.070, 0.048, 0.018)*(1.0 - wrap)*0.9;
    col *= mix(1.0, 0.87, pow(rim, 2.2));
    col += vec3(0.080, 0.070, 0.048)*pow(rim, 1.5)*pow(away, 1.2)*0.9;
    vec3 env = mix(vec3(0.58, 0.56, 0.52), vec3(1.0), envK);
    col = mix(col, env, fres*0.14);
    col += vec3(1.0)*(pow(nh, 12.0)*0.045 + win*0.10 + pow(nh, 300.0)*0.20);
    col *= 1.0 - 0.20*smoothstep(0.93, 1.0, r);
  }
  return col;
}`;

/** 棋子与棋子阴影。顶点色：r=模式(0 阴影 / 80 黑 / 160 白，÷255) g=随机种子÷255 b>0.5 标出最后一手 a=透明度 */
export const STONE_FS =
  COMMON +
  STONE_MATERIAL +
  `
void main(){
  float m = fragColor.r*255.0;
  int mode = m < 40.0 ? 0 : (m < 120.0 ? 1 : 2);
  float seed = fragColor.g*255.0;
  float alpha = fragColor.a;
  vec2 p = fragTexCoord*2.0 - 1.0; p.y = -p.y;
  if (mode == 0) {
    float r = length(p)*1.5;
    float a = 1.0 - smoothstep(0.55, 1.45, r); a = a*a*(3.0 - 2.0*a);
    float core = 1.0 - smoothstep(0.82, 1.05, r);
    finalColor = vec4(0.12, 0.075, 0.035, (a*0.40 + core*0.22)*alpha);
    return;
  }
  float r = length(p);
  float aa = fwidth(r)*1.3;
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (mask <= 0.0) discard;
  float z = sqrt(max(1.0 - r*r, 0.0));
  vec3 n = normalize(vec3(p, z*1.9 + 0.06));
  vec3 col = stoneColor(mode, n, p, p, r, seed);
  if (fragColor.b > 0.5) {
    float dot_ = 1.0 - smoothstep(0.17 - aa, 0.17, r);
    vec3 mc = mode == 1 ? vec3(0.93, 0.915, 0.88) : vec3(0.13, 0.13, 0.14);
    col = mix(col, mc, dot_*0.92);
  }
  col += (hash(gl_FragCoord.xy) - 0.5)/255.0;
  finalColor = vec4(min(col, vec3(1.0)), mask*alpha);
}`;

/**
 * 立体棋子：被炸飞翻滚、飞回棋罐、罐中堆叠时用。棋子是一枚扁圆的卵石——旋转椭球，半厚 c≈0.53 倍半径，
 * 正对镜头时与平面棋子一模一样。逐像素求视线与旋转后椭球的交点，再用同一材质着色。
 * 物体→屏幕的旋转（y 轴向上）以四元数放在 ext 里，顶点着色器还原成矩阵。顶点色同 STONE_FS
 */
export const STONE3D_VS = `#version 300 es
in vec2 aPos; in vec2 aUV; in vec4 aCol; in vec4 aExt;
uniform vec4 uProj;
out vec2 fragTexCoord; out vec4 fragColor; out vec4 fragExt;
flat out vec3 rot0; flat out vec3 rot1; flat out vec3 rot2;
void main(){
  vec4 q = aExt;
  float x = q.x, y = q.y, z = q.z, w = q.w;
  rot0 = vec3(1.0 - 2.0*(y*y + z*z), 2.0*(x*y + w*z), 2.0*(x*z - w*y));
  rot1 = vec3(2.0*(x*y - w*z), 1.0 - 2.0*(x*x + z*z), 2.0*(y*z + w*x));
  rot2 = vec3(2.0*(x*z + w*y), 2.0*(y*z - w*x), 1.0 - 2.0*(x*x + y*y));
  fragTexCoord = aUV; fragColor = aCol; fragExt = aExt;
  gl_Position = vec4(aPos.x*uProj.x + uProj.z, aPos.y*uProj.y + uProj.w, 0.0, 1.0);
}`;

export const STONE3D_FS =
  COMMON +
  STONE_MATERIAL +
  `
flat in vec3 rot0; flat in vec3 rot1; flat in vec3 rot2;
const float c = 0.526;
void main(){
  int mode = fragColor.r*255.0 < 120.0 ? 1 : 2;
  float seed = fragColor.g*255.0;
  vec2 p = fragTexCoord*2.0 - 1.0; p.y = -p.y;
  mat3 Rm = mat3(rot0, rot1, rot2);
  mat3 Ri = transpose(Rm);
  vec3 o = Ri*vec3(p, 3.0), d = Ri*vec3(0.0, 0.0, -1.0);
  vec3 os = vec3(o.xy, o.z/c), ds = vec3(d.xy, d.z/c);
  float A = dot(ds, ds), B = dot(os, ds), C = dot(os, os) - 1.0;
  float disc = B*B - A*C;
  float cov = clamp(disc/(fwidth(disc) + 1e-6) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec3 h = os + ds*((-B - sqrt(max(disc, 0.0)))/A);
  vec3 n = normalize(Rm*vec3(h.xy, h.z/c));
  float r = sqrt(clamp(1.0 - disc/A, 0.0, 1.0));
  vec3 col = stoneColor(mode, n, h.xy, p, r, seed);
  col += (hash(gl_FragCoord.xy) - 0.5)/255.0;
  finalColor = vec4(min(col, vec3(1.0)), cov*fragColor.a);
}`;

/** 木制棋罐（俯视）。顶点色：r=模式(0 罐体 / 80 罐内阴影) g=木纹种子÷255 a=透明度。罐口外缘半径为 1，0.8 以内是罐内 */
export const BOWL_FS =
  COMMON +
  `
const float ri = 0.80;
vec3 L = normalize(vec3(-0.42, 0.52, 0.74));
vec3 wood(vec2 p, float r, float seed){
  vec2 d = p/max(r, 1e-4);
  float w = noise(d*1.6 + vec2(r*3.0) + seed)*1.5 + noise(p*5.0 + seed)*0.6;
  float rings = pow(0.5 + 0.5*sin(r*62.0 + w*5.0), 3.0);
  float fine = noise(d*28.0 + vec2(r*40.0) + seed*3.0);
  vec3 c = mix(vec3(0.50, 0.28, 0.13), vec3(0.64, 0.39, 0.20), smoothstep(0.2, 0.8, noise(p*2.0 + seed)));
  c = mix(c, vec3(0.36, 0.19, 0.08), rings*0.45);
  return c*(0.95 + 0.08*fine);
}
vec3 shade(vec3 base, vec3 n, float gloss){
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float dif = 0.42 + 0.70*max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 60.0)*gloss + pow(max(dot(n, H), 0.0), 8.0)*gloss*0.12;
  return base*dif + vec3(1.0, 0.95, 0.86)*spec;
}
void main(){
  float m = fragColor.r*255.0, seed = fragColor.g*255.0;
  vec2 p = fragTexCoord*2.0 - 1.0; p.y = -p.y;
  float r = length(p), aa = fwidth(r)*1.2;
  vec2 dir = p/max(r, 1e-4);
  if (m > 40.0) {
    if (r > ri) discard;
    vec2 ld = normalize(L.xy);
    float sh = smoothstep(ri - 0.06, ri + 0.02, length(p + ld*0.16));
    float ao = exp(-(ri - r)/0.035);
    float a = clamp(sh*0.55 + ao*0.35, 0.0, 0.8);
    finalColor = vec4(0.10, 0.05, 0.02, a*fragColor.a);
    return;
  }
  float outer = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (outer <= 0.0) discard;
  vec3 col;
  if (r > ri) {
    float u = (r - ri)/(1.0 - ri);
    float s = cos(u*3.14159);
    vec3 n = normalize(vec3(-dir*s*0.85, 0.35 + 0.65*sin(u*3.14159)));
    col = shade(wood(p, r, seed)*1.08, n, 0.55);
    col *= 1.0 - 0.25*smoothstep(0.93, 1.0, r);
  } else {
    float q = r/ri;
    vec3 n = normalize(vec3(-p*1.1, sqrt(max(1.0 - q*q, 0.0)) + 0.35));
    col = shade(wood(p*1.3, r*1.3, seed + 7.0)*0.78, n, 0.35);
    col *= 0.80 + 0.20*q;
  }
  col += (hash(gl_FragCoord.xy) - 0.5)/255.0;
  finalColor = vec4(col, outer*fragColor.a);
}`;

/** 柔和圆角矩形投影：ext = (矩形宽, 高, 圆角, 模糊)，四边形比矩形每边大 2 倍模糊 */
export const SHADOW_FS =
  COMMON +
  `
void main(){
  vec2 rect = fragExt.xy; float radius = fragExt.z, blur = fragExt.w;
  vec2 quad = rect + vec2(4.0*blur);
  vec2 p = (fragTexCoord - 0.5)*quad;
  float d = sdRR(p, rect*0.5, radius);
  float a = 1.0 - smoothstep(-blur, blur, d);
  a = a*a;
  finalColor = vec4(fragColor.rgb, fragColor.a*a);
}`;

/**
 * 特效（胜利、冲击波、雷达波纹等）。ext = (模式, 参数, 金色, 0)：模式 0 光晕 / 1 圆环 / 2 火花拖尾与光束；
 * 光晕、火花：参数 = 偏金程度；圆环：参数 = 环宽（占半径的 参数/4），金色 > 0.5 为金色光环并带内侧余晖
 */
export const FX_FS =
  COMMON +
  `
void main(){
  int m = int(fragExt.x + 0.5);
  float prm = fragExt.y;
  vec2 p = fragTexCoord*2.0 - 1.0;
  float r = length(p);
  vec3 hot = vec3(1.0, 0.97, 0.88);
  vec3 amber = mix(vec3(1.0, 0.76, 0.32), vec3(0.92, 0.34, 0.05), prm);
  vec3 col; float a;
  if (m == 0) {
    float core = exp(-r*r*22.0);
    a = exp(-r*r*4.5)*(1.0 - smoothstep(0.75, 1.0, r));
    col = mix(amber, hot, core);
  } else if (m == 1) {
    float aa = fwidth(r);
    float w = max(prm*0.25, aa);
    float c0 = 1.0 - w*0.5 - aa;
    a = 1.0 - smoothstep(w*0.5 - aa*0.5, w*0.5 + aa*0.5, abs(r - c0));
    if (fragExt.z > 0.5) {
      a += exp(-(c0 - r)/(w*3.0 + 0.02))*0.35*step(r, c0);
      col = vec3(1.0, 0.84, 0.50);
    } else col = fragColor.rgb;
  } else {
    float core = exp(-(p.x*p.x*9.0 + p.y*p.y*90.0));
    a = exp(-(p.x*p.x*2.6 + p.y*p.y*22.0));
    col = mix(amber, hot, core);
  }
  finalColor = vec4(col, clamp(a, 0.0, 1.0)*fragColor.a);
}`;

/**
 * 全局光影：左半输出相乘的色调（光色、摇曳的枝叶影、暗角），右半输出叠加的光（光源晕光、叶隙透光、淡淡的光束）。
 * board / panel 为棋盘与面板在贴图中的矩形（左下角原点），面板上只保留三成；k 为整体强度。
 * P[0] 光源位置 xy、暗角、枝叶阴影强度；P[1] 近光色 + 叶影横向拉伸；P[2] 远处色 + 纵向拉伸；
 * P[3] 叶影色 + 叶影斜切；P[4] 光源晕光；P[5] 叶隙透光；P[6] 光束；P[7].x 竹影浓淡
 */
export const DUSK_FS =
  COMMON +
  `
uniform vec2 res;
uniform vec4 board;
uniform vec4 panel;
uniform float time;
uniform float k;
uniform vec4 P[8];
uniform vec4 LA[72];
uniform vec4 LB[72];
uniform vec4 TA[32];
uniform vec4 TB[32];
uniform int leafN;
uniform int twigN;
float Bamboo(vec2 p){
  float s = 0.0;
  for (int i = 0; i < 72; i++) {
    if (i >= leafN) break;
    vec2 d = p - LA[i].xy;
    float len = LA[i].w, bl = LB[i].y;
    if (dot(d, d) > (len + bl*2.0)*(len + bl*2.0)) continue;
    float c = cos(LA[i].z), sn = sin(LA[i].z);
    vec2 q = vec2(d.x*c + d.y*sn, -d.x*sn + d.y*c);
    float t = clamp(q.x/len, 0.0, 1.0);
    float w = LB[i].x*pow(sin(3.14159*pow(t, 0.8)), 0.75)*(1.0 - 0.25*t);
    float dist = max(abs(q.y) - w, max(-q.x, q.x - len));
    s = max(s, (1.0 - smoothstep(-bl, bl, dist))*LB[i].z);
  }
  for (int i = 0; i < 32; i++) {
    if (i >= twigN) break;
    vec2 a = TA[i].xy, b = TA[i].zw, pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
    float dist = length(pa - ba*h) - TB[i].x;
    s = max(s, (1.0 - smoothstep(-TB[i].y, TB[i].y, dist))*TB[i].z);
  }
  return s;
}
void main(){
  vec2 f = gl_FragCoord.xy;
  float pass = step(res.x, f.x);
  f.x -= res.x*pass;
  vec2 uv = f/res;
  float asp = res.x/res.y;
  vec2 bp = (f - board.xy)/board.zw;
  float inB = smoothstep(-0.03, 0.02, min(min(bp.x, 1.0 - bp.x), min(bp.y, 1.0 - bp.y)));
  vec2 st = vec2(P[1].w, P[2].w);
  vec2 q = bp*2.4;
  q = vec2(q.x + q.y*P[3].w, q.y - q.x*P[3].w)*st;
  q += vec2(sin(time*0.55 + q.y*1.3), cos(time*0.43 + q.x*1.1))*0.05;
  float n = fbm(q + vec2(time*0.010, 0.0) + 3.1);
  float shade = smoothstep(0.50, 0.60, n)*inB*P[0].w;
  if (P[7].x > 0.001) shade = mix(shade, Bamboo(vec2(uv.x*asp, uv.y))*P[0].w, P[7].x);
  vec2 dd = abs(f - panel.xy - panel.zw*0.5) - panel.zw*0.5;
  float inP = 1.0 - smoothstep(0.0, res.y*0.22, length(max(dd, 0.0)));
  float kk = k*(1.0 - 0.7*inP);
  vec2 sun = P[0].xy;
  float ds = length((uv - sun)*vec2(asp, 1.0));
  if (pass < 0.5) {
    vec3 m = mix(P[1].rgb, P[2].rgb, smoothstep(0.3, 1.7, ds));
    m *= mix(vec3(1.0), P[3].rgb, clamp(shade, 0.0, 1.0));
    float v = length((uv - 0.5)*vec2(asp*0.8, 1.0));
    m *= 1.0 - P[0].z*smoothstep(0.45, 1.05, v);
    finalColor = vec4(mix(vec3(1.0), m, kk), 1.0);
  } else {
    vec3 g = P[4].rgb*exp(-ds*ds*2.0);
    g += P[5].rgb*(1.0 - smoothstep(0.40, 0.52, n))*inB;
    float ray = pow(0.5 + 0.5*sin((uv.x*asp - uv.y)*8.0 + time*0.12 + fbm(uv*2.5 + time*0.04)*2.0), 8.0);
    g += P[6].rgb*ray*exp(-ds*0.8);
    finalColor = vec4(g*kk, 1.0);
  }
}`;

/** 光影合成的一层：ext.x = 0 取左半（乘法色），1 取右半（加法光） */
export const DUSKMIX_FS =
  HEAD +
  `
uniform sampler2D dusk;
uniform vec2 texel;
void main(){
  vec2 uv = vec2(clamp(fragTexCoord.x, texel.x, 1.0 - texel.x)*0.5 + fragExt.x*0.5, 1.0 - fragTexCoord.y);
  finalColor = vec4(texture(dusk, uv).rgb, 1.0);
}`;

/** 背景：竖向渐变 + 柔光 + 抖动防色带 */
export const BG_FS =
  COMMON +
  `
uniform vec3 top;
uniform vec3 bottom;
void main(){
  vec2 uv = fragTexCoord;
  vec3 c = mix(top, bottom, smoothstep(0.0, 1.0, uv.y));
  vec2 d = uv - vec2(0.35, 0.25);
  c += (top - bottom)*0.6*exp(-dot(d, d)*3.0);
  c += (hash(gl_FragCoord.xy) - 0.5)/200.0;
  finalColor = vec4(c, fragColor.a);
}`;
