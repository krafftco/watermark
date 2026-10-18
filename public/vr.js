/* Watermark in a headset. Three rooms built in the browser (WebXR): the long gallery, the rotunda, the night.
   The same room on a computer or phone: drag to look, click to go. In a headset: point (or look and pinch) and
   select; a photograph stands you before it, the floor takes you there. */
import * as THREE from '/vendor/three.module.min.js';

const D = window.__WM_VR || { items: [] };
const SPACE = D.space || 'gallery';
const host = document.querySelector('[data-xr-c]');
const card = document.querySelector('[data-xr-card]');
const loadEl = document.querySelector('[data-xr-load]');

// --- the renderer, the scene, the one who stands in it ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = SPACE === 'night' ? 1.0 : 1.08;
renderer.xr.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 400);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const EYE = 1.62; camera.position.set(0, EYE, 0);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// --- textures drawn here, so nothing is fetched but the photographs ---
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const pool = canvasTex(256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,236,200,.85)'); r.addColorStop(.45, 'rgba(255,228,190,.28)'); r.addColorStop(1, 'rgba(255,220,180,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
function parquet() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#2a1d14'; g.fillRect(0, 0, w, h);
    const pw = 64, ph = 256;
    for (let y = -ph; y < h + ph; y += pw) for (let x = -ph; x < w + ph; x += pw * 2) {
      for (const [dx, rot] of [[0, 1], [pw, -1]]) {
        g.save(); g.translate(x + dx + ((y / pw) % 2) * pw, y); g.rotate(rot * Math.PI / 4);
        const l = 44 + Math.random() * 8; g.fillStyle = `hsl(${25 + Math.random() * 4},${36 + Math.random() * 6}%,${l * 0.5}%)`;
        g.fillRect(0, 0, ph * 0.7, pw * 0.7); g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1.5; g.strokeRect(0, 0, ph * 0.7, pw * 0.7); g.restore();
      }
    }
  }, [6, 6]);
}
function marble() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#d9d2c6'; g.fillRect(0, 0, w, h);
    for (let r = 60; r < w * 0.72; r += 60) { g.strokeStyle = r % 120 ? 'rgba(120,100,80,.18)' : 'rgba(90,70,55,.32)'; g.lineWidth = r % 120 ? 2 : 6; g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(140,130,120,.10)'; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 220; y += (Math.random() - .5) * 220; g.lineTo(x, y); } g.stroke(); }
  });
}
function label(it) {
  return canvasTex(768, 256, (g, w, h) => {
    g.fillStyle = '#f3efe7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1714'; g.font = 'italic 44px Georgia, serif'; wrapText(g, it.title, 36, 74, w - 72, 50, 2);
    g.font = '28px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#4a443c'; g.fillText(it.maker || '', 36, 186);
    g.fillStyle = '#7d766b'; g.font = '22px "Helvetica Neue", Arial, sans-serif'; g.fillText([it.place, it.year].filter(Boolean).join(', '), 36, 226);
  });
}
function wrapText(g, text, x, y, max, lh, lines) {
  const words = String(text || '').split(' '); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(t).width > max && line) { g.fillText(n === lines - 1 ? line + '…' : line, x, y); n++; y += lh; line = words[i]; if (n >= lines) return; } else line = t;
  }
  if (n < lines) g.fillText(line, x, y);
}

// --- what can be stood on, and what can be stood before ---
const floors = [], works = [];
const loader = new THREE.TextureLoader();
let loaded = 0;
function hang(it, pos, yaw, longSide, opts = {}) {
  const r = (it.w || 3) / (it.h || 2);
  let w = r >= 1 ? longSide : longSide * r, h = r >= 1 ? longSide / r : longSide;
  if (h > (opts.maxH || 2.6)) { w *= (opts.maxH || 2.6) / h; h = opts.maxH || 2.6; }
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw;
  // the frame: a thin dark case, the photograph set into it
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), new THREE.MeshStandardMaterial({ color: opts.night ? 0x0b0a09 : 0x15120f, roughness: 0.6 }));
  frame.position.z = 0.025; g.add(frame);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1b1916 });
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); pic.position.z = 0.052; g.add(pic);
  // the light on it: a warm pool on the wall behind, larger in the night
  const s = opts.night ? 2.4 : 1.9;
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(w * s, h * s), new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: opts.night ? 0.55 : 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
  wash.position.z = 0.004; g.add(wash);
  if (!opts.noLabel) {
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.14), new THREE.MeshBasicMaterial({ map: label(it) }));
    lab.position.set(w / 2 + 0.38, 1.38 - pos.y, 0.01); // a museum label, beside the work at the height one reads it
    g.add(lab);
  }
  scene.add(g);
  loader.load(it.img, t => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
    if (++loaded >= Math.min(4, D.items.length)) loadEl.hidden = true;
  }, undefined, () => { if (++loaded >= Math.min(4, D.items.length)) loadEl.hidden = true; });
  pic.userData.work = it; pic.userData.group = g; works.push(pic);
  return g;
}

// --- the three rooms ---
const items = D.items.slice();
let start = { x: 0, z: 0, yaw: 0 };
function addFloor(mesh) { mesh.receiveShadow = false; floors.push(mesh); scene.add(mesh); }

function gallery() {
  scene.background = new THREE.Color(0x0c0b0a); scene.fog = new THREE.Fog(0x0c0b0a, 30, 120);
  const W = 11, H = 8, gap = 5.2, first = items.shift(), pairs = Math.ceil(items.length / 2), L = Math.max(26, pairs * gap + 12);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a3f37, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L + 4), new THREE.MeshStandardMaterial({ map: parquet(), roughness: 0.42, metalness: 0.05 }));
  floor.material.map.repeat.set(W / 4.5, (L + 4) / 4.5); floor.rotation.x = -Math.PI / 2; floor.position.z = -L / 2 + 2; addFloor(floor);
  for (const sx of [-1, 1]) { const wall = new THREE.Mesh(new THREE.PlaneGeometry(L + 4, H), wallMat); wall.rotation.y = sx * -Math.PI / 2; wall.position.set(sx * W / 2, H / 2, -L / 2 + 2); scene.add(wall); }
  const end = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); end.position.set(0, H / 2, -L); scene.add(end);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); back.rotation.y = Math.PI; back.position.set(0, H / 2, 4); scene.add(back);
  // dado and cornice: a dark band low on the walls, a pale line where the walls meet the vault
  for (const sx of [-1, 1]) {
    const dado = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, L + 4), new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 0.7 })); dado.position.set(sx * (W / 2 - 0.02), 0.45, -L / 2 + 2); scene.add(dado);
    const corn = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, L + 4), new THREE.MeshStandardMaterial({ color: 0xcfc4b2, roughness: 0.8 })); corn.position.set(sx * (W / 2 - 0.15), H - 0.12, -L / 2 + 2); scene.add(corn);
  }
  // the ceiling: pale plaster in coffers, a lantern of light running the length of the room
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, L + 4), new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.95 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, -L / 2 + 2); scene.add(ceil);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xbfb39f, roughness: 0.9 });
  for (let z = 4; z > -L - 1; z -= 3.4) { const beam = new THREE.Mesh(new THREE.BoxGeometry(W, 0.32, 0.22), beamMat); beam.position.set(0, H - 0.16, z); scene.add(beam); }
  for (const x of [-1.6, 1.6]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, L + 4), beamMat); rail.position.set(x, H - 0.16, -L / 2 + 2); scene.add(rail); }
  const lantern = new THREE.Mesh(new THREE.PlaneGeometry(3.0, L + 4), new THREE.MeshBasicMaterial({ color: 0xfff6e6 })); lantern.rotation.x = Math.PI / 2; lantern.position.set(0, H - 0.01, -L / 2 + 2); scene.add(lantern);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, L + 4), new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = Math.PI / 2; glow.position.set(0, H - 0.02, -L / 2 + 2); scene.add(glow);
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1d14, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 0.55); sun.position.set(0, 20, -L / 2); scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  // the destination at the far end, then the rest facing one another down the length
  if (first) hang(first, new THREE.Vector3(0, 2.15, -L + 0.06), 0, 3.6, { maxH: 3.6 });
  items.forEach((it, i) => { const side = i % 2 ? 1 : -1, z = -4 - Math.floor(i / 2) * gap; hang(it, new THREE.Vector3(side * (W / 2 - 0.06), 1.72, z), side * -Math.PI / 2, 2.2); });
  // two benches down the middle
  for (const z of [-L * 0.33, -L * 0.66]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 2.4), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.5 })); b.position.set(0, 0.21, z); scene.add(b); }
  start = { x: 0, z: 2, yaw: 0 };
}

function rotunda() {
  scene.background = new THREE.Color(0x0c0b0a);
  const n = items.length, R = Math.max(8, (n * 3.3) / (Math.PI * 2)), H = 7.5;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: marble(), roughness: 0.3, color: 0xb8afa2 })); floor.rotation.x = -Math.PI / 2; addFloor(floor);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x9c8a72, roughness: 0.95, side: THREE.BackSide })); wall.position.y = H / 2; scene.add(wall);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2 - 0.12), new THREE.MeshStandardMaterial({ color: 0xe3d9c8, roughness: 0.9, side: THREE.BackSide })); dome.position.y = H; scene.add(dome);
  // coffers: rings of dark recesses up the dome
  for (let ring = 1; ring <= 5; ring++) { const phi = ring * 0.24; const rr = R * Math.sin(Math.PI / 2 - phi), y = H + R * Math.cos(Math.PI / 2 - phi); const t = new THREE.Mesh(new THREE.TorusGeometry(rr * 0.995, 0.06, 6, 96), new THREE.MeshStandardMaterial({ color: 0xa89a84, roughness: 0.9 })); t.rotation.x = Math.PI / 2; t.position.y = y; scene.add(t); }
  const oculusR = R * Math.sin(0.12) + 0.3;
  const oculus = new THREE.Mesh(new THREE.CircleGeometry(oculusR, 64), new THREE.MeshBasicMaterial({ color: 0xfffaf0 })); oculus.rotation.x = Math.PI / 2; oculus.position.y = H + R * Math.cos(0.12) - 0.05; scene.add(oculus);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(oculusR, oculusR * 1.6, H + R - 0.2, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3dc, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); shaft.position.y = (H + R) / 2; scene.add(shaft);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(oculusR * 1.6, 64), new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); spot.rotation.x = -Math.PI / 2; spot.position.y = 0.01; scene.add(spot);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x3a3128, 1.05));
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.6); sun.position.set(0, 30, 0); scene.add(sun);
  items.forEach((it, i) => { const a = (i / n) * Math.PI * 2; const x = Math.sin(a) * (R - 0.06), z = -Math.cos(a) * (R - 0.06); hang(it, new THREE.Vector3(x, 1.75, z), -a, 2.1); });
  start = { x: 0, z: 0, yaw: 0 };
}

function night() {
  scene.background = new THREE.Color(0x030303); scene.fog = new THREE.FogExp2(0x030303, 0.045);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.18, metalness: 0.6 })); floor.rotation.x = -Math.PI / 2; addFloor(floor);
  scene.add(new THREE.AmbientLight(0xffffff, 0.08));
  // the photographs on a slow spiral outward, each turned to the centre, each in its own light
  items.forEach((it, i) => { const a = i * 0.9 - 0.2, r = 5 + i * 0.75; const x = Math.sin(a) * r, z = -Math.cos(a) * r; hang(it, new THREE.Vector3(x, 1.7, z), -a, 2.0, { night: true }); });
  start = { x: 0, z: 1.5, yaw: 0 };
}

({ gallery, rotunda, night }[SPACE] || gallery)();
rig.position.set(start.x, 0, start.z); rig.rotation.y = start.yaw;
if (!D.items.length) loadEl.textContent = 'Nothing hangs here yet.';

// --- going places: a glide on the screen, a step in the headset ---
let glide = null;
const ease = t => 1 - Math.pow(1 - t, 3);
const headYaw = () => { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); return e.y; };
function goTo(x, z, yaw, now) {
  const inXR = renderer.xr.isPresenting;
  if (inXR) {
    // stand the headset (not the rig's centre) on the spot, facing the way asked
    const ny = yaw == null ? rig.rotation.y : yaw - headYaw();
    const off = new THREE.Vector3(camera.position.x, 0, camera.position.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), ny);
    rig.rotation.y = ny; rig.position.set(x - off.x, 0, z - off.z); return;
  }
  glide = { t0: now || performance.now(), dur: 1300, from: rig.position.clone(), to: new THREE.Vector3(x, 0, z), y0: rig.rotation.y, y1: yaw == null ? rig.rotation.y : nearest(rig.rotation.y, yaw), p0: camera.rotation.x };
}
const nearest = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return from + d; };
function standBefore(pic) {
  const g = pic.userData.group, n = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion); n.y = 0; n.normalize();
  const p = g.position.clone().addScaledVector(n, 2.7);
  goTo(p.x, p.z, Math.atan2(-n.x, -n.z) + Math.PI);
}
const ray = new THREE.Raycaster();
function act(origin, dir) {
  ray.set(origin, dir);
  const hits = ray.intersectObjects(works.concat(floors), false);
  if (!hits.length) return;
  const h = hits[0];
  if (h.object.userData.work) standBefore(h.object);
  else if (floors.includes(h.object)) goTo(h.point.x, h.point.z, null);
}

// --- the screen: drag to look, click to go, keys to stroll ---
let yaw = rig.rotation.y, pitch = 0, down = null, moved = 0;
const el = renderer.domElement;
el.style.touchAction = 'none';
el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = 0; el.setPointerCapture(e.pointerId); });
el.addEventListener('pointermove', e => {
  if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy); down = { x: e.clientX, y: e.clientY };
  glide = null; rig.rotation.y += dx * 0.0042; camera.rotation.x = Math.max(-1.1, Math.min(1.1, camera.rotation.x + dy * 0.0036));
});
el.addEventListener('pointerup', e => {
  const was = down; down = null; if (!was || moved > 6) return;
  const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(p, camera); act(ray.ray.origin.clone(), ray.ray.direction.clone());
});
const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key === 'Escape' && D.href) location.href = D.href; });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// --- the headset: point and select, look and pinch ---
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
reticle.rotation.x = -Math.PI / 2; reticle.visible = false; scene.add(reticle);
const ctrls = [0, 1].map(i => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  line.scale.z = 6; line.visible = false; c.add(line); c.userData.line = line;
  c.addEventListener('connected', e => { c.userData.mode = e.data && e.data.targetRayMode; line.visible = c.userData.mode === 'tracked-pointer'; });
  c.addEventListener('disconnected', () => { line.visible = false; });
  c.addEventListener('select', () => {
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld), o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), d = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
    act(o, d);
  });
  rig.add(c); return c;
});

// --- the door to the headset ---
const go = document.querySelector('[data-xr-go]');
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if (!ok) return; go.hidden = false; document.querySelector('[data-xr-hs]').hidden = false;
    go.addEventListener('click', async () => {
      try {
        const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
        renderer.xr.setReferenceSpaceType('local-floor'); await renderer.xr.setSession(s);
        card.hidden = true; camera.rotation.x = 0;
        s.addEventListener('end', () => { card.hidden = false; camera.position.set(0, EYE, 0); });
      } catch (e) { go.textContent = 'The headset could not be opened'; }
    });
  }).catch(() => {});
}
document.querySelector('[data-xr-hide]').addEventListener('click', () => { card.hidden = true; const b = document.createElement('button'); b.className = 'xr-show'; b.type = 'button'; b.textContent = 'About this room'; b.onclick = () => { card.hidden = false; b.remove(); }; document.querySelector('[data-xr]').appendChild(b); });

// --- each frame ---
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, clock.getDelta());
  if (glide) {
    const t = Math.min(1, (now - glide.t0) / glide.dur), k = ease(t);
    rig.position.lerpVectors(glide.from, glide.to, k); rig.rotation.y = glide.y0 + (glide.y1 - glide.y0) * k; camera.rotation.x = glide.p0 * (1 - k);
    if (t >= 1) glide = null;
  }
  if (!renderer.xr.isPresenting) {
    const sp = (keys.shift ? 4.2 : 2.2) * dt; fwd.set(-Math.sin(rig.rotation.y), 0, -Math.cos(rig.rotation.y)); right.set(-fwd.z, 0, fwd.x);
    if (keys.w || keys.arrowup) rig.position.addScaledVector(fwd, sp); if (keys.s || keys.arrowdown) rig.position.addScaledVector(fwd, -sp);
    if (keys.a) rig.position.addScaledVector(right, -sp); if (keys.d) rig.position.addScaledVector(right, sp);
    if (keys.arrowleft) rig.rotation.y += 1.6 * dt; if (keys.arrowright) rig.rotation.y -= 1.6 * dt;
  } else {
    // a ring on the floor where a pointer would take you
    reticle.visible = false;
    for (const c of ctrls) {
      if (c.userData.mode !== 'tracked-pointer') continue;
      const m = new THREE.Matrix4().extractRotation(c.matrixWorld); ray.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(m));
      const h = ray.intersectObjects(works.concat(floors), false)[0];
      if (h) { c.userData.line.scale.z = h.distance; if (floors.includes(h.object)) { reticle.position.set(h.point.x, 0.01, h.point.z); reticle.visible = true; } } else c.userData.line.scale.z = 6;
    }
  }
  renderer.render(scene, camera);
});
