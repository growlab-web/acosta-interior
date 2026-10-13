/**
 * El departamento en 3D. Todo está modelado por código con primitivas (sin
 * modelos ni imágenes generadas): paredes, piso, muebles y, en la pared del
 * fondo, los proyectos colgados como cuadros con sus fotos reales.
 *
 * Plano (metros, la cámara entra mirando hacia -z):
 *   - Recibidor: pasillo x∈[-1.6, 1.6], z∈[0, -4.5].
 *   - Sala: nave larga x∈[-4.5, 30], z∈[-4.5, -12]; la pared del fondo (z=-12)
 *     es la galería, con un cuadro cada 4.4 m empezando frente al pasillo.
 *   - Comedor y cocina: en el extremo derecho (x∈[21, 30]).
 * Las vistas de cámara de cada sección están en house.ts.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export interface View {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface Apartment {
  /** Dibuja desde la vista dada; (ox, oy) desplaza la cámara para el paralaje del puntero. */
  render(view: View, ox?: number, oy?: number): void;
  resize(): void;
  /** Calidad alta: oclusión ambiental y resplandor. Baja: render directo, para equipos lentos. */
  setQuality(high: boolean): void;
  dispose(): void;
}

/** Posición en x del centro de cada cuadro de la galería. */
export const FRAME_X = [0, 4.4, 8.8, 13.2, 17.6];

const X0 = -4.5;
const X1 = 30;
const Z_BACK = -12;
const Z_FRONT = -4.5;
const HALL = 1.6;
const H = 2.9;

const C = {
  wall: 0xcfc9be,
  ceiling: 0xe9e5dd,
  base: 0x86866f,
  olive: 0x666a4e,
  oliveDeep: 0x454838,
  brass: 0xb8995a,
  cream: 0xddd6c8,
  linen: 0xbfb7a8,
  leather: 0x9a5f3a,
  walnut: 0x4a3526,
  charcoal: 0x262521,
  stone: 0xe4dfd6,
  leaf: 0x3d5136,
  glow: 0xffe2b0,
};

/* ───────── Texturas procedurales ───────── */

/** Generador pseudoaleatorio con semilla: la escena sale igual en cada carga. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** `data`: la textura guarda relieve (no color), así que no se interpreta como sRGB. */
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, data = false) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Piso de madera oscura en tablones: color y relieve (juntas hundidas y veta) con el mismo trazado. */
function floorTextures() {
  const rand = seeded(7);
  const W = 1024;
  const Hh = 2048;
  const planks = 8;
  const pw = W / planks;
  type Plank = { x: number; y: number; len: number; l: number; hue: number; sat: number; grain: number[][] };
  const list: Plank[] = [];
  for (let i = 0; i < planks; i++) {
    let y = -rand() * 900;
    while (y < Hh) {
      const len = 700 + rand() * 900;
      const grain = Array.from({ length: 30 }, () => [rand(), rand(), rand(), rand(), rand()]);
      list.push({ x: i * pw, y, len, l: 15.5 + rand() * 3.5, hue: 23 + rand() * 5, sat: 26 + rand() * 6, grain });
      y += len;
    }
  }
  const strokes = (ctx: CanvasRenderingContext2D, p: Plank, color: (g: number[]) => string) => {
    for (const g of p.grain) {
      ctx.strokeStyle = color(g);
      ctx.lineWidth = 0.6 + g[1] * 1.6;
      const gx = p.x + g[0] * pw;
      ctx.beginPath();
      ctx.moveTo(gx, p.y);
      ctx.bezierCurveTo(gx + g[2] * 12 - 6, p.y + p.len / 3, gx + g[3] * 12 - 6, p.y + (2 * p.len) / 3, gx, p.y + p.len);
      ctx.stroke();
    }
  };
  const map = canvasTexture(W, Hh, (ctx) => {
    for (const p of list) {
      ctx.fillStyle = `hsl(${p.hue}, ${p.sat}%, ${p.l}%)`;
      ctx.fillRect(p.x, p.y, pw, p.len);
      strokes(ctx, p, (g) => `rgba(${g[4] > 0.5 ? "255,225,190" : "0,0,0"}, ${0.03 + g[1] * 0.07})`);
    }
  });
  const bump = canvasTexture(W, Hh, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, Hh);
    for (const p of list) {
      strokes(ctx, p, (g) => `rgba(${g[4] > 0.5 ? "255,255,255" : "0,0,0"}, ${0.05 + g[1] * 0.1})`);
      // Bisel: cada tablón cae hacia sus juntas.
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(p.x, p.y, 3, p.len);
      ctx.fillRect(p.x, p.y + p.len - 3, pw, 3);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(p.x + 3, p.y, 3, p.len);
    }
  }, true);
  return { map, bump };
}

/** Revoque gris cálido con juntas horizontales y dos filetes de latón; el relieve hunde las juntas. */
function wallTextures() {
  const rand = seeded(3);
  const band = 1024 / 5;
  const map = canvasTexture(256, 1024, (ctx) => {
    ctx.fillStyle = "#cfc9be";
    ctx.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 5200; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "70,60,45"}, ${rand() * 0.035})`;
      ctx.fillRect(rand() * 256, rand() * 1024, 2 + rand() * 26, 1 + rand() * 5);
    }
    for (let j = 1; j < 5; j++) {
      const brass = j === 2 || j === 4;
      ctx.fillStyle = brass ? "#b89c5e" : "rgba(40,34,26,0.4)";
      ctx.fillRect(0, j * band - 2, 256, brass ? 4 : 3);
    }
  });
  const bump = canvasTexture(256, 1024, (ctx) => {
    ctx.fillStyle = "#909090";
    ctx.fillRect(0, 0, 256, 1024);
    // Grano del revoque: manchas suaves y poro fino.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "0,0,0"}, ${rand() * 0.09})`;
      const s = 1 + rand() * 4;
      ctx.fillRect(rand() * 256, rand() * 1024, s, s);
    }
    for (let j = 1; j < 5; j++) {
      ctx.fillStyle = "#101010";
      ctx.fillRect(0, j * band - 3, 256, 6);
    }
  }, true);
  return { map, bump };
}

/** Tejido: trama y urdimbre con algo de irregularidad. Sirve de relieve para tapices y alfombras. */
function weaveBump(seed: number, coarse = 4) {
  const rand = seeded(seed);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += coarse) {
      for (let x = 0; x < 256; x += coarse) {
        const over = (x / coarse + y / coarse) % 2 === 0;
        const v = (over ? 150 : 96) + rand() * 46 - 23;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, coarse, coarse);
      }
    }
  }, true);
}

/** Cuero: poro irregular de baja frecuencia. */
function leatherBump() {
  const rand = seeded(19);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#858585";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.2})`;
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 256, 0.6 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }, true);
}

/** Mármol claro con vetas suaves. */
function marbleTexture() {
  const rand = seeded(29);
  return canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = "#e7e2d9";
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "150,140,125"}, ${0.04 + rand() * 0.05})`;
      ctx.beginPath();
      ctx.arc(rand() * 1024, rand() * 1024, 60 + rand() * 180, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = "blur(1.2px)";
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = `rgba(110,100,88,${0.08 + rand() * 0.22})`;
      ctx.lineWidth = 0.6 + rand() * (i < 5 ? 5 : 1.6);
      let x = rand() * 1024;
      let y = -40;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (y < 1064) {
        x += rand() * 120 - 45;
        y += 40 + rand() * 110;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.filter = "none";
  });
}

/** Nogal: veta larga y ondulada. Devuelve color y relieve. */
function walnutTextures() {
  const rand = seeded(37);
  const lines = Array.from({ length: 150 }, () => [rand(), rand(), rand(), rand()]);
  const trace = (ctx: CanvasRenderingContext2D, color: (l: number[]) => string) => {
    for (const l of lines) {
      ctx.strokeStyle = color(l);
      ctx.lineWidth = 0.6 + l[1] * 2.6;
      const y = l[0] * 512;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(170, y + l[2] * 26 - 13, 340, y + l[3] * 26 - 13, 512, y + (l[2] - l[3]) * 10);
      ctx.stroke();
    }
  };
  const map = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#523a29";
    ctx.fillRect(0, 0, 512, 512);
    trace(ctx, (l) => `rgba(${l[3] > 0.5 ? "30,18,10" : "150,105,70"}, ${0.1 + l[1] * 0.22})`);
  });
  const bump = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 512, 512);
    trace(ctx, (l) => `rgba(${l[3] > 0.5 ? "0,0,0" : "255,255,255"}, ${0.12 + l[1] * 0.2})`);
  }, true);
  return { map, bump };
}

/* ───────── Escena ───────── */

export function createApartment(canvas: HTMLCanvasElement, photos: string[]): Apartment {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // Tope de 1.5: en pantallas de alta densidad, 2x cuadruplica los píxeles sin que se note.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // La escena es estática: las sombras se calculan una sola vez.
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15120f);
  // Bruma cálida: los objetos lejanos pierden contraste y se lee la distancia.
  scene.fog = new THREE.Fog(0xbdb6aa, 20, 70);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 90);

  const std = (color: number, roughness = 0.85, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  const floorTex = floorTextures();
  const wallTex = wallTextures();
  const walnutTex = walnutTextures();
  const marble = marbleTexture();
  const weave = weaveBump(11);
  const rugWeave = weaveBump(13, 8);
  const pores = leatherBump();
  weave.repeat.set(7, 7);
  rugWeave.repeat.set(10, 10);
  pores.repeat.set(3, 3);

  /** Tela tapizada: relieve de tejido y un brillo rasante suave (sheen), como el de un tapiz real. */
  const fabric = (color: number, sheen = 0.5) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.96,
      bumpMap: weave,
      bumpScale: 2.2,
      sheen,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25),
    });

  const M = {
    wall: new THREE.MeshStandardMaterial({ map: wallTex.map, bumpMap: wallTex.bump, bumpScale: 1.6, roughness: 0.94 }),
    // Madera barnizada: una capa de barniz (clearcoat) refleja la luz por encima de la veta.
    floor: new THREE.MeshPhysicalMaterial({
      map: floorTex.map,
      bumpMap: floorTex.bump,
      bumpScale: 2.4,
      roughness: 0.46,
      clearcoat: 0.45,
      clearcoatRoughness: 0.32,
    }),
    ceiling: new THREE.MeshStandardMaterial({ color: C.ceiling, roughness: 1, emissive: C.ceiling, emissiveIntensity: 0.22 }),
    base: std(C.base, 0.7),
    // Laca satinada de los muebles de cocina.
    olive: new THREE.MeshPhysicalMaterial({ color: C.olive, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    oliveDeep: new THREE.MeshPhysicalMaterial({ color: C.oliveDeep, roughness: 0.52, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
    velvet: fabric(C.olive, 0.35),
    brass: std(C.brass, 0.27, 1),
    cream: fabric(C.cream),
    linen: fabric(C.linen),
    rug: new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 1, bumpMap: rugWeave, bumpScale: 4 }),
    leather: new THREE.MeshPhysicalMaterial({
      color: C.leather,
      roughness: 0.5,
      bumpMap: pores,
      bumpScale: 0.9,
      clearcoat: 0.18,
      clearcoatRoughness: 0.6,
    }),
    walnut: new THREE.MeshPhysicalMaterial({
      map: walnutTex.map,
      bumpMap: walnutTex.bump,
      bumpScale: 1.2,
      roughness: 0.48,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
    }),
    charcoal: std(C.charcoal, 0.55, 0.35),
    // Cerámica mate de macetas y jarrones.
    stone: std(C.stone, 0.62),
    marble: new THREE.MeshPhysicalMaterial({ map: marble, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.15 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: C.leaf, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0x9fbf7a) }),
    mirror: std(0x8f9491, 0.06, 1),
    // Muy por encima del umbral del resplandor (bloom): solo brilla lo que de verdad emite luz.
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(C.glow).multiplyScalar(6) }),
    daylight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf6f1e6).multiplyScalar(3.8), fog: false }),
  };

  /* Constructores: todo se cuelga de `scene` o del grupo indicado. */

  type Opts = { round?: number; cast?: boolean; receive?: boolean; parent?: THREE.Object3D };

  function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, o: Opts = {}) {
    const geo = o.round ? new RoundedBoxGeometry(w, h, d, 4, Math.min(o.round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    (o.parent ?? scene).add(mesh);
    return mesh;
  }

  function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, o: Opts = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 40), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    (o.parent ?? scene).add(mesh);
    return mesh;
  }

  function group(x: number, z: number, ry = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    return g;
  }

  /**
   * Globo encendido. Cada luz real se calcula en todos los píxeles de la escena, así que solo
   * llevan luz propia las lámparas aisladas; los grupos (comedor, isla, galería) comparten una.
   */
  function globe(x: number, y: number, z: number, r = 0.11, intensity = 9, range = 9) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), M.glow);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    if (!intensity) return;
    const light = new THREE.PointLight(C.glow, intensity, range, 2);
    light.position.set(x, y - r * 0.4, z);
    scene.add(light);
  }

  /** Lámpara colgante: cable, globo y luz. */
  function pendant(x: number, y: number, z: number, r = 0.11, intensity = 9) {
    cyl(0.004, 0.004, H - y, M.charcoal, x, (H + y) / 2, z, { cast: false });
    cyl(0.03, 0.05, 0.05, M.brass, x, y + r + 0.02, z, { cast: false });
    globe(x, y, z, r, intensity);
  }

  function plant(x: number, z: number, height = 1.5, seed = 1) {
    const rand = seeded(seed);
    const g = group(x, z);
    cyl(0.2, 0.15, 0.36, M.stone, 0, 0.18, 0, { parent: g });
    const leaves = 30;
    for (let i = 0; i < leaves; i++) {
      const t = (i + 1) / leaves;
      const angle = i * 2.399963; // ángulo áureo: reparte las hojas sin que se alineen
      const y = 0.42 + t * (height - 0.42) * (0.75 + rand() * 0.25);
      const reach = 0.1 + Math.sin(t * Math.PI) * 0.34 + rand() * 0.08;
      // Cada hoja cuelga de un pivote en el tallo y se inclina hacia afuera.
      const pivot = new THREE.Group();
      pivot.position.set(0, y, 0);
      pivot.rotation.y = -angle;
      const size = 0.1 + rand() * 0.06;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), M.leaf);
      leaf.scale.set(1.5, 0.16, 0.8);
      leaf.position.x = reach;
      leaf.rotation.z = 0.5 + rand() * 0.6 - t * 0.3;
      leaf.rotation.x = rand() * 0.6 - 0.3;
      leaf.castShadow = true;
      pivot.add(leaf);
      g.add(pivot);
    }
    cyl(0.012, 0.022, height * 0.74, M.walnut, 0, 0.36 + height * 0.37, 0, { parent: g });
  }

  function sofa(x: number, z: number, ry: number, length = 2.3, mat = M.cream) {
    const g = group(x, z, ry);
    box(length, 0.26, 0.95, mat, 0, 0.3, 0, { round: 0.08, parent: g });
    box(length, 0.52, 0.24, mat, 0, 0.6, -0.36, { round: 0.1, parent: g });
    for (const side of [-1, 1]) box(0.22, 0.34, 0.95, mat, (side * (length - 0.22)) / 2, 0.52, 0, { round: 0.09, parent: g });
    const seats = 3;
    const sw = (length - 0.5) / seats;
    for (let i = 0; i < seats; i++) {
      const cx = -((length - 0.5) / 2) + sw * (i + 0.5);
      box(sw - 0.03, 0.16, 0.66, mat, cx, 0.5, 0.1, { round: 0.07, parent: g });
      box(sw - 0.1, 0.36, 0.16, i === 1 ? M.velvet : M.linen, cx, 0.76, -0.2, { round: 0.07, parent: g }).rotation.x = -0.18;
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.02, 0.014, 0.16, M.brass, sx * (length / 2 - 0.12), 0.08, sz * 0.36, { parent: g });
  }

  function armchair(x: number, z: number, ry: number, mat = M.leather) {
    const g = group(x, z, ry);
    box(0.74, 0.14, 0.74, mat, 0, 0.4, 0, { round: 0.06, parent: g });
    box(0.74, 0.5, 0.14, mat, 0, 0.66, -0.32, { round: 0.06, parent: g }).rotation.x = -0.16;
    for (const side of [-1, 1]) {
      box(0.06, 0.04, 0.72, M.walnut, side * 0.4, 0.58, 0, { round: 0.02, parent: g });
      for (const sz of [-1, 1]) cyl(0.018, 0.014, 0.58, M.walnut, side * 0.4, 0.29, sz * 0.32, { parent: g });
    }
  }

  function chair(x: number, z: number, ry: number) {
    const g = group(x, z, ry);
    box(0.46, 0.09, 0.46, M.velvet, 0, 0.47, 0, { round: 0.04, parent: g });
    box(0.46, 0.46, 0.08, M.velvet, 0, 0.76, -0.2, { round: 0.04, parent: g }).rotation.x = -0.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.014, 0.01, 0.43, M.brass, sx * 0.19, 0.215, sz * 0.19, { parent: g });
  }

  function floorLamp(x: number, z: number) {
    cyl(0.16, 0.16, 0.03, M.brass, x, 0.015, z);
    cyl(0.012, 0.012, 1.5, M.brass, x, 0.76, z);
    const shade = cyl(0.14, 0.22, 0.3, new THREE.MeshStandardMaterial({ color: 0xf2e6cf, emissive: C.glow, emissiveIntensity: 0.9, roughness: 1 }), x, 1.62, z, { cast: false });
    shade.receiveShadow = false;
    const light = new THREE.PointLight(C.glow, 10, 8, 2);
    light.position.set(x, 1.5, z);
    scene.add(light);
  }

  /** Tramo de pared con su zócalo. `along` indica si corre en x o en z. */
  function wall(along: "x" | "z", from: number, to: number, at: number, side: 1 | -1) {
    const len = Math.abs(to - from);
    const mid = (from + to) / 2;
    const mat = M.wall.clone();
    mat.map = wallTex.map.clone();
    mat.bumpMap = wallTex.bump.clone();
    for (const tex of [mat.map, mat.bumpMap]) {
      tex.repeat.set(len / 2.4, 1);
      tex.needsUpdate = true;
    }
    const geo = new THREE.PlaneGeometry(len, H);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    if (along === "x") {
      mesh.position.set(mid, H / 2, at);
      mesh.rotation.y = side === 1 ? 0 : Math.PI;
      box(len, 0.13, 0.03, M.base, mid, 0.065, at + side * 0.015, { cast: false });
    } else {
      mesh.position.set(at, H / 2, mid);
      mesh.rotation.y = (side * Math.PI) / 2;
      box(0.03, 0.13, len, M.base, at + side * 0.015, 0.065, mid, { cast: false });
    }
    scene.add(mesh);
  }

  /* ── Envolvente ── */

  const floorW = X1 - X0;
  const floorD = 15.5;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), M.floor);
  for (const tex of [floorTex.map, floorTex.bump]) tex.repeat.set(floorW / 1.44, floorD / 2.88);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((X0 + X1) / 2, 0, Z_BACK + floorD / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), M.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((X0 + X1) / 2, H, Z_BACK + floorD / 2);
  scene.add(ceiling);

  wall("x", X0, X1, Z_BACK, 1); // galería
  wall("x", X0, -HALL, Z_FRONT, -1);
  wall("x", HALL, X1, Z_FRONT, -1);
  wall("z", 3.5, Z_FRONT, -HALL, 1); // pasillo
  wall("z", 3.5, Z_FRONT, HALL, -1);
  wall("z", Z_FRONT, Z_BACK, X1, -1); // cocina
  // Cantos de los muros donde el pasillo se abre a la sala.
  for (const side of [-1, 1]) box(0.16, H, 0.16, M.wall, side * (HALL + 0.08), H / 2, Z_FRONT - 0.08, { cast: false });

  // Ventanal del extremo izquierdo: luz de día y carpintería oscura.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(Z_FRONT - Z_BACK, H), M.daylight);
  glass.position.set(X0, H / 2, (Z_FRONT + Z_BACK) / 2);
  glass.rotation.y = Math.PI / 2;
  scene.add(glass);
  for (let i = 0; i <= 5; i++) box(0.06, H, 0.06, M.charcoal, X0 + 0.04, H / 2, Z_BACK + (i * (Z_FRONT - Z_BACK)) / 5, { cast: false });
  box(0.06, 0.06, Z_FRONT - Z_BACK, M.charcoal, X0 + 0.04, 2.1, (Z_FRONT + Z_BACK) / 2, { cast: false });

  // Foseado de luz a lo largo de la galería, como en el render.
  box(floorW, 0.04, 0.3, M.glow, (X0 + X1) / 2, H - 0.03, Z_BACK + 0.2, { cast: false, receive: false });

  /* ── Recibidor ── */

  box(0.36, 0.05, 1.5, M.walnut, -1.36, 0.82, -2.4, { round: 0.02 });
  for (const dz of [-0.68, 0.68]) cyl(0.014, 0.014, 0.8, M.brass, -1.36, 0.4, -2.4 + dz);
  cyl(0.07, 0.09, 0.26, M.stone, -1.36, 0.98, -2.85);
  cyl(0.15, 0.2, 0.22, new THREE.MeshStandardMaterial({ color: 0xf2e6cf, emissive: C.glow, emissiveIntensity: 1, roughness: 1 }), -1.36, 1.22, -2.85, { cast: false });
  const lampLight = new THREE.PointLight(C.glow, 6, 6, 2);
  lampLight.position.set(-1.2, 1.25, -2.85);
  scene.add(lampLight);
  box(0.24, 0.05, 0.32, M.oliveDeep, -1.36, 0.87, -2.1, { round: 0.01 });
  box(0.2, 0.04, 0.28, M.cream, -1.36, 0.915, -2.12, { round: 0.01 });
  cyl(0.06, 0.09, 0.3, M.olive, -1.36, 1.0, -1.85);

  // Cuadro vertical sobre la consola y espejo redondo enfrente.
  box(0.04, 1.2, 0.86, M.charcoal, -HALL + 0.03, 1.72, -2.4, { cast: false });
  box(0.02, 1.08, 0.74, M.linen, -HALL + 0.055, 1.72, -2.4, { cast: false });
  box(0.02, 0.5, 0.34, M.olive, -HALL + 0.07, 1.62, -2.4, { cast: false });
  const mirror = cyl(0.56, 0.56, 0.03, M.mirror, HALL - 0.03, 1.62, -2.4, { cast: false });
  mirror.rotation.z = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.022, 12, 64), M.brass);
  ring.position.set(HALL - 0.035, 1.62, -2.4);
  ring.rotation.y = Math.PI / 2;
  scene.add(ring);

  // Alfombra de pasillo, banco y planta.
  box(1.3, 0.016, 3.6, M.velvet, 0, 0.008, -2.3, { cast: false, round: 0.006 });
  box(1.1, 0.02, 3.4, M.rug, 0, 0.01, -2.3, { cast: false, round: 0.006 });
  box(0.4, 0.07, 1.1, M.leather, 1.3, 0.44, -1.0, { round: 0.03 });
  for (const dz of [-0.45, 0.45]) box(0.36, 0.42, 0.04, M.walnut, 1.3, 0.21, -1.0 + dz);
  plant(1.3, -4.1, 1.25, 11);
  pendant(0, 2.25, -2.3, 0.13, 10);

  /* ── Sala: lo que se ve a los lados al salir del pasillo ── */

  sofa(-3.35, -7.1, Math.PI / 2, 2.4);
  box(2.8, 0.022, 3.4, M.rug, -2.5, 0.011, -7.1, { cast: false, round: 0.008 });
  box(0.3, 0.03, 0.22, M.oliveDeep, -2.02, 0.4, -7.28, { round: 0.004 }).rotation.y = 0.3;
  box(0.26, 0.025, 0.19, M.cream, -2.03, 0.428, -7.27, { round: 0.004 }).rotation.y = 0.5;
  cyl(0.5, 0.5, 0.05, M.walnut, -2.15, 0.36, -7.1);
  cyl(0.05, 0.3, 0.34, M.brass, -2.15, 0.17, -7.1);
  cyl(0.09, 0.07, 0.16, M.stone, -2.25, 0.46, -6.95);
  plant(-3.9, -5.3, 2.0, 5);
  floorLamp(-3.7, -8.9);

  armchair(2.9, -6.3, -Math.PI / 2 - 0.3);
  cyl(0.22, 0.22, 0.04, M.marble, 3.2, 0.5, -7.3);
  cyl(0.02, 0.14, 0.5, M.brass, 3.2, 0.25, -7.3);
  floorLamp(3.6, -5.3);

  /* ── Galería: un cuadro por proyecto ── */

  const loader = new THREE.TextureLoader();
  let last: [View, number, number] | null = null;
  const redraw = () => last && api.render(...last);

  FRAME_X.forEach((x, i) => {
    // Marco con fondo, paspartú y la foto algo rehundida: la sombra del marco le da grosor.
    box(3.36, 2.26, 0.08, M.charcoal, x, 1.6, Z_BACK + 0.04);
    box(3.22, 2.12, 0.02, std(0xe9e4da, 0.95), x, 1.6, Z_BACK + 0.078, { cast: false });
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(2.84, 1.74),
      new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.9 }),
    );
    art.position.set(x, 1.6, Z_BACK + 0.092);
    scene.add(art);
    if (photos[i]) {
      loader.load(photos[i], (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Recorte tipo "cover" para llenar el marco sin deformar la foto.
        const frame = 2.84 / 1.74;
        const img = tex.image.width / tex.image.height;
        if (img > frame) {
          tex.repeat.x = frame / img;
          tex.offset.x = (1 - tex.repeat.x) / 2;
        } else {
          tex.repeat.y = img / frame;
          tex.offset.y = (1 - tex.repeat.y) / 2;
        }
        art.material = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2, roughness: 0.85 });
        redraw();
      });
    }
    // Foco de galería sobre cada cuadro.
    const spot = new THREE.SpotLight(0xfff0d8, 26, 8, 0.66, 0.8, 1.6);
    spot.position.set(x, H - 0.1, Z_BACK + 2.6);
    spot.target.position.set(x, 1.5, Z_BACK);
    scene.add(spot, spot.target);
    cyl(0.05, 0.035, 0.12, M.charcoal, x, H - 0.07, Z_BACK + 2.6, { cast: false });

    // Entre cuadro y cuadro: algo en primer plano que marque la profundidad al caminar.
    const between = x + 2.2;
    if (i % 2 === 0) plant(between, Z_BACK + 0.55, 1.9, 20 + i);
    else {
      cyl(0.2, 0.2, 1.0, M.stone, between, 0.5, Z_BACK + 0.6);
      cyl(0.1, 0.16, 0.42, M.oliveDeep, between, 1.21, Z_BACK + 0.6);
    }
    if (i === 1 || i === 3) {
      box(2.2, 0.08, 0.44, M.leather, x, 0.42, Z_BACK + 1.7, { round: 0.03 });
      for (const dx of [-0.95, 0.95]) box(0.05, 0.4, 0.4, M.charcoal, x + dx, 0.2, Z_BACK + 1.7);
    }
    pendant(x + 2.2, 2.12, Z_BACK + 2.9, 0.1, 0);
  });

  /* ── Comedor ── */

  const DX = 24.5;
  const DZ = -6.3;
  box(3.6, 0.022, 2.6, M.rug, DX, 0.011, DZ, { cast: false, round: 0.008 });
  box(2.6, 0.05, 1.0, M.walnut, DX, 0.76, DZ, { round: 0.02 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.03, 0.02, 0.74, M.charcoal, DX + sx * 1.15, 0.37, DZ + sz * 0.38);
  for (const dx of [-0.85, 0, 0.85]) {
    chair(DX + dx, DZ - 0.72, 0);
    chair(DX + dx, DZ + 0.72, Math.PI);
  }
  cyl(0.2, 0.1, 0.09, M.stone, DX, 0.83, DZ);
  for (const [dx, dz] of [[-0.07, 0.02], [0.06, -0.05], [0.02, 0.07]]) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), std(0x8fa24c, 0.6));
    fruit.position.set(DX + dx, 0.9, DZ + dz);
    scene.add(fruit);
  }
  cyl(0.035, 0.06, 0.34, M.oliveDeep, DX - 0.7, 0.95, DZ + 0.1);
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) pendant(DX + dx, 1.85 + (Math.abs(dx) > 0.5 ? 0.12 : 0), DZ, 0.085, 0);
  const diningLight = new THREE.PointLight(C.glow, 14, 9, 2);
  diningLight.position.set(DX, 1.8, DZ);
  scene.add(diningLight);
  // Aparador y espejo redondo en la pared.
  box(2.2, 0.62, 0.42, M.walnut, DX, 0.45, Z_FRONT - 0.24, { round: 0.02 });
  for (const dx of [-0.95, 0.95]) cyl(0.016, 0.012, 0.14, M.brass, DX + dx, 0.07, Z_FRONT - 0.24);
  const dMirror = cyl(0.82, 0.82, 0.03, M.mirror, DX, 1.75, Z_FRONT - 0.03, { cast: false });
  dMirror.rotation.x = Math.PI / 2;
  const dRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.024, 12, 72), M.brass);
  dRing.position.set(DX, 1.75, Z_FRONT - 0.04);
  scene.add(dRing);
  cyl(0.08, 0.11, 0.34, M.stone, DX - 0.8, 0.93, Z_FRONT - 0.24);
  box(0.32, 0.04, 0.24, M.oliveDeep, DX + 0.7, 0.78, Z_FRONT - 0.24, { round: 0.004 });
  box(0.28, 0.035, 0.21, M.leather, DX + 0.71, 0.818, Z_FRONT - 0.24, { round: 0.004 }).rotation.y = 0.2;
  plant(DX + 2.4, Z_FRONT - 0.5, 2.1, 31);
  plant(20.6, Z_BACK + 0.6, 1.9, 41);

  /* ── Cocina ── */

  const KX = X1 - 0.32;
  box(0.62, 0.9, 6.6, M.olive, KX, 0.45, -8.5, { round: 0.01 });
  box(0.68, 0.05, 6.7, M.marble, KX - 0.02, 0.925, -8.5, { round: 0.01 });
  for (let i = 0; i <= 10; i++) box(0.006, 0.84, 0.008, M.charcoal, KX - 0.311, 0.46, -11.8 + i * 0.66, { cast: false });
  box(0.42, 0.012, 0.7, M.charcoal, KX - 0.02, 0.951, -8.9, { cast: false });
  cyl(0.013, 0.013, 0.3, M.brass, KX + 0.2, 1.1, -8.9);
  const spout = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 10, 28, Math.PI), M.brass);
  spout.position.set(KX + 0.11, 1.25, -8.9);
  scene.add(spout);
  box(0.5, 0.012, 0.76, M.charcoal, KX - 0.02, 0.951, -6.7, { cast: false });
  box(0.46, 0.34, 0.9, M.charcoal, X1 - 0.24, 2.2, -6.7, { round: 0.01 });
  box(0.3, 0.5, 0.3, M.charcoal, X1 - 0.16, 2.62, -6.7);
  for (let i = 0; i < 9; i++) cyl(0.008, 0.008, 0.22, M.brass, KX - 0.325, 0.7, -11.4 + i * 0.73, { cast: false });
  box(0.02, 0.62, 6.6, M.marble, X1 - 0.012, 1.27, -8.5, { cast: false });
  box(0.28, 0.035, 4.6, M.walnut, X1 - 0.15, 1.68, -8.5);
  for (let i = 0; i < 7; i++) {
    const tall = i % 3 === 0;
    cyl(0.06, 0.06, tall ? 0.26 : 0.16, i % 2 ? M.stone : M.oliveDeep, X1 - 0.15, 1.7 + (tall ? 0.13 : 0.08), -10.4 + i * 0.62);
  }
  box(0.62, 2.2, 0.9, M.oliveDeep, KX, 1.1, -4.98, { round: 0.01 });
  // Isla con banquetas y lámparas.
  const IX = 27.1;
  const IZ = -9.2;
  box(1.0, 0.88, 2.8, M.oliveDeep, IX, 0.44, IZ, { round: 0.01 });
  box(1.14, 0.06, 2.96, M.marble, IX, 0.91, IZ, { round: 0.015 });
  for (const dz of [-0.7, 0, 0.7]) box(0.006, 0.8, 0.008, M.charcoal, IX - 0.502, 0.44, IZ + dz, { cast: false });
  for (const dz of [-0.85, 0, 0.85]) {
    cyl(0.17, 0.17, 0.05, M.leather, IX - 0.86, 0.68, IZ + dz);
    cyl(0.012, 0.012, 0.66, M.brass, IX - 0.86, 0.33, IZ + dz);
    cyl(0.15, 0.15, 0.015, M.brass, IX - 0.86, 0.008, IZ + dz);
    pendant(IX, 1.78, IZ + dz, 0.1, 0);
  }
  const islandLight = new THREE.PointLight(C.glow, 15, 9, 2);
  islandLight.position.set(IX, 1.72, IZ);
  scene.add(islandLight);
  cyl(0.12, 0.07, 0.07, M.walnut, IX + 0.1, 0.975, IZ + 0.5);
  cyl(0.04, 0.06, 0.3, M.stone, IX - 0.1, 1.09, IZ - 0.7);

  /* ── Luz general ── */

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7d6c, 0.55));
  // Luz principal: cae casi vertical, como la suma de los focos del techo. Es la que proyecta
  // las sombras bajo los muebles; paredes y techo no las arrojan.
  const key = new THREE.DirectionalLight(0xfff1dc, 1.35);
  key.position.set(8.5, 20, -3.5);
  key.target.position.set(12.5, 0, -8);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 2048);
  key.shadow.camera.left = -19.5;
  key.shadow.camera.right = 19.5;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 7;
  scene.add(key, key.target);
  // Relleno frío desde el ventanal: modela los volúmenes sin sumar otra sombra.
  const fill = new THREE.DirectionalLight(0xeaf0f5, 0.5);
  fill.position.set(-10, 4, -7);
  fill.target.position.set(10, 1, -8);
  scene.add(fill, fill.target);

  // Focos empotrados: se ven en el techo y explican de dónde viene la luz.
  const downlight = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 20);
  const rim = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 20);
  const spots: [number, number][] = [[0, -1.0], [0, -3.6]];
  for (let x = -3; x <= 29; x += 2.2) spots.push([x, -6.2], [x, -9.0]);
  for (const [x, z] of spots) {
    const lamp = new THREE.Mesh(downlight, M.glow);
    lamp.position.set(x, H - 0.006, z);
    const ringMesh = new THREE.Mesh(rim, M.base);
    ringMesh.position.set(x, H - 0.003, z);
    scene.add(lamp, ringMesh);
  }

  // Cortinas de lino a los lados del ventanal, con pliegues.
  const curtainMat = fabric(0xe6dfd1, 0.3);
  curtainMat.side = THREE.DoubleSide;
  for (const [from, to] of [[Z_FRONT - 0.1, -6.3], [-10.3, Z_BACK + 0.1]]) {
    const len = Math.abs(to - from);
    const geo = new THREE.PlaneGeometry(len, H - 0.08, 90, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 19) * 0.055 + Math.sin(pos.getX(i) * 7) * 0.03);
    geo.computeVertexNormals();
    const curtain = new THREE.Mesh(geo, curtainMat);
    curtain.position.set(X0 + 0.24, (H - 0.08) / 2, (from + to) / 2);
    curtain.rotation.y = Math.PI / 2;
    curtain.castShadow = true;
    curtain.receiveShadow = true;
    scene.add(curtain);
  }

  renderer.shadowMap.needsUpdate = true;

  /* ── Posproceso ──
     Oclusión ambiental (GTAO): oscurece rincones y el contacto de cada mueble con el piso, que es
     lo que más "asienta" los objetos. Resplandor (bloom): halo en lámparas y ventanal. */
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 0.38, distanceExponent: 1, thickness: 0.55, scale: 1.15, samples: 16 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.45, 3.4));
  composer.addPass(new OutputPass());
  let high = true;

  /* ── API ── */

  const target = new THREE.Vector3();
  const right = new THREE.Vector3();

  const api: Apartment = {
    render(view, ox = 0, oy = 0) {
      last = [view, ox, oy];
      camera.position.set(view.px, view.py, view.pz);
      target.set(view.tx, view.ty, view.tz);
      camera.lookAt(target);
      // Paralaje del puntero: la cámara se desplaza de lado sin dejar de mirar al mismo punto.
      if (ox || oy) {
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        camera.position.addScaledVector(right, ox);
        camera.position.y += oy;
        camera.lookAt(target);
      }
      if (high) composer.render();
      else renderer.render(scene, camera);
    },
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      redraw();
    },
    setQuality(next) {
      if (next === high) return;
      high = next;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.5 : 1));
      api.resize();
    },
    dispose() {
      last = null;
      composer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        mats.forEach((m) => {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        });
      });
      pmrem.dispose();
      renderer.dispose();
    },
  };

  api.resize();
  return api;
}
