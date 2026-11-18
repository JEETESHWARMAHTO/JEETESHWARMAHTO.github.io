'use strict';

/* ============================================================
 * Paper-design mesh gradient background + opening animation
 * ------------------------------------------------------------
 * Vanilla WebGL port of the @paper-design/shaders MeshGradient
 * look (21st.dev "paper-design-shader-background"): flowing
 * 4-color pastel mesh + animated paper grain, kept light and
 * warm so it washes gently under the glassmorphism UI. Also
 * drives the intro splash.
 *
 * Layer order: #bg-shader canvas -> orbs -> glass UI -> modals
 * ============================================================ */

(function () {
  const canvas = document.getElementById('bg-shader');
  const intro = document.getElementById('intro');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seenIntro = false;
  try {
    seenIntro = sessionStorage.getItem('cb-intro') === '1';
  } catch {
    /* storage blocked - show it every time */
  }
  const noIntro = reduced || seenIntro || /(\?|&)nointro/.test(location.search);

  /* ---------------- intro sequencing ---------------- */
  if (intro) {
    if (noIntro) intro.remove();
    else {
      try {
        sessionStorage.setItem('cb-intro', '1');
      } catch {
        /* ignore */
      }
      // CSS plays the exit (starts at 1.55s, runs 0.75s) -> free the node after
      setTimeout(() => intro.remove(), 2500);
    }
  }

  if (!canvas) return;
  if (reduced) canvas.style.transition = 'none';

  const gl =
    canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }) ||
    canvas.getContext('experimental-webgl');

  if (!gl) {
    canvas.style.display = 'none'; // fallback: the CSS gradient behind it stays visible
    document.body.classList.add('shader-ready');
    return;
  }

  /* ---------------- shaders ---------------- */
  const VERT = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision highp float;
    varying vec2 v_uv;
    uniform vec2  u_res;
    uniform float u_time;
    uniform float u_speed;
    uniform float u_distortion;
    uniform float u_swirl;
    uniform vec3  u_c1;
    uniform vec3  u_c2;
    uniform vec3  u_c3;
    uniform vec3  u_c4;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.02 + vec2(1.7, 4.1);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = v_uv;
      uv.x *= u_res.x / max(u_res.y, 1.0);
      float t = u_time * u_speed;

      // pass 1: domain warp
      vec2 q = vec2(
        fbm(uv * 1.35 + vec2(0.0, t * 0.30)),
        fbm(uv * 1.35 + vec2(5.2, 1.3) - t * 0.24)
      );

      // swirl rotation around center (paper-design swirl param)
      float ang = u_swirl * (fbm(uv * 1.1 + q * 0.7 + t * 0.12) - 0.5) * 3.1416;
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 pr = rot * (uv - 0.5) + 0.5;

      // pass 2: second warp (paper-design distortion param)
      vec2 r = vec2(
        fbm(pr * 1.5 + u_distortion * q + vec2(1.7, 9.2) + t * 0.18),
        fbm(pr * 1.5 + u_distortion * q + vec2(8.3, 2.8) - t * 0.15)
      );
      float n = fbm(pr * 1.6 + u_distortion * r);

      // mix the four mesh colors (apricot / blush / cream-gold / peach)
      vec3 col = mix(u_c1, u_c2, smoothstep(0.12, 0.82, n + (q.x - 0.5) * 0.8));
      col = mix(col, u_c3, smoothstep(0.25, 0.9, r.y) * 0.85);
      col = mix(col, u_c4,
        smoothstep(0.35, 0.95, sin(q.y * 3.2 + n * 4.0 + t * 0.7) * 0.5 + 0.5) * 0.5);

      // settle on warm cream so glass panels + text stay readable
      col = mix(vec3(0.992, 0.988, 0.976), col * 0.9, 0.55);

      // animated paper grain (the "paper design" signature)
      float g = hash(gl_FragCoord.xy
        + vec2(fract(u_time * 7.0) * 137.0, fract(u_time * 5.0) * 91.0)) - 0.5;
      col += g * 0.045;

      // vignette (light - only a whisper at the corners)
      float vig = smoothstep(1.25, 0.35, length(v_uv - 0.5) * 1.55);
      col *= mix(0.93, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[shader]', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    canvas.style.display = 'none';
    document.body.classList.add('shader-ready');
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[shader]', gl.getProgramInfoLog(program));
    canvas.style.display = 'none';
    document.body.classList.add('shader-ready');
    return;
  }
  gl.useProgram(program);

  /* ---------------- geometry ---------------- */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /* ---------------- uniforms ---------------- */
  const U = (name) => gl.getUniformLocation(program, name);
  const uRes = U('u_res');
  const uTime = U('u_time');
  gl.uniform1f(U('u_speed'), 0.22); // paper-design speed
  gl.uniform1f(U('u_distortion'), 1.0); // paper-design distortion
  gl.uniform1f(U('u_swirl'), 0.8); // paper-design swirl
  gl.uniform3f(U('u_c1'), 1.0, 0.863, 0.682); // apricot     #ffdcae
  gl.uniform3f(U('u_c2'), 1.0, 0.851, 0.878); // blush       #ffd9e0
  gl.uniform3f(U('u_c3'), 0.969, 0.914, 0.769); // cream-gold  #f7e9c4
  gl.uniform3f(U('u_c4'), 0.957, 0.769, 0.659); // peach       #f4c4a8

  /* ---------------- sizing (DPR capped for perf) ---------------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * dpr));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  /* ---------------- render loop ---------------- */
  let raf = null;
  let elapsed = 0;
  let last = performance.now();
  let firstFrame = true;

  function frame(now) {
    raf = null;
    const dt = Math.min((now - last) / 1000, 0.05); // clamp gaps (tab switches)
    last = now;
    elapsed += dt;

    gl.uniform1f(uTime, elapsed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (firstFrame) {
      firstFrame = false;
      document.body.classList.add('shader-ready'); // triggers the settle-in transition
    }

    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (raf === null && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    } else {
      kick();
    }
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    canvas.style.display = 'none';
    document.body.classList.add('shader-ready');
  });

  if (reduced) {
    // reduced motion: one static frame, no animation
    gl.uniform1f(uTime, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    document.body.classList.add('shader-ready');
  } else {
    kick();
  }
})();
