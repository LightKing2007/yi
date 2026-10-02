/**
 * 极简的 WebGL2 批量四边形绘制器：所有东西（棋盘、棋子、特效、光影）都是带着色器的四边形。
 * 坐标用 CSS 像素，画布按设备像素比放大，着色器里的 fwidth 抗锯齿自然落在真实像素上。
 * 顶点：位置 xy、纹理坐标 uv、颜色 rgba（着色器里常把它当参数用）、额外四个数 ext。
 */
export type RGBA = readonly [number, number, number, number];
export type Blend = 'alpha' | 'add' | 'premul' | 'multiply' | 'replace' | 'bake';

const FLOATS = 12; // 每个顶点的浮点数
const MAXQ = 8192; // 一批最多几个四边形

export const VS_QUAD = `#version 300 es
in vec2 aPos; in vec2 aUV; in vec4 aCol; in vec4 aExt;
uniform vec4 uProj;
out vec2 fragTexCoord; out vec4 fragColor; out vec4 fragExt;
void main(){
  fragTexCoord = aUV; fragColor = aCol; fragExt = aExt;
  gl_Position = vec4(aPos.x*uProj.x + uProj.z, aPos.y*uProj.y + uProj.w, 0.0, 1.0);
}`;

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private g: Gfx,
    fs: string,
    vs = VS_QUAD,
  ) {
    const gl = g.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('着色器编译失败：' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 6).join('\n'));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    ['aPos', 'aUV', 'aCol', 'aExt'].forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败：' + gl.getProgramInfoLog(p));
    this.prog = p;
  }
  loc(name: string) {
    if (!this.locs.has(name)) this.locs.set(name, this.g.gl.getUniformLocation(this.prog, name));
    return this.locs.get(name)!;
  }
  /** 设 uniform（会先把已排队的四边形画掉） */
  set(name: string, v: number | ArrayLike<number>, kind: 'f' | 'i' = 'f') {
    const g = this.g,
      gl = g.gl;
    g.use(this);
    const l = this.loc(name);
    if (!l) return;
    if (typeof v === 'number') {
      kind === 'i' ? gl.uniform1i(l, v) : gl.uniform1f(l, v);
      return;
    }
    const a = v as Float32Array;
    if (kind === 'i') gl.uniform1iv(l, Int32Array.from(a));
    else if (a.length === 2) gl.uniform2fv(l, a);
    else if (a.length === 3) gl.uniform3fv(l, a);
    else gl.uniform4fv(l, a);
  }
}

export class Gfx {
  readonly gl: WebGL2RenderingContext;
  dpr = 1;
  w = 1;
  h = 1; // 当前目标的逻辑尺寸（CSS 像素）
  vw = 1;
  vh = 1; // 画布的逻辑尺寸（不随离屏贴图改变）
  private data = new Float32Array(MAXQ * 4 * FLOATS);
  private n = 0;
  private vbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private cur: Program | null = null;
  private blend: Blend | null = null;
  private m = [1, 0, 0, 1, 0, 0]; // 仿射变换 a b c d e f：x' = a x + c y + e，y' = b x + d y + f
  private stack: number[][] = [];
  private target: RenderTarget | null = null;
  private tex: (WebGLTexture | null)[] = [null, null, null, null];
  readonly white: WebGLTexture;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: WebGLContextAttributes = {},
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, ...opts });
    if (!gl) throw new Error('当前环境不支持 WebGL2');
    this.gl = gl;
    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    [
      [0, 2, 0],
      [1, 2, 8],
      [2, 4, 16],
      [3, 4, 32],
    ].forEach(([loc, size, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    });
    const ibo = gl.createBuffer()!; // 四边形的索引：MAXQ × 4 个顶点在 16 位之内
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const I = new Uint16Array(MAXQ * 6);
    for (let i = 0, v = 0; i < MAXQ * 6; i += 6, v += 4) {
      I[i] = v;
      I[i + 1] = v + 1;
      I[i + 2] = v + 2;
      I[i + 3] = v;
      I[i + 4] = v + 2;
      I[i + 5] = v + 3;
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  /** 画布按窗口大小与设备像素比调整；返回是否变了 */
  resize(cssW: number, cssH: number, dpr: number) {
    const pw = Math.max(1, Math.round(cssW * dpr)),
      ph = Math.max(1, Math.round(cssH * dpr));
    const changed = this.canvas.width !== pw || this.canvas.height !== ph || this.dpr !== dpr;
    if (changed) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.dpr = dpr;
    this.w = this.vw = cssW;
    this.h = this.vh = cssH;
    return changed;
  }

  /** 开始往屏幕（target 为空）或离屏贴图里画；w、h 为该目标的逻辑尺寸 */
  begin(target: RenderTarget | null = null, clear: RGBA | null = [0, 0, 0, 0]) {
    this.flush();
    const gl = this.gl;
    this.target = target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (target) {
      this.w = target.w;
      this.h = target.h;
      gl.viewport(0, 0, target.w, target.h);
    } else {
      this.w = this.canvas.width / this.dpr;
      this.h = this.canvas.height / this.dpr;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.disable(gl.SCISSOR_TEST);
    if (clear) {
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.cur = null;
    this.blend = null;
    this.setBlend('alpha');
  }

  end() {
    this.flush();
  }

  use(p: Program) {
    if (this.cur === p) return;
    this.flush();
    this.cur = p;
    const gl = this.gl;
    gl.useProgram(p.prog);
    const l = p.loc('uProj');
    // 离屏贴图里 y 向上存（读回时 v 翻转），屏幕上 y 向下
    if (this.target) gl.uniform4f(l, 2 / this.w, 2 / this.h, -1, -1);
    else gl.uniform4f(l, 2 / this.w, -2 / this.h, -1, 1);
  }

  setBlend(b: Blend) {
    if (this.blend === b) return;
    this.flush();
    this.blend = b;
    const gl = this.gl;
    gl.blendEquation(gl.FUNC_ADD);
    switch (b) {
      case 'alpha':
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'add':
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
        break;
      case 'premul':
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'multiply':
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
        break;
      case 'replace':
        gl.blendFunc(gl.ONE, gl.ZERO);
        break;
      case 'bake':
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
    }
  }

  bindTexture(unit: number, tex: WebGLTexture | null) {
    if (this.tex[unit] === tex) return;
    this.flush();
    this.tex[unit] = tex;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this.white);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---------------- 变换 ----------------
  push() {
    this.stack.push(this.m.slice());
  }
  pop() {
    const m = this.stack.pop();
    if (m) this.m = m;
  }
  translate(x: number, y: number) {
    const m = this.m;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }
  scale(sx: number, sy = sx) {
    const m = this.m;
    m[0] *= sx;
    m[1] *= sx;
    m[2] *= sy;
    m[3] *= sy;
  }
  rotate(deg: number) {
    const r = (deg * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r),
      m = this.m;
    const a = m[0] * c + m[2] * s,
      b = m[1] * c + m[3] * s,
      cc = m[0] * -s + m[2] * c,
      d = m[1] * -s + m[3] * c;
    m[0] = a;
    m[1] = b;
    m[2] = cc;
    m[3] = d;
  }
  /** 当前变换下的缩放倍数（近似） */
  get scaleNow() {
    return Math.hypot(this.m[0], this.m[1]);
  }

  /** 剪裁到矩形（逻辑坐标，按当前变换换算成外接矩形）；null 取消 */
  scissor(r: { x: number; y: number; w: number; h: number } | null) {
    this.flush();
    const gl = this.gl;
    if (!r) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const m = this.m,
      pts = [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x, r.y + r.h],
        [r.x + r.w, r.y + r.h],
      ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const x0 = Math.min(...pts.map(p => p[0])),
      x1 = Math.max(...pts.map(p => p[0]));
    const y0 = Math.min(...pts.map(p => p[1])),
      y1 = Math.max(...pts.map(p => p[1]));
    const k = this.target ? 1 : this.dpr,
      H = this.target ? this.target.h : this.canvas.height;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(x0 * k), Math.floor(H - y1 * k), Math.ceil((x1 - x0) * k) + 1, Math.ceil((y1 - y0) * k) + 1);
  }

  // ---------------- 四边形 ----------------
  /** 轴对齐四边形（经当前变换）：(x, y) 左上，uv 由 (u0, v0) 到 (u1, v1) */
  quad(x: number, y: number, w: number, h: number, c: RGBA, ext: RGBA = Z4, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    this.vert4(x, y, x + w, y, x + w, y + h, x, y + h, c, ext, u0, v0, u1, v1);
  }

  /** 以 (cx, cy) 为中心、旋转 deg 度的四边形 */
  quadC(cx: number, cy: number, w: number, h: number, deg: number, c: RGBA, ext: RGBA = Z4) {
    const r = (deg * Math.PI) / 180,
      co = Math.cos(r),
      si = Math.sin(r),
      hw = w / 2,
      hh = h / 2;
    const ax = -hw * co + hh * si,
      ay = -hw * si - hh * co; // 左上
    const bx = hw * co + hh * si,
      by = hw * si - hh * co; // 右上
    this.vert4(cx + ax, cy + ay, cx + bx, cy + by, cx - ax, cy - ay, cx - bx, cy - by, c, ext, 0, 0, 1, 1);
  }

  /** 渐变四边形：vertical 为 true 时自上（c0）而下（c1），否则自左而右 */
  quadGrad(x: number, y: number, w: number, h: number, c0: RGBA, c1: RGBA, vertical = true, ext: RGBA = Z4) {
    this.vert4(x, y, x + w, y, x + w, y + h, x, y + h, c0, ext, 0, 0, 1, 1, vertical ? [c0, c0, c1, c1] : [c0, c1, c1, c0]);
  }

  private vert4(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    c: RGBA,
    e: RGBA,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    cs?: RGBA[],
  ) {
    if (this.n >= MAXQ) this.flush();
    const m = this.m,
      d = this.data;
    let o = this.n * 4 * FLOATS,
      k = 0;
    const put = (x: number, y: number, u: number, v: number) => {
      const cc = cs ? cs[k++] : c;
      d[o] = m[0] * x + m[2] * y + m[4];
      d[o + 1] = m[1] * x + m[3] * y + m[5];
      d[o + 2] = u;
      d[o + 3] = v;
      d[o + 4] = cc[0];
      d[o + 5] = cc[1];
      d[o + 6] = cc[2];
      d[o + 7] = cc[3];
      d[o + 8] = e[0];
      d[o + 9] = e[1];
      d[o + 10] = e[2];
      d[o + 11] = e[3];
      o += FLOATS;
    };
    put(x0, y0, u0, v0);
    put(x1, y1, u1, v0);
    put(x2, y2, u1, v1);
    put(x3, y3, u0, v1);
    this.n++;
  }

  flush() {
    if (!this.n || !this.cur) {
      this.n = 0;
      return;
    }
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * 4 * FLOATS);
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_SHORT, 0);
    this.n = 0;
  }

  // ---------------- 离屏贴图 ----------------
  createTarget(w: number, h: number, old?: RenderTarget | null): RenderTarget {
    const gl = this.gl;
    if (old && old.w === w && old.h === h) return old;
    if (old) {
      gl.deleteFramebuffer(old.fbo);
      gl.deleteTexture(old.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.tex = [null, null, null, null];
    return { fbo, tex, w, h };
  }
}

export const Z4: RGBA = [0, 0, 0, 0];
export const WHITE: RGBA = [1, 1, 1, 1];
export const rgba = (r: number, g: number, b: number, a = 255): RGBA => [r / 255, g / 255, b / 255, a / 255];
