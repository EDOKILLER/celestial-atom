// ATOMO CELESTE 1.5 - pagina 3D
// © 2026 Edoardo Battistel
import * as THREE from "three";
import { OrbitControls } from "../lib/OrbitControls.js";

const $ = (s) => document.querySelector(s);
const R = 100;                       // spessore di un guscio (unità della scena)
const SCALA_LOG = 90;                // unità per ogni fattore 10 di distanza
const SCALA_VERA = 800 / 1e5;        // la Via Lattea (100.000 anni luce) = 800 unità
const COLORI = {
  "Galassie": "#7fb2ff", "Nebulose a emissione": "#ff6b7d", "Nebulose a riflessione": "#7fd6ff",
  "Nebulose oscure": "#a08a70", "Nebulose planetarie": "#5fe0b0", "Resti di supernova": "#ff9d4d",
  "Altre nebulose": "#d68cff", "Ammassi aperti": "#ffe27a", "Ammassi globulari": "#ffb347",
  "Ammassi con nebulosa": "#ff8fc8", "Stelle": "#ffffff", "Altro": "#b0b0b0",
};
const NOMI_COST = {
  And: "Andromeda", Ori: "Orione", UMa: "Orsa Maggiore", UMi: "Orsa Minore", Cas: "Cassiopea", Cyg: "Cigno",
  Sco: "Scorpione", Sgr: "Sagittario", Leo: "Leone", Tau: "Toro", Gem: "Gemelli", Vir: "Vergine", Lyr: "Lira",
  Aql: "Aquila", Per: "Perseo", Peg: "Pegaso", CMa: "Cane Maggiore", Cen: "Centauro", Cru: "Croce del Sud",
  Boo: "Boote", Her: "Ercole", Dra: "Drago", Aur: "Auriga", Cep: "Cefeo", Crv: "Corvo", Oph: "Ofiuco",
};

// shader con la profondità logaritmica (serve per la scala vera: da pochi anni luce a miliardi)
function conProfondita(m) {
  if (!m.vertexShader.includes("logdepthbuf")) {
    m.vertexShader = "#include <common>\n#include <logdepthbuf_pars_vertex>\n" +
      m.vertexShader.replace(/(gl_Position\s*=[^;]+;)/, "$1\n#include <logdepthbuf_vertex>\n");
  }
  if (!m.fragmentShader.includes("logdepthbuf")) {
    m.fragmentShader = "#include <logdepthbuf_pars_fragment>\n" +
      m.fragmentShader.replace("void main() {", "void main() {\n#include <logdepthbuf_fragment>\n");
  }
  return m;
}
const SM = (o) => new THREE.ShaderMaterial(conProfondita({ ...o }));

let D, oggetti = [], stelle = [], gusci = [];
let vista = "gusci", movimento = "ruota", selezionato = null, lista = new Set();
let transizione = null;

// ------------------------------------------------------------------ scena
const canvas = $("#scena");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scena = new THREE.Scene();
scena.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1e9);
const controlli = new OrbitControls(camera, canvas);
controlli.enableDamping = true;
controlli.dampingFactor = 0.08;
controlli.minDistance = 0.05;
controlli.maxDistance = 5e6;
controlli.zoomSpeed = 1.4;

function dimensiona() {
  const w = innerWidth, h = innerHeight;
  // la grandezza mostrata deve essere quella della finestra anche con lo schermo ingrandito
  // (125 %, 150 %…): altrimenti il disegno risulta più grande e nomi e clic non coincidono
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  uniformi.uFocale.value = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
const uniformi = { uScala: { value: 1 }, uFocale: { value: 500 }, uMinPix: { value: 9 } };

// ------------------------------------------------------------------ posizioni
function direzione(ra, dec) {
  const a = THREE.MathUtils.degToRad(ra), d = THREE.MathUtils.degToRad(dec);
  return new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a));
}
function indiceGuscio(al) {
  for (let i = 0; i < gusci.length; i++) if (al <= gusci[i][0]) return i;
  return gusci.length - 1;
}
function raggio(al, v) {
  al = Math.max(al, 1);
  if (v === "gusci") {
    const i = indiceGuscio(al);
    const lo = i === 0 ? 1 : gusci[i - 1][0], hi = gusci[i][0];
    const f = Math.min(1, Math.max(0, (Math.log10(al) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))));
    return (i + 0.12 + 0.76 * f) * R;
  }
  if (v === "log") return SCALA_LOG * Math.log10(al);
  return al * SCALA_VERA;
}
function posizione(o, v) { return o.dir.clone().multiplyScalar(raggio(o.al, v)); }

// ------------------------------------------------------------------ immagini (billboard in istanze)
const VS = `
  attribute vec3 aPos; attribute float aSize; attribute vec2 aCella; attribute vec3 aColore; attribute float aVis;
  uniform float uScala, uFocale, uMinPix;
  varying vec2 vUv; varying vec2 vCella; varying vec3 vColore; varying float vVis;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    float dist = max(-mv.z, 1e-4);
    float s = max(aSize * uScala, uMinPix * dist / uFocale);
    s = min(s, 40.0 * uMinPix * dist / uFocale);          // mai enormi quando ci si avvicina
    mv.xy += position.xy * s;
    gl_Position = projectionMatrix * mv;
    vUv = uv; vCella = aCella; vColore = aColore; vVis = aVis;
  }`;
const FS_FOTO = `
  uniform sampler2D mappa; uniform float uCellaUV;
  varying vec2 vUv; varying vec2 vCella; varying vec3 vColore; varying float vVis;
  void main() {
    if (vVis < 0.5) discard;
    float r = length(vUv - 0.5);
    if (r > 0.5) discard;
    vec3 c = texture2D(mappa, vCella + vUv * uCellaUV).rgb;
    float anello = smoothstep(0.43, 0.47, r);
    gl_FragColor = vec4(mix(c * 1.15, vColore, anello * 0.85), 1.0);
  }`;
const FS_PUNTO = `
  varying vec2 vUv; varying vec2 vCella; varying vec3 vColore; varying float vVis;
  void main() {
    if (vVis < 0.5) discard;
    float r = length(vUv - 0.5);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColore * (0.35 + a), 1.0);
    if (a < 0.08) discard;
  }`;

const gruppiMesh = [];   // { mesh, oggetti: [...] }
const perId = [null];    // id del "colore-codice" -> oggetto (0 = niente)
const LIVELLO_PICK = 1;
const VS_PICK = VS.replace("attribute float aVis;", "attribute float aVis; attribute float aId; varying float vId;")
                  .replace("vVis = aVis;", "vVis = aVis; vId = aId;");
const FS_PICK = `varying vec2 vUv; varying float vVis; varying float vId; uniform float uBordo;
  void main() { if (vVis < 0.5) discard; if (length(vUv - 0.5) > uBordo) discard;
    gl_FragColor = vec4(mod(vId, 256.0), mod(floor(vId / 256.0), 256.0), floor(vId / 65536.0), 255.0) / 255.0; }`;
function creaMesh(lista, mappa) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("uv", base.getAttribute("uv"));
  const n = lista.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), cella = new Float32Array(n * 2);
  const col = new Float32Array(n * 3), vis = new Float32Array(n).fill(1), ids = new Float32Array(n);
  const cuv = 1 / D.per_lato;
  lista.forEach((o, i) => {
    o.slot = i;
    o.idPick = perId.length;
    perId.push(o);
    ids[i] = o.idPick;
    size[i] = o.size;
    if (o.cella >= 0) {
      cella[i * 2] = (o.cella % D.per_lato) * cuv;
      cella[i * 2 + 1] = 1 - (Math.floor(o.cella / D.per_lato) + 1) * cuv;
    }
    const c = new THREE.Color(COLORI[o.gruppo] || "#ccc");
    col.set([c.r, c.g, c.b], i * 3);
  });
  g.setAttribute("aPos", new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 1));
  g.setAttribute("aCella", new THREE.InstancedBufferAttribute(cella, 2));
  g.setAttribute("aColore", new THREE.InstancedBufferAttribute(col, 3));
  g.setAttribute("aVis", new THREE.InstancedBufferAttribute(vis, 1));
  g.setAttribute("aId", new THREE.InstancedBufferAttribute(ids, 1));
  g.instanceCount = n;
  const u = { ...uniformi };
  if (mappa) { u.mappa = { value: mappa }; u.uCellaUV = { value: cuv }; }
  const m = SM({ vertexShader: VS, fragmentShader: mappa ? FS_FOTO : FS_PUNTO, uniforms: u });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  scena.add(mesh);
  // copia invisibile per il clic: stessa forma, colore = codice dell'oggetto
  const mp = SM({ vertexShader: VS_PICK, fragmentShader: FS_PICK,
    uniforms: { ...uniformi, uBordo: { value: mappa ? 0.5 : 0.32 } } });
  const pick = new THREE.Mesh(g, mp);
  pick.frustumCulled = false;
  pick.layers.set(LIVELLO_PICK);
  scena.add(pick);
  const gm = { mesh, oggetti: lista };
  lista.forEach((o) => (o.gm = gm));
  gruppiMesh.push(gm);
}

// ------------------------------------------------------------------ stelle e costellazioni
let punteStelle, lineeCost, pickStelle;
function coloreStella(bv) {
  const t = Math.min(1, Math.max(0, (bv + 0.3) / 2.0));
  return new THREE.Color().setHSL(0.6 - 0.55 * t, 0.55 + 0.3 * t, 0.85 - 0.15 * t);
}
function creaStelle() {
  const n = stelle.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), dim = new Float32Array(n);
  stelle.forEach((s, i) => {
    const c = coloreStella(s.bv);
    col.set([c.r, c.g, c.b], i * 3);
    dim[i] = Math.max(2.5, Math.min(13, 9 - 1.3 * s.mag));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("colore", new THREE.BufferAttribute(col, 3));
  g.setAttribute("dim", new THREE.BufferAttribute(dim, 1));
  const m = SM({
    vertexShader: `attribute vec3 colore; attribute float dim; varying vec3 vC;
      void main() { vC = colore; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = dim; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main() { float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard; float a = pow(1.0 - r * 2.0, 1.6); gl_FragColor = vec4(vC * a * 1.4, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  punteStelle = new THREE.Points(g, m);
  punteStelle.frustumCulled = false;
  scena.add(punteStelle);
  const ids = new Float32Array(n);
  stelle.forEach((s, i) => { s.idPick = perId.length; perId.push(s); ids[i] = s.idPick; });
  g.setAttribute("aId", new THREE.BufferAttribute(ids, 1));
  pickStelle = new THREE.Points(g, SM({
    vertexShader: `attribute float dim; attribute float aId; varying float vId;
      void main() { vId = aId; gl_PointSize = max(dim, 9.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vId; void main() { if (length(gl_PointCoord - 0.5) > 0.5) discard;
      gl_FragColor = vec4(mod(vId, 256.0), mod(floor(vId / 256.0), 256.0), floor(vId / 65536.0), 255.0) / 255.0; }`,
  }));
  pickStelle.frustumCulled = false;
  pickStelle.layers.set(LIVELLO_PICK);
  scena.add(pickStelle);
  const nSeg = D.costellazioni.reduce((a, c) => a + c.seg.length, 0);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nSeg * 6), 3));
  lineeCost = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3d6cb8, transparent: true, opacity: 0.45 }));
  lineeCost.frustumCulled = false;
  scena.add(lineeCost);
}

// ------------------------------------------------------------------ gusci, anelli, Terra
const gruppoGusci = new THREE.Group();
scena.add(gruppoGusci);
let etichetteGusci = [];
const MAT_GUSCIO = SM({
  uniforms: { colore: { value: new THREE.Color(0x4f86d9) } },
  vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 colore; varying vec3 vN; varying vec3 vV; void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(colore, f * 0.22); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});
function numero(x, dec = 0) {          // formato italiano: 12.345,6
  const [i, d] = Math.abs(x).toFixed(dec).split(".");
  return (x < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d && +d ? "," + d.replace(/0+$/, "") : "");
}
function formatoAL(al) {
  if (al >= 1e9) return `${numero(al / 1e9, 1)} miliardi di anni luce`;
  if (al >= 1e6) return `${numero(al / 1e6, 1)} milioni di anni luce`;
  return `${numero(Math.round(al))} anni luce`;
}
function costruisciGusci() {
  gruppoGusci.clear();
  etichetteGusci = [];
  const sfere = [];
  if (vista === "gusci") {
    gusci.forEach(([lim, nome], i) => {
      sfere.push((i + 1) * R);
      etichetteGusci.push({ r: (i + 1) * R, testo: `${i + 1}. ${nome} · fino a ${formatoAL(lim)}` });
    });
  } else {
    const passi = vista === "log" ? [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10]
                                  : [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
    passi.forEach((al) => {
      const r = raggio(al, vista);
      sfere.push(r);
      etichetteGusci.push({ r, testo: formatoAL(al) });
    });
  }
  const geo = new THREE.SphereGeometry(1, 64, 32);
  sfere.forEach((r) => {
    const m = new THREE.Mesh(geo, MAT_GUSCIO);
    m.scale.setScalar(r);
    gruppoGusci.add(m);
    const cerchio = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, k) => new THREE.Vector3(Math.cos(k / 128 * 2 * Math.PI) * r, 0, Math.sin(k / 128 * 2 * Math.PI) * r))),
      new THREE.LineBasicMaterial({ color: 0x2a4a80, transparent: true, opacity: 0.5 }));
    gruppoGusci.add(cerchio);
  });
  gruppoGusci.visible = $("#c_gusci").checked;
}
// la Terra al centro: con la sua immagine se c'è (lib/terra.jpg), altrimenti blu
const terra = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0x3a7bd5 }));
new THREE.TextureLoader().load("./lib/terra.jpg", (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  terra.material = new THREE.MeshBasicMaterial({ map: t });
}, undefined, () => {});
terra.rotation.z = THREE.MathUtils.degToRad(23.4);
const alone = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 24), SM({
  vertexShader: MAT_GUSCIO.vertexShader,
  fragmentShader: `varying vec3 vN; varying vec3 vV; void main() { float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
    gl_FragColor = vec4(0.45, 0.75, 1.0, f * 0.9); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
terra.add(alone);
scena.add(terra);
const TERRA = { terra: true, nome: "Terra", comune: "Il nostro pianeta: qui siamo noi", al: 0, gruppo: "Terra", tipo: "pianeta",
  pos: new THREE.Vector3(), size: 2 };
TERRA.idPick = perId.length;
perId.push(TERRA);
const pickTerra = new THREE.Mesh(terra.geometry, new THREE.MeshBasicMaterial({
  color: new THREE.Color((TERRA.idPick % 256) / 255, (Math.floor(TERRA.idPick / 256) % 256) / 255, Math.floor(TERRA.idPick / 65536) / 255) }));
pickTerra.layers.set(LIVELLO_PICK);
terra.add(pickTerra);
function scalaTerra() { }          // la grandezza della Terra viene calcolata a ogni fotogramma

// ------------------------------------------------------------------ evidenziazione
const anelloSel = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.7, 64),
  new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, depthTest: false }));
anelloSel.visible = false;
anelloSel.renderOrder = 10;
scena.add(anelloSel);

// ------------------------------------------------------------------ aggiornamento posizioni
function applicaPosizioni(t) {
  for (const gm of gruppiMesh) {
    const a = gm.mesh.geometry.getAttribute("aPos");
    for (const o of gm.oggetti) {
      const p = t >= 1 ? o.dest : o.orig.clone().lerp(o.dest, t);
      o.pos = p;
      a.setXYZ(o.slot, p.x, p.y, p.z);
    }
    a.needsUpdate = true;
  }
  const ps = punteStelle.geometry.getAttribute("position");
  stelle.forEach((s, i) => {
    s.pos = t >= 1 ? s.dest : s.orig.clone().lerp(s.dest, t);
    ps.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
  });
  ps.needsUpdate = true;
  const pl = lineeCost.geometry.getAttribute("position");
  let k = 0;
  for (const c of D.costellazioni) for (const [i, j] of c.seg) {
    const a = stelle[i].pos, b = stelle[j].pos;
    pl.setXYZ(k++, a.x, a.y, a.z);
    pl.setXYZ(k++, b.x, b.y, b.z);
  }
  pl.needsUpdate = true;
}
function cambiaVista(v, animata = true) {
  const prima = vista;
  vista = v;
  document.querySelectorAll("#viste button").forEach((b) => b.classList.toggle("attivo", b.dataset.vista === v));
  for (const o of oggetti) { o.orig = o.pos ? o.pos.clone() : posizione(o, v); o.dest = posizione(o, v); }
  for (const s of stelle) { s.orig = s.pos ? s.pos.clone() : posizione(s, v); s.dest = posizione(s, v); }
  costruisciGusci();
  scalaTerra();
  aggiornaAiuto();
  if (animata && prima !== v) {
    transizione = { inizio: performance.now(), durata: 1600 };
    // la camera si allontana o si avvicina in proporzione alla nuova scala
    const fattore = raggioTipico(v) / raggioTipico(prima);
    camTransizione = { da: camera.position.clone(), a: camera.position.clone().multiplyScalar(fattore),
      tda: controlli.target.clone(), ta: selezionato ? null : new THREE.Vector3() };
  } else applicaPosizioni(1);
}
let camTransizione = null;
function raggioTipico(v) { return v === "gusci" ? 800 : v === "log" ? 900 : 800; }

// ------------------------------------------------------------------ filtri
function visibile(o) {
  if (!gruppiAttivi.has(o.gruppo)) return false;
  if ($("#c_misurate").checked && o.stato !== 0) return false;
  return true;
}
const gruppiAttivi = new Set(Object.keys(COLORI));
function applicaFiltri() {
  for (const gm of gruppiMesh) {
    const a = gm.mesh.geometry.getAttribute("aVis");
    for (const o of gm.oggetti) a.setX(o.slot, visibile(o) ? 1 : 0);
    a.needsUpdate = true;
  }
  punteStelle.visible = $("#c_stelle").checked;
  lineeCost.visible = $("#c_cost").checked && $("#c_stelle").checked;
  gruppoGusci.visible = $("#c_gusci").checked;
}

// ------------------------------------------------------------------ selezione con il mouse
// Ogni oggetto è disegnato anche in un'immagine invisibile con un colore che è il suo codice:
// il pixel sotto il mouse dice esattamente quale oggetto si vede lì (davanti agli altri).
const v3 = new THREE.Vector3();
const rtPunto = new THREE.WebGLRenderTarget(1, 1);
const pixel = new Uint8Array(4);
const NERO = new THREE.Color(0, 0, 0);
function disegnaCodici(destinazione) {
  const sfondo = scena.background, colore = renderer.getClearColor(new THREE.Color()), alfa = renderer.getClearAlpha();
  scena.background = NERO;
  camera.layers.set(LIVELLO_PICK);
  renderer.setRenderTarget(destinazione);
  renderer.setClearColor(NERO, 1);
  renderer.clear();
  renderer.render(scena, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(colore, alfa);
  camera.layers.set(0);
  scena.background = sfondo;
}
function trovaSotto(x, y) {
  const w = innerWidth, h = innerHeight;
  pickStelle.visible = punteStelle.visible;
  camera.setViewOffset(w, h, Math.floor(x), Math.floor(y), 1, 1);
  disegnaCodici(rtPunto);
  camera.clearViewOffset();
  renderer.readRenderTargetPixels(rtPunto, 0, 0, 1, 1, pixel);
  const id = pixel[0] + pixel[1] * 256 + pixel[2] * 65536;
  return perId[id] || null;
}
let ultimoMovimento = 0;
canvas.addEventListener("pointermove", (e) => {
  const ora = performance.now();
  if (ora - ultimoMovimento < 60 || e.buttons) { if (e.buttons) $("#suggerimento").style.display = "none"; return; }
  ultimoMovimento = ora;
  const o = trovaSotto(e.clientX, e.clientY);
  const t = $("#suggerimento");
  if (o) {
    t.innerHTML = o.terra ? "<b>Terra</b><br><small>il nostro pianeta, al centro di tutto</small>"
      : `<b>${o.nome}</b>${o.comune ? " · " + o.comune.split(",")[0] : ""}<br><small>${o.tipo} · ${formatoAL(o.al)}${o.stato ? " (stimata)" : ""}</small>`;
    t.style.left = e.clientX + 16 + "px";
    t.style.top = e.clientY + 12 + "px";
    t.style.display = "block";
    canvas.style.cursor = "pointer";
  } else { t.style.display = "none"; canvas.style.cursor = ""; }
});
let giu = null;
canvas.addEventListener("pointerdown", (e) => (giu = { x: e.clientX, y: e.clientY }));
canvas.addEventListener("pointerup", (e) => {
  if (!giu || Math.hypot(e.clientX - giu.x, e.clientY - giu.y) > 5) return;
  const o = trovaSotto(e.clientX, e.clientY);
  if (o) seleziona(o);
});
canvas.addEventListener("dblclick", (e) => { const o = trovaSotto(e.clientX, e.clientY); if (o) { seleziona(o); volaA(o); } });

// ------------------------------------------------------------------ volo verso un oggetto
let volo = null;
function volaA(o) {
  const dist = o.terra ? 14 : Math.max(o.size ? o.size * uniformi.uScala.value * 4 : 4, 3);
  const dirCam = o.terra ? camera.position.clone().normalize() : o.pos.clone().normalize();
  const arrivo = o.pos.clone().sub(dirCam.multiplyScalar(dist));
  volo = { inizio: performance.now(), durata: 1800, da: camera.position.clone(), a: arrivo,
    tda: controlli.target.clone(), ta: o.pos.clone() };
}
function tornaInizio() {
  selezionato = null;
  anelloSel.visible = false;
  $("#dx").style.display = "none";
  const a = vista === "vera" ? new THREE.Vector3(0, 300, 1300) : new THREE.Vector3(0, 380, 1450);
  volo = { inizio: performance.now(), durata: 1500, da: camera.position.clone(), a,
    tda: controlli.target.clone(), ta: new THREE.Vector3() };
}

// ------------------------------------------------------------------ scheda
function seleziona(o) {
  selezionato = o;
  anelloSel.visible = true;
  $("#dx").style.display = "block";
  const nomeGuscio = o.terra ? "" : gusci[indiceGuscio(o.al)][1];
  let nota = "";
  if (o.stato === 2) nota = `<div class="nota">⚠️ Distanza non nota: posizione stimata dal tipo di oggetto (${formatoAL(o.al)} è un valore tipico).</div>`;
  else if (o.stato === 1) nota = `<div class="nota">⚠️ Distanza non misurata: ${o.fonte.replace("stimata: ", "")}, quindi alla stessa distanza.</div>`;
  if (o.terra) {
    $("#scheda").innerHTML = `<h3>🌍 Terra</h3><div class="comune">Il nostro pianeta: il nucleo dell'atomo</div>
      <p style="font-size:.92em">Tutto è disposto attorno a noi come lo vediamo dalla Terra: ogni oggetto sta
      nella sua direzione vera nel cielo, a una distanza che dipende dalla vista scelta.</p>
      <table><tr><td>Il Sole</td><td>a 8,3 minuti luce (150 milioni di km): a questa scala coincide con la Terra</td></tr>
      <tr><td>Stella più vicina</td><td>Proxima Centauri, 4,24 anni luce</td></tr>
      <tr><td>Centro della Via Lattea</td><td>circa 26.000 anni luce, nel Sagittario</td></tr>
      <tr><td>Galassia di Andromeda</td><td>circa 2,5 milioni di anni luce</td></tr></table>
      <div class="bottoni" style="margin-top:10px"><button id="b_vai">🎯 Vai</button><button id="b_wiki">🌐 Wikipedia</button></div>`;
    $("#b_vai").onclick = () => volaA(o);
    $("#b_wiki").onclick = () => window.open("https://it.wikipedia.org/wiki/Terra", "_blank");
    return;
  }
  if (o.stella) {
    $("#scheda").innerHTML = `<h3>✨ ${o.nome}</h3><div class="comune">Stella${o.hr ? " · HR " + o.hr : ""}</div>${nota}
      <table><tr><td>Distanza</td><td>${formatoAL(o.al)}${o.stato ? "" : " (parallasse)"}</td></tr>
      <tr><td>Guscio</td><td>${indiceGuscio(o.al) + 1}. ${nomeGuscio}</td></tr>
      <tr><td>Magnitudine</td><td>${numero(o.mag, 2)}</td></tr>
      <tr><td>Coordinate</td><td>AR ${o.ra.toFixed(3)}° · Dec ${o.dec >= 0 ? "+" : ""}${o.dec.toFixed(3)}°</td></tr></table>
      <div class="bottoni" style="margin-top:10px"><button id="b_vai">🎯 Vai</button>
      <button id="b_wiki">🌐 Wikipedia</button></div>`;
  } else {
    const inLista = lista.has(o.nome);
    $("#scheda").innerHTML = `${o.cella >= 0 ? `<img src="./foto/${encodeURIComponent(o.id)}.jpg" alt="">` : ""}
      <h3>${o.nome}</h3><div class="comune">${o.comune || ""}</div>${nota}
      <table>
      <tr><td>Tipo</td><td>${o.tipo}</td></tr>
      <tr><td>Distanza</td><td>${formatoAL(o.al)}${o.stato === 0 ? `<br><small style="color:#9aa8c4">${o.fonte}</small>` : ""}</td></tr>
      <tr><td>Guscio</td><td>${indiceGuscio(o.al) + 1}. ${nomeGuscio}</td></tr>
      ${o.cost ? `<tr><td>Costellazione</td><td>${NOMI_COST[o.cost] || o.cost}</td></tr>` : ""}
      <tr><td>Coordinate</td><td>AR ${o.ra.toFixed(4)}° · Dec ${o.dec >= 0 ? "+" : ""}${o.dec.toFixed(4)}°</td></tr>
      ${o.mag != null ? `<tr><td>Magnitudine</td><td>${numero(Number(o.mag), 2)}</td></tr>` : ""}
      ${o.dim ? `<tr><td>Dimensione</td><td>${numero(Number(o.dim), 1)}′</td></tr>` : ""}
      ${o.altri ? `<tr><td>Altri nomi</td><td>${o.altri}</td></tr>` : ""}
      </table>
      <div class="bottoni" style="margin-top:10px">
        <button id="b_lista">${inLista ? "★ Togli dalla lista" : "⭐ Lista da cercare"}</button>
        <button id="b_cerca">🔍 Cerca i FITS</button>
        <button id="b_vai">🎯 Vai</button>
        <button id="b_wiki">🌐 Wikipedia</button>
      </div><div id="msg" style="color:#9aa8c4;font-size:.85em;margin-top:6px"></div>`;
    $("#b_lista").onclick = async () => {
      const r = await (await fetch("./api/lista", { method: "POST", body: JSON.stringify(o) })).json();
      if (r.errore) { $("#msg").textContent = r.errore; return; }
      r.dentro ? lista.add(o.nome) : lista.delete(o.nome);
      seleziona(o);
      $("#msg").textContent = r.dentro ? "Aggiunto: lo trovi in Ricerca archivi FITS, tendina «Da cercare»." : "Tolto dalla lista.";
    };
    $("#b_cerca").onclick = async () => {
      const r = await (await fetch("./api/cerca", { method: "POST", body: JSON.stringify(o) })).json();
      $("#msg").textContent = r.errore || "Apro Ricerca archivi FITS…";
    };
  }
  $("#b_vai").onclick = () => volaA(o);
  $("#b_wiki").onclick = () => window.open("https://it.wikipedia.org/w/index.php?search=" +
    encodeURIComponent((o.comune && o.comune.split(",")[0]) || o.nome), "_blank");
}
$("#chiudi").onclick = () => { $("#dx").style.display = "none"; selezionato = null; anelloSel.visible = false; };

// ------------------------------------------------------------------ ricerca per nome
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s\-_.]+/g, "");
$("#cerca").addEventListener("input", () => {
  const q = norm($("#cerca").value);
  const out = $("#risultati");
  out.innerHTML = "";
  if (q.length < 2) return;
  const trovati = [];
  for (const o of [...oggetti, ...stelle]) {
    const k = o.chiave || (o.chiave = norm(o.nome) + "|" + norm(o.comune) + "|" + norm(o.altri));
    if (k.includes(q)) {
      const esatto = norm(o.nome) === q ? 2 : k.startsWith(q) ? 1 : 0;
      trovati.push([esatto, o.imp || 0, o]);
    }
  }
  trovati.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [, , o] of trovati.slice(0, 12)) {
    const d = document.createElement("div");
    d.innerHTML = `${o.stella ? "✨" : `<span class="pallino" style="background:${COLORI[o.gruppo]}"></span>`} ${o.nome}
      <small>${o.comune ? o.comune.split(",")[0] + " · " : ""}${formatoAL(o.al)}</small>`;
    d.onclick = () => { seleziona(o); volaA(o); };
    out.appendChild(d);
  }
});

// ------------------------------------------------------------------ nomi sullo schermo
// Un nome compare solo se il suo oggetto si vede davvero in quel punto (controllato
// nell'immagine dei codici, a un quarto della risoluzione, 4 volte al secondo),
// e sta subito sotto il bordo dell'immagine.
const contEtichette = $("#etichette");
const pool = [];
function etichetta(i) {
  if (!pool[i]) { const d = document.createElement("div"); d.className = "etichetta"; contEtichette.appendChild(d); pool[i] = d; }
  return pool[i];
}
let candidatiNomi = [];
const RID = 4;
let rtPiccolo = null, codici = null, ultimiCodici = 0, lPic = 0, hPic = 0;
function aggiornaCodici() {
  const w = Math.max(1, Math.floor(innerWidth / RID)), h = Math.max(1, Math.floor(innerHeight / RID));
  if (!rtPiccolo || w !== lPic || h !== hPic) {
    rtPiccolo?.dispose();
    rtPiccolo = new THREE.WebGLRenderTarget(w, h);
    codici = new Uint8Array(w * h * 4);
    lPic = w; hPic = h;
  }
  pickStelle.visible = punteStelle.visible;
  disegnaCodici(rtPiccolo);
  renderer.readRenderTargetPixels(rtPiccolo, 0, 0, w, h, codici);
}
function siVede(o, sx, sy) {
  if (!codici) return true;
  const cx = Math.floor(sx / RID), cy = hPic - 1 - Math.floor(sy / RID);
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= lPic || y >= hPic) continue;
    const k = (y * lPic + x) * 4;
    if (codici[k] + codici[k + 1] * 256 + codici[k + 2] * 65536 === o.idPick) return true;
  }
  return false;
}
function raggioSchermo(o) {
  const dist = Math.max(camera.position.distanceTo(o.pos), 1e-4), f = uniformi.uFocale.value, m = uniformi.uMinPix.value;
  if (o.stella) return 4;
  let s = Math.max(o.size * uniformi.uScala.value, m * dist / f);
  s = Math.min(s, 40 * m * dist / f);
  return s * f / dist / 2;
}
function aggiornaEtichette(ora) {
  if (ora - ultimiCodici > 250 && $("#c_nomi").checked) { aggiornaCodici(); ultimiCodici = ora; }
  let n = 0;
  const w = innerWidth, h = innerHeight;
  const mostra = (p, testo, classe, dy) => {
    v3.copy(p).project(camera);
    if (v3.z > 1 || v3.z < -1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) return false;
    const e = etichetta(n++);
    e.textContent = testo;
    e.className = "etichetta " + classe;
    e.style.left = ((v3.x + 1) / 2 * w) + "px";
    e.style.top = ((1 - v3.y) / 2 * h + dy) + "px";
    e.style.display = "block";
    return true;
  };
  if ($("#c_gusci").checked) {
    const su = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    let yPrec = Infinity;
    for (const g of etichetteGusci) {
      const p = su.clone().multiplyScalar(g.r);
      v3.copy(p).project(camera);
      const sy = (1 - v3.y) / 2 * h;
      if (yPrec - sy < 20) continue;
      if (mostra(p, g.testo, "guscio", -22)) yPrec = sy;
    }
  }
  if ($("#c_nomi").checked) {
    // la Terra
    v3.copy(TERRA.pos).project(camera);
    const rt = terra.scale.x * uniformi.uFocale.value / Math.max(camera.position.length(), 1e-3);
    mostra(TERRA.pos, "🌍 Terra", "terra", rt + 4);                 // il nome della Terra sempre visibile
    const occupati = [];
    let k = 0;
    for (const o of candidatiNomi) {
      if (k > 45) break;
      if (o.stella ? !punteStelle.visible : !visibile(o)) continue;
      v3.copy(o.pos).project(camera);
      if (v3.z > 1 || v3.z < -1) continue;
      const sx = (v3.x + 1) / 2 * w, sy = (1 - v3.y) / 2 * h;
      if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
      if (!siVede(o, sx, sy)) continue;                 // coperto da un'altra immagine o nascosto
      const r = raggioSchermo(o);
      const yt = sy + r + 2;
      if (occupati.some(([x, y]) => Math.abs(x - sx) < 70 && Math.abs(y - yt) < 18)) continue;
      occupati.push([sx, yt]);
      mostra(o.pos, o.comune ? o.comune.split(",")[0] : o.nome, o.stella ? "cost" : "", r + 2);
      k++;
    }
  }
  for (let i = n; i < pool.length; i++) pool[i].style.display = "none";
}

// ------------------------------------------------------------------ volo libero
const tasti = new Set();
addEventListener("keydown", (e) => { if (e.target.tagName !== "INPUT") tasti.add(e.key.toLowerCase()); });
addEventListener("keyup", (e) => tasti.delete(e.key.toLowerCase()));
addEventListener("blur", () => tasti.clear());
let trascina = null;
canvas.addEventListener("pointerdown", (e) => { if (movimento === "vola") { trascina = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener("pointermove", (e) => {
  if (movimento !== "vola" || !trascina || !e.buttons) return;
  const dx = e.clientX - trascina.x, dy = e.clientY - trascina.y;
  trascina = { x: e.clientX, y: e.clientY };
  const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  eul.y -= dx * 0.004;
  eul.x = Math.max(-1.55, Math.min(1.55, eul.x - dy * 0.004));
  camera.quaternion.setFromEuler(eul);
});
canvas.addEventListener("pointerup", () => (trascina = null));
let velocitaVolo = 1;
canvas.addEventListener("wheel", (e) => {
  if (movimento !== "vola") return;
  e.preventDefault();
  velocitaVolo = Math.min(50, Math.max(0.05, velocitaVolo * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
  aggiornaAiuto();
}, { passive: false });
function muoviVolo(dt) {
  const v = new THREE.Vector3();
  if (tasti.has("w") || tasti.has("arrowup")) v.z -= 1;
  if (tasti.has("s") || tasti.has("arrowdown")) v.z += 1;
  if (tasti.has("a") || tasti.has("arrowleft")) v.x -= 1;
  if (tasti.has("d") || tasti.has("arrowright")) v.x += 1;
  if (tasti.has("e") || tasti.has(" ")) v.y += 1;
  if (tasti.has("q")) v.y -= 1;
  if (!v.lengthSq()) return;
  // più lontano dalla Terra = più veloce (così non si passano ore nel vuoto)
  const base = Math.max(2, camera.position.length() * 0.35) * velocitaVolo * (tasti.has("shift") ? 4 : 1);
  v.normalize().multiplyScalar(base * dt).applyQuaternion(camera.quaternion);
  camera.position.add(v);
}
function impostaMovimento(m) {
  movimento = m;
  lasciaTuttiTasti();
  document.querySelectorAll("#movimenti button[data-mov]").forEach((b) => b.classList.toggle("attivo", b.dataset.mov === m));
  controlli.enabled = m === "ruota";
  if (m === "ruota") {
    const avanti = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controlli.target.copy(camera.position.clone().add(avanti.multiplyScalar(Math.max(5, camera.position.length() * 0.3))));
    if (selezionato) controlli.target.copy(selezionato.pos);
  }
  aggiornaAiuto();
}
function aggiornaAiuto() {
  $("#aiuto").innerHTML = movimento === "ruota"
    ? "🔄 Trascina o ◀ ▶ ▲ ▼ per ruotare · frecce <kbd>↑</kbd><kbd>↓</kbd> avanti/indietro, <kbd>←</kbd><kbd>→</kbd> di lato (<kbd>Shift</kbd> più veloce) · rotellina, <kbd>+</kbd><kbd>−</kbd> o <kbd>Pag↑</kbd><kbd>Pag↓</kbd> per avvicinarti · <kbd>Inizio</kbd> 🏠 · clic: scheda · doppio clic: ci voli"
    : `🚀 Pulsanti: ＋ avanti, − indietro, frecce per girarti · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o frecce per volare · <kbd>E</kbd>/<kbd>Q</kbd> su/giù · <kbd>Shift</kbd> più veloce · trascina per guardarti attorno · rotellina: velocità ×${velocitaVolo.toFixed(2)}`;
}

// ------------------------------------------------------------------ pulsanti (portatile senza mouse)
// Tenere premuto un pulsante = movimento continuo. Funzionano anche + e - sulla tastiera.
const premuti = new Set();
document.querySelectorAll("#comandi button[data-c]").forEach((b) => {
  const c = b.dataset.c;
  const giu = (e) => { e.preventDefault(); premuti.add(c); b.classList.add("attivo"); };
  const su = () => { premuti.delete(c); b.classList.remove("attivo"); };
  b.addEventListener("pointerdown", giu);
  b.addEventListener("pointerup", su);
  b.addEventListener("pointerleave", su);
  b.addEventListener("pointercancel", su);
});
// Tastiera (1.5): + − e Pag↑ Pag↓ avvicinano e allontanano, Inizio = 🏠.
// Le frecce SPOSTANO (avanti/indietro, sinistra/destra) in entrambe le modalità:
// in Ruota si sposta anche il centro di rotazione (vedi muoviFrecce); la rotazione resta
// ai pulsanti ◀ ▶ ▲ ▼ sullo schermo e al trascinamento con il mouse/trackpad.
const ZOOM = { PageUp: "piu", PageDown: "meno" };
const tastoPulsante = {};          // comando -> pulsante sullo schermo (si illumina mentre il tasto è premuto)
document.querySelectorAll("#comandi button[data-c]").forEach((b) => (tastoPulsante[b.dataset.c] = b));
const daTastiera = new Set();
function premiDaTastiera(c) { premuti.add(c); daTastiera.add(c); tastoPulsante[c]?.classList.add("attivo"); }
function lasciaDaTastiera(c) { premuti.delete(c); daTastiera.delete(c); tastoPulsante[c]?.classList.remove("attivo"); }
function lasciaTuttiTasti() { [...daTastiera].forEach(lasciaDaTastiera); }
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === "+" || e.key === "=") premiDaTastiera("piu");
  if (e.key === "-") premiDaTastiera("meno");
  if (e.key === "Home") { e.preventDefault(); tornaInizio(); return; }
  if (ZOOM[e.key]) { e.preventDefault(); premiDaTastiera(ZOOM[e.key]); }
  if (e.key.startsWith("Arrow")) e.preventDefault();    // niente scorrimento della pagina
});
addEventListener("keyup", (e) => {
  if (e.key === "+" || e.key === "=") lasciaDaTastiera("piu");
  if (e.key === "-") lasciaDaTastiera("meno");
  if (ZOOM[e.key]) lasciaDaTastiera(ZOOM[e.key]);
});
addEventListener("blur", lasciaTuttiTasti);
// Ruota + frecce: camera e centro di rotazione si spostano insieme, nella direzione in cui
// si guarda (↑ avanti, ↓ indietro) o di lato (← →). Shift = 3 volte più veloce.
function muoviFrecce(dt) {
  if (movimento !== "ruota") return;
  const v = new THREE.Vector3();
  if (tasti.has("arrowup")) v.z -= 1;
  if (tasti.has("arrowdown")) v.z += 1;
  if (tasti.has("arrowleft")) v.x -= 1;
  if (tasti.has("arrowright")) v.x += 1;
  if (!v.lengthSq()) return;
  volo = null;                                          // un tasto interrompe il volo automatico
  // più lontano dalla Terra = più veloce (come in Vola)
  const base = Math.max(2, camera.position.length() * 0.35) * (tasti.has("shift") ? 3 : 1);
  v.normalize().multiplyScalar(base * dt).applyQuaternion(camera.quaternion);
  camera.position.add(v);
  controlli.target.add(v);
}
function muoviPulsanti(dt) {
  if (!premuti.size) return;
  if (movimento === "vola") {
    const v = new THREE.Vector3();
    if (premuti.has("piu")) v.z -= 1;
    if (premuti.has("meno")) v.z += 1;
    if (v.lengthSq()) {
      const base = Math.max(2, camera.position.length() * 0.35) * velocitaVolo;
      camera.position.add(v.multiplyScalar(base * dt).applyQuaternion(camera.quaternion));
    }
    const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    if (premuti.has("sx")) eul.y += dt * 0.9;
    if (premuti.has("dx")) eul.y -= dt * 0.9;
    if (premuti.has("su")) eul.x = Math.min(1.55, eul.x + dt * 0.9);
    if (premuti.has("giu")) eul.x = Math.max(-1.55, eul.x - dt * 0.9);
    camera.quaternion.setFromEuler(eul);
    return;
  }
  const t = controlli.target, rel = camera.position.clone().sub(t);
  const k = tasti.has("shift") ? 3 : 1;                                     // Shift: più veloce
  if (premuti.has("piu")) rel.multiplyScalar(Math.pow(0.35, dt * k));     // avvicina
  if (premuti.has("meno")) rel.multiplyScalar(Math.pow(1 / 0.35, dt * k)); // allontana
  const sph = new THREE.Spherical().setFromVector3(rel);
  if (premuti.has("sx")) sph.theta -= dt * 0.9 * k;
  if (premuti.has("dx")) sph.theta += dt * 0.9 * k;
  if (premuti.has("su")) sph.phi = Math.max(0.05, sph.phi - dt * 0.9 * k);
  if (premuti.has("giu")) sph.phi = Math.min(Math.PI - 0.05, sph.phi + dt * 0.9 * k);
  sph.radius = Math.min(Math.max(sph.radius, controlli.minDistance), controlli.maxDistance);
  camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(sph));
  camera.lookAt(t);
}

// ------------------------------------------------------------------ ciclo
let ultimo = performance.now();
const liscio = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function anima(ora) {
  const dt = Math.min(0.1, (ora - ultimo) / 1000);
  ultimo = ora;
  if (transizione) {
    const t = Math.min(1, (ora - transizione.inizio) / transizione.durata);
    const e = liscio(t);
    applicaPosizioni(e);
    if (camTransizione) {
      camera.position.lerpVectors(camTransizione.da, camTransizione.a, e);
      if (selezionato) controlli.target.copy(selezionato.pos);
      else controlli.target.lerpVectors(camTransizione.tda, camTransizione.ta, e);
    }
    if (t >= 1) { transizione = null; camTransizione = null; }
  }
  if (volo) {
    const t = Math.min(1, (ora - volo.inizio) / volo.durata), e = liscio(t);
    camera.position.lerpVectors(volo.da, volo.a, e);
    controlli.target.lerpVectors(volo.tda, volo.ta, e);
    if (movimento === "vola") camera.lookAt(controlli.target);
    if (t >= 1) volo = null;
  }
  if (movimento === "ruota") controlli.update(); else muoviVolo(dt);
  if (selezionato) {
    anelloSel.position.copy(selezionato.pos);
    anelloSel.quaternion.copy(camera.quaternion);
    const dist = camera.position.distanceTo(selezionato.pos);
    const s = selezionato.stella ? 14 * dist / uniformi.uFocale.value
      : Math.max(selezionato.size * uniformi.uScala.value, uniformi.uMinPix.value * dist / uniformi.uFocale.value);
    anelloSel.scale.setScalar(Math.max(Math.min(s, 40 * uniformi.uMinPix.value * dist / uniformi.uFocale.value), 12 * dist / uniformi.uFocale.value) * 1.25);
  }
  terra.rotation.y += dt * 0.05;
  {   // la Terra resta sempre visibile: almeno 8 pixel di raggio sullo schermo
    const rMin = 8 * Math.max(camera.position.length(), 1e-3) / uniformi.uFocale.value;
    terra.scale.setScalar(Math.max(vista === "vera" ? 0.02 : 5, rMin));
  }
  muoviPulsanti(dt);
  muoviFrecce(dt);
  renderer.render(scena, camera);
  aggiornaEtichette(ora);
  requestAnimationFrame(anima);
}

// ------------------------------------------------------------------ avvio
async function avvia() {
  D = await (await fetch("./dati/dati.json")).json();
  gusci = D.gusci;
  const F = Object.fromEntries(D.campi.map((c, i) => [c, i]));
  oggetti = D.oggetti.map((r) => {
    const dim = r[F.dim] || 1;
    const g = r[F.gruppo];
    let size = 2.2 + Math.log10(1 + dim) * 2.6;
    if (g === "Galassie") size *= 1.1;
    if (r[F.importanza] > 5) size *= 1.3;
    return { id: r[F.id], nome: r[F.nome], comune: r[F.nomi_comuni], altri: r[F.altri_nomi], gruppo: g,
      tipo: r[F.tipo], cost: r[F.costellazione], ra: r[F.ra], dec: r[F.dec], al: r[F.anni_luce],
      stato: r[F.stato], fonte: r[F.fonte], mag: r[F.mag], dim: r[F.dim], foglio: r[F.foglio], cella: r[F.cella],
      imp: r[F.importanza], size, dir: direzione(r[F.ra], r[F.dec]) };
  });
  stelle = D.stelle.map((s) => ({ stella: true, ra: s[0], dec: s[1], al: s[2], mag: s[3], bv: s[4], nome: s[5],
    hr: s[6], stato: s[7] ? 0 : 2, dir: direzione(s[0], s[1]), imp: 6 - s[3], gruppo: "Stelle", tipo: "stella" }));
  // miniature
  const caricatore = new THREE.TextureLoader();
  const fogli = await Promise.all(Array.from({ length: D.fogli }, (_, k) =>
    new Promise((ok) => caricatore.load(`./dati/fogli/foglio_${k}.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; ok(t); }, undefined, () => ok(null)))));
  for (let k = 0; k < D.fogli; k++) {
    const l = oggetti.filter((o) => o.foglio === k);
    if (l.length && fogli[k]) creaMesh(l, fogli[k]);
    else l.forEach((o) => (o.cella = -1));
  }
  creaMesh(oggetti.filter((o) => o.foglio < 0 || o.cella < 0 || !fogli[o.foglio]), null);
  creaStelle();
  candidatiNomi = [...oggetti.filter((o) => o.comune || /^M \d+$/.test(o.nome)).sort((a, b) => b.imp - a.imp),
    ...stelle.filter((s) => s.mag < 1.6 || s.al < 15).sort((a, b) => a.mag - b.mag)];
  // caselle dei gruppi
  const conteggi = {};
  oggetti.forEach((o) => (conteggi[o.gruppo] = (conteggi[o.gruppo] || 0) + 1));
  for (const g of Object.keys(COLORI)) {
    if (!conteggi[g]) continue;
    const l = document.createElement("label");
    l.className = "casella";
    l.innerHTML = `<input type="checkbox" checked><span class="pallino" style="background:${COLORI[g]}"></span>${g}<span class="num">${numero(conteggi[g])}</span>`;
    l.querySelector("input").onchange = (e) => { e.target.checked ? gruppiAttivi.add(g) : gruppiAttivi.delete(g); applicaFiltri(); };
    $("#gruppi").appendChild(l);
  }
  ["#c_stelle", "#c_cost", "#c_gusci", "#c_nomi", "#c_misurate"].forEach((s) => ($(s).onchange = applicaFiltri));
  $("#grandezza").oninput = (e) => (uniformi.uScala.value = parseFloat(e.target.value));
  document.querySelectorAll("#viste button").forEach((b) => (b.onclick = () => cambiaVista(b.dataset.vista)));
  document.querySelectorAll("#movimenti button[data-mov]").forEach((b) => (b.onclick = () => impostaMovimento(b.dataset.mov)));
  $("#torna").onclick = tornaInizio;
  $("#c_centro").onclick = tornaInizio;
  try { lista = new Set(await (await fetch("./api/lista")).json()); } catch { /* lista non disponibile */ }
  dimensiona();
  addEventListener("resize", dimensiona);
  cambiaVista("gusci", false);
  applicaFiltri();
  camera.position.set(0, 380, 1450);
  controlli.target.set(0, 0, 0);
  aggiornaAiuto();
  $("#caricamento").style.display = "none";
  const vere = oggetti.filter((o) => o.stato === 0).length;
  console.log(`Atomo Celeste: ${oggetti.length} oggetti (${vere} con distanza misurata), ${stelle.length} stelle`);
  window.__atomo = { oggetti, stelle, camera, cambiaVista, seleziona, volaA };
  requestAnimationFrame(anima);
}
avvia().catch((e) => { $("#stato_car").textContent = "Errore: " + e.message; console.error(e); });
