import { type VisualQuality, visualRatio } from './visual-state';

export class Panorama {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private revision = 0;
  private ready = false;
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement, interrupted: () => void) {
    const gl = canvas.getContext('webgl', { alpha: false, depth: false });
    if (!gl) throw new Error('Panorama view needs WebGL. The photo is still available in flat view.');
    this.gl = gl;
    const shader = (type: number, source: string): WebGLShader => {
      const result = gl.createShader(type)!; gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Panorama shader could not compile.');
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){ uv=p; gl_Position=vec4(p,0.,1.); }');
    const fragment = shader(gl.FRAGMENT_SHADER, `precision mediump float; varying vec2 uv;
      uniform sampler2D photo; uniform float aspect; uniform float yaw;
      void main(){ vec3 ray=normalize(vec3(uv.x*aspect*.65, uv.y*.65, 1.));
        float a=atan(ray.x,ray.z)+yaw; float b=asin(ray.y);
        gl_FragColor=texture2D(photo, vec2(fract(a/6.2831853+.5), .5-b/3.1415927)); }`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Panorama could not start.');
    gl.useProgram(this.program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.ready = false; this.lost = true; interrupted(); });
  }

  async load(url: string): Promise<void> {
    if (this.lost) throw new Error('Panorama graphics were interrupted.');
    const ticket = ++this.revision;
    const image = new Image(); image.src = url; await image.decode();
    if (this.lost) throw new Error('Panorama graphics were interrupted.');
    if (ticket !== this.revision) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB, this.gl.RGB, this.gl.UNSIGNED_BYTE, image);
    this.ready = true;
  }

  render(yaw: number, quality: VisualQuality = 'balanced'): void {
    if (!this.ready) return;
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = visualRatio(bounds.width, quality);
    const width = Math.max(1, Math.round(bounds.width * ratio)), height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const gl = this.gl; gl.viewport(0, 0, width, height); gl.useProgram(this.program);
    gl.uniform1f(gl.getUniformLocation(this.program, 'aspect'), width / height);
    gl.uniform1f(gl.getUniformLocation(this.program, 'yaw'), yaw);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.canvas.dataset.yaw = String(yaw);
  }
}
