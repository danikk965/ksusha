class HeartGLRender {
  static get DURATION() { return 10; }

  constructor(el) {
    this.el = el;
    if (!this.el) throw new Error('Элемент canvas не найден или не передан в конструктор.');
    this.gl = this.el.getContext("webgl") || this.el.getContext("experimental-webgl");
    if (!this.gl) throw new Error('WebGL не поддерживается вашим браузером или отключён.');

    this.vertexShader = HeartGLRender.compileShader(this.gl, VERTEX, this.gl.VERTEX_SHADER);
    this.fragmentShader = HeartGLRender.compileShader(this.gl, FRAGMENT, this.gl.FRAGMENT_SHADER);
    this.program = HeartGLRender.createProgram(this.gl, [this.vertexShader, this.fragmentShader]);
    this.buffer = HeartGLRender.createBuffer(this.gl);
    this.widthHandler = this.gl.getUniformLocation(this.program, 'width');
    this.heightHandler = this.gl.getUniformLocation(this.program, 'height');
    this.positionHandler = HeartGLRender.createPositionHandler(this.gl, this.program);
    this.timeHandler = this.gl.getUniformLocation(this.program, 'time');

    this.resize();
    this.redraw();
    this.el.parentNode.toggleAttribute('loaded', true);
  }

  resize() {
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    this.el.width = width;
    this.el.height = height;
    this.gl.viewport(0, 0, width, height);
    this.gl.uniform1f(this.widthHandler, width);
    this.gl.uniform1f(this.heightHandler, height);
  }

  redraw() {
    const current = Date.now();
    const start = this.timeStart = this.timeStart || current;
    const time = (current - start) % (HeartGLRender.DURATION * 1000);
    this.time = time / 1000;
    this.gl.uniform1f(this.timeHandler, this.time);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  static compileShader(gl, shaderSource, shaderType) {
    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Ошибка компиляции шейдера: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  static createProgram(gl, shaders = []) {
    const program = gl.createProgram();
    shaders.forEach((shader) => gl.attachShader(program, shader));
    gl.linkProgram(program);
    gl.useProgram(program);
    return program;
  }

  static createBuffer(gl) {
    const bounds = new Float32Array([-1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, -1.0]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, bounds, gl.STATIC_DRAW);
    return buffer;
  }

  static createPositionHandler(gl, program) {
    const attributeLocation = gl.getAttribLocation(program, 'position');
    if (attributeLocation === -1) throw new Error('Атрибут "position" не найден в шейдере.');
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 2 * 4, 0);
    return attributeLocation;
  }
}

function ready(fn) {
  if (document.readyState !== 'loading') setTimeout(fn);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(fn));
}

ready(() => {
  const targets = Array.from(document.querySelectorAll('[data-canvas="heart"]'));
  const handlers = targets.map(el => new HeartGLRender(el));

  function drawLoop() {
    handlers.forEach(h => h.redraw());
    requestAnimationFrame(drawLoop);
  }
  drawLoop();

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => handlers.forEach(h => h.resize()), 100);
  }, false);
});

const VERTEX = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT = `
  precision highp float;
  uniform float time;
  uniform float width;
  uniform float height;
  vec2 resolution = vec2(width, height);
  #define POINT_COUNT 8
  vec2 points[POINT_COUNT];
  const float speed = -0.5;
  const float len = 0.3;
  float intensity = 1.5;
  float radius = 0.02;

  float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C){
    vec2 a = B - A;
    vec2 b = A - 2.0*B + C;
    vec2 c = a * 2.0;
    vec2 d = A - pos;
    float kk = 1.0 / dot(b,b);
    float kx = kk * dot(a,b);
    float ky = kk * (2.0*dot(a,a)+dot(d,b)) / 3.0;
    float kz = kk * dot(d,a);
    float res = 0.0;
    float p = ky - kx*kx;
    float p3 = p*p*p;
    float q = kx*(2.0*kx*kx-3.0*ky) + kz;
    float h = q*q + 4.0*p3;
    if(h >= 0.0){
      h = sqrt(h);
      vec2 x = (vec2(h, -h)-q)/2.0;
      vec2 uv = sign(x)*pow(abs(x), vec2(1.0/3.0));
      float t = uv.x+uv.y-kx;
      t = clamp(t, 0.0, 1.0);
      vec2 qos = d+(c+b*t)*t;
      res = length(qos);
    } else {
      float z = sqrt(-p);
      float v = acos(q/(p*z*2.0)) / 3.0;
      float m = cos(v);
      float n = sin(v)*1.732050808;
      vec3 t = vec3(m+m, -n-m, n-m) * z - kx;
      t = clamp(t, 0.0, 1.0);
      vec2 qos = d+(c+b*t.x)*t.x;
      float dis = dot(qos,qos);
      res = dis;
      qos = d+(c+b*t.y)*t.y;
      dis = dot(qos,qos);
      res = min(res,dis);
      qos = d+(c+b*t.z)*t.z;
      dis = dot(qos,qos);
      res = min(res,dis);
      res = sqrt(res);
    }
    return res;
  }

  vec2 getHeartPosition(float t){
    return vec2(16.0 * sin(t) * sin(t) * sin(t),
    -(13.0 * cos(t) - 5.0 * cos(2.0*t) - 2.0 * cos(3.0*t) - cos(4.0*t)));
  }

  float getGlow(float dist, float radius, float intensity){
    return pow(radius/dist, intensity);
  }

  float getSegment(float t, vec2 pos, float offset, float scale){
    for(int i = 0; i < POINT_COUNT; i++){
      points[i] = getHeartPosition(offset + float(i)*len + fract(speed * t) * 6.28);
    }
    vec2 c = (points[0] + points[1]) / 2.0;
    vec2 c_prev;
    float dist = 10000.0;
    for(int i = 0; i < POINT_COUNT-1; i++){
      c_prev = c;
      c = (points[i] + points[i+1]) / 2.0;
      dist = min(dist, sdBezier(pos, scale*c_prev, scale*points[i], scale*c));
    }
    return max(0.0, dist);
  }

  void main(){
    vec2 uv = gl_FragCoord.xy/resolution.xy;
    float widthHeightRatio = resolution.x/resolution.y;
    vec2 centre = vec2(0.5, 0.5);
    vec2 pos = centre - uv;
    pos.y /= widthHeightRatio;
    vec2 pos1 = pos + vec2(0.0, 0.3);
    vec2 pos2 = pos + vec2(0.0, -0.175);
    float scale1 = 0.00003 * height;
    float scale2 = 0.00005 * height;
    float t = time;
    vec3 col = vec3(0.0);
    float dist = getSegment(t, pos1, 0.0, scale1);
    float glow = getGlow(dist, radius, intensity);
    col += 10.0*vec3(smoothstep(0.003, 0.001, dist));
    col += glow * vec3(1.0,0.0,0.2);
    dist = getSegment(t, pos1, 3.0, scale1);
    glow = getGlow(dist, radius, intensity);
    col += 10.0*vec3(smoothstep(0.003, 0.001, dist));
    col += glow * vec3(1.0,0.0,0.2);
    dist = getSegment(t, pos2, 0.0, scale2);
    glow = getGlow(dist, radius, intensity);
    col += 10.0*vec3(smoothstep(0.003, 0.001, dist));
    col += glow * vec3(1.0,0.0,0.0);
    dist = getSegment(t, pos2, 3.4, scale2);
    glow = getGlow(dist, radius, intensity);
    col += 10.0*vec3(smoothstep(0.003, 0.001, dist));
    col += glow * vec3(1.0,0.0,0.0);
    col = 1.0 - exp(-col);
    col = pow(col, vec3(0.95));
    gl_FragColor = vec4(col,1.0);
  }
`;
