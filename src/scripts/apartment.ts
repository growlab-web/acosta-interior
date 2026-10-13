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

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Piso de madera oscura en tablones, como el del render de la fachada. */
function floorTexture() {
  const rand = seeded(7);
  return canvasTexture(1024, 2048, (ctx) => {
    const planks = 8;
    const pw = 1024 / planks;
    for (let i = 0; i < planks; i++) {
      let y = -rand() * 900;
      while (y < 2048) {
        const len = 700 + rand() * 900;
        const l = 15.5 + rand() * 3.5;
        ctx.fillStyle = `hsl(${23 + rand() * 5}, ${26 + rand() * 6}%, ${l}%)`;
        ctx.fillRect(i * pw, y, pw, len);
        // Veta
        for (let g = 0; g < 26; g++) {
          ctx.strokeStyle = `rgba(${rand() > 0.5 ? "255,225,190" : "0,0,0"}, ${0.03 + rand() * 0.06})`;
          ctx.lineWidth = 0.6 + rand() * 1.4;
          const gx = i * pw + rand() * pw;
          ctx.beginPath();
          ctx.moveTo(gx, y);
          ctx.bezierCurveTo(gx + rand() * 10 - 5, y + len / 3, gx + rand() * 10 - 5, y + (2 * len) / 3, gx, y + len);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(i * pw, y + len - 2, pw, 2);
        y += len;
      }
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(i * pw, 0, 2, 2048);
    }
  });
}

/** Revoque gris cálido con juntas horizontales y dos filetes de latón. */
function wallTexture() {
  const rand = seeded(3);
  return canvasTexture(256, 1024, (ctx) => {
    ctx.fillStyle = "#cfc9be";
    ctx.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 5200; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "70,60,45"}, ${rand() * 0.035})`;
      ctx.fillRect(rand() * 256, rand() * 1024, 2 + rand() * 26, 1 + rand() * 5);
    }
    const band = 1024 / 5;
    for (let j = 1; j < 5; j++) {
      const brass = j === 2 || j === 4;
      ctx.fillStyle = brass ? "#b89c5e" : "rgba(40,34,26,0.35)";
      ctx.fillRect(0, j * band - 2, 256, brass ? 4 : 3);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(0, j * band + 2, 256, 2);
    }
  });
}

/* ───────── Escena ───────── */

export function createApartment(canvas: HTMLCanvasElement, photos: string[]): Apartment {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // Tope de 1.5: en pantallas de alta densidad, 2x cuadruplica los píxeles sin que se note.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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
  const M = {
    wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.42, metalness: 0.05 }),
    ceiling: new THREE.MeshStandardMaterial({ color: C.ceiling, roughness: 1, emissive: C.ceiling, emissiveIntensity: 0.32 }),
    base: std(C.base, 0.8),
    olive: std(C.olive, 0.75),
    oliveDeep: std(C.oliveDeep, 0.8),
    brass: std(C.brass, 0.32, 1),
    cream: std(C.cream, 0.95),
    linen: std(C.linen, 0.95),
    leather: std(C.leather, 0.55),
    walnut: std(C.walnut, 0.6),
    charcoal: std(C.charcoal, 0.7),
    stone: std(C.stone, 0.35),
    leaf: std(C.leaf, 0.7),
    mirror: std(0xdfe3e0, 0.04, 1),
    glow: new THREE.MeshBasicMaterial({ color: C.glow }),
    daylight: new THREE.MeshBasicMaterial({ color: 0xf6f1e6, fog: false }),
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

  /** Punto de luz cálida con su globo visible. */
  function globe(x: number, y: number, z: number, r = 0.11, intensity = 9, range = 9) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), M.glow);
    mesh.position.set(x, y, z);
    scene.add(mesh);
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
      box(sw - 0.1, 0.36, 0.16, i === 1 ? M.olive : M.linen, cx, 0.76, -0.2, { round: 0.07, parent: g }).rotation.x = -0.18;
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
    box(0.46, 0.09, 0.46, M.olive, 0, 0.47, 0, { round: 0.04, parent: g });
    box(0.46, 0.46, 0.08, M.olive, 0, 0.76, -0.2, { round: 0.04, parent: g }).rotation.x = -0.1;
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
    mat.map = M.wall.map!.clone();
    mat.map.repeat.set(len / 2.4, 1);
    mat.map.needsUpdate = true;
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
  M.floor.map!.repeat.set(floorW / 1.44, floorD / 2.88);
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
  box(1.3, 0.012, 3.6, M.olive, 0, 0.006, -2.3, { cast: false });
  box(1.1, 0.014, 3.4, M.linen, 0, 0.008, -2.3, { cast: false });
  box(0.4, 0.07, 1.1, M.leather, 1.3, 0.44, -1.0, { round: 0.03 });
  for (const dz of [-0.45, 0.45]) box(0.36, 0.42, 0.04, M.walnut, 1.3, 0.21, -1.0 + dz);
  plant(1.3, -4.1, 1.25, 11);
  pendant(0, 2.25, -2.3, 0.13, 10);

  /* ── Sala: lo que se ve a los lados al salir del pasillo ── */

  sofa(-3.35, -7.1, Math.PI / 2, 2.4);
  box(2.8, 0.012, 3.4, M.linen, -2.5, 0.006, -7.1, { cast: false });
  cyl(0.5, 0.5, 0.05, M.walnut, -2.15, 0.36, -7.1);
  cyl(0.05, 0.3, 0.34, M.brass, -2.15, 0.17, -7.1);
  cyl(0.09, 0.07, 0.16, M.stone, -2.25, 0.46, -6.95);
  plant(-3.9, -5.3, 2.0, 5);
  floorLamp(-3.7, -8.9);

  armchair(2.9, -6.3, -Math.PI / 2 - 0.3);
  cyl(0.22, 0.22, 0.04, M.stone, 3.2, 0.5, -7.3);
  cyl(0.02, 0.14, 0.5, M.brass, 3.2, 0.25, -7.3);
  floorLamp(3.6, -5.3);

  /* ── Galería: un cuadro por proyecto ── */

  const loader = new THREE.TextureLoader();
  let last: [View, number, number] | null = null;
  const redraw = () => last && api.render(...last);

  FRAME_X.forEach((x, i) => {
    box(3.36, 2.26, 0.07, M.charcoal, x, 1.6, Z_BACK + 0.045, { cast: false });
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.1),
      new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.9 }),
    );
    art.position.set(x, 1.6, Z_BACK + 0.085);
    scene.add(art);
    if (photos[i]) {
      loader.load(photos[i], (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Recorte tipo "cover" para llenar el marco sin deformar la foto.
        const frame = 3.2 / 2.1;
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
    pendant(x + 2.2, 2.12, Z_BACK + 2.9, 0.1, 5);
  });

  /* ── Comedor ── */

  const DX = 24.5;
  const DZ = -6.3;
  box(3.6, 0.012, 2.6, M.linen, DX, 0.006, DZ, { cast: false });
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
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) pendant(DX + dx, 1.85 + (Math.abs(dx) > 0.5 ? 0.12 : 0), DZ, 0.085, 4);
  // Aparador y espejo redondo en la pared.
  box(2.2, 0.62, 0.42, M.walnut, DX, 0.45, Z_FRONT - 0.24, { round: 0.02 });
  for (const dx of [-0.95, 0.95]) cyl(0.016, 0.012, 0.14, M.brass, DX + dx, 0.07, Z_FRONT - 0.24);
  const dMirror = cyl(0.82, 0.82, 0.03, M.mirror, DX, 1.75, Z_FRONT - 0.03, { cast: false });
  dMirror.rotation.x = Math.PI / 2;
  const dRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.024, 12, 72), M.brass);
  dRing.position.set(DX, 1.75, Z_FRONT - 0.04);
  scene.add(dRing);
  cyl(0.08, 0.11, 0.34, M.stone, DX - 0.8, 0.93, Z_FRONT - 0.24);
  plant(DX + 2.4, Z_FRONT - 0.5, 2.1, 31);
  plant(20.6, Z_BACK + 0.6, 1.9, 41);

  /* ── Cocina ── */

  const KX = X1 - 0.32;
  box(0.62, 0.9, 6.6, M.olive, KX, 0.45, -8.5, { round: 0.01 });
  box(0.68, 0.05, 6.7, M.stone, KX - 0.02, 0.925, -8.5);
  for (let i = 0; i < 9; i++) cyl(0.008, 0.008, 0.22, M.brass, KX - 0.325, 0.7, -11.4 + i * 0.73, { cast: false });
  box(0.02, 0.62, 6.6, M.stone, X1 - 0.012, 1.27, -8.5, { cast: false });
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
  box(1.14, 0.06, 2.96, M.stone, IX, 0.91, IZ, { round: 0.015 });
  for (const dz of [-0.85, 0, 0.85]) {
    cyl(0.17, 0.17, 0.05, M.leather, IX - 0.86, 0.68, IZ + dz);
    cyl(0.012, 0.012, 0.66, M.brass, IX - 0.86, 0.33, IZ + dz);
    cyl(0.15, 0.15, 0.015, M.brass, IX - 0.86, 0.008, IZ + dz);
    pendant(IX, 1.78, IZ + dz, 0.1, 6);
  }
  cyl(0.12, 0.07, 0.07, M.walnut, IX + 0.1, 0.975, IZ + 0.5);
  cyl(0.04, 0.06, 0.3, M.stone, IX - 0.1, 1.09, IZ - 0.7);

  /* ── Luz general ── */

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7d6c, 0.95));
  // Luz rasante desde el ventanal: es la que proyecta las sombras de los muebles.
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.5);
  sun.position.set(-12, 11, 3);
  sun.target.position.set(12, 0, -8.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);
  renderer.shadowMap.needsUpdate = true;

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
      renderer.render(scene, camera);
    },
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      redraw();
    },
    dispose() {
      last = null;
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
