import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";
import type { Apartment, View } from "./apartment";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);

/** Debe coincidir con la consulta del script inline de Base.astro. */
const WALK = "(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";
const REDUCED = "(prefers-reduced-motion: reduce)";
/** Línea donde la pared de la fachada toca el piso, en fracción del alto (--floor-line). */
const FLOOR = 0.76;
/** Cuánto scroll (en altos de pantalla) dura una unidad de la línea de tiempo. */
const SCROLL_PER_UNIT = 0.5;

const root = document.documentElement;
const house = document.querySelector<HTMLElement>("#house")!;
const rooms = gsap.utils.toArray<HTMLElement>(".room", house);
const curtain = document.querySelector<HTMLElement>(".curtain")!;

type GoTo = (id: string, instant?: boolean) => void;
let goTo: GoTo = () => {};

/* ───────── Estado de navegación (cabecera + menú flotante) ───────── */

const goLinks = gsap.utils.toArray<HTMLElement>("[data-go]");
const planRooms = gsap.utils.toArray<SVGElement>("[data-plan]");
const dockLabel = document.querySelector("[data-dock-label]");
let active = -1;

function setActive(index: number, walking: boolean) {
  if (index === active) return;
  active = index;
  const room = rooms[index];
  const section = room.dataset.nav;
  goLinks.forEach((a) => a.setAttribute("aria-current", String(a.dataset.go === section)));
  planRooms.forEach((r) => r.setAttribute("aria-current", String(r.dataset.plan === section)));
  if (dockLabel) dockLabel.textContent = room.dataset.room ?? "";
  // La cabecera cambia de color según lo que tenga detrás.
  root.dataset.tone = (walking && room.dataset.toneWalk) || room.dataset.tone || "light";
  // En el recorrido solo la escena actual es interactiva.
  rooms.forEach((r, i) => (r.inert = walking && i !== index));
}

/* ───────── Geometría de la puerta de la fachada ───────── */

interface Door {
  ox: number;
  oy: number;
  /** Escala con la que el hueco cubre toda la pantalla. */
  S: number;
}

function doorOf(room: HTMLElement): Door | null {
  // Se mide el hueco real (offset*, sin transformaciones): la puerta depende de la
  // proporción de la pantalla porque sale del render de fondo.
  const el = room.querySelector<HTMLElement>(".door");
  if (!el) return null;
  const w = el.offsetWidth / window.innerWidth;
  const top = el.offsetTop / window.innerHeight;
  const L = el.offsetLeft / window.innerWidth;
  const R = L + w;
  const ox = L + w / 2;
  const oy = (top + FLOOR) / 2;
  const S = Math.max(ox / (ox - L), (1 - ox) / (R - ox), oy / (oy - top), (1 - oy) / (FLOOR - oy)) * 1.03;
  return { ox, oy, S };
}

/**
 * Easing de perspectiva: al acercarse a un plano su tamaño aparente crece como 1/distancia,
 * no de forma lineal. Devuelve el progreso normalizado para ir de la escala `a` a la `b`.
 */
const approach = (a: number, b: number) => (p: number) => (a / (1 - p * (1 - a / b)) - a) / (b - a);

/* ───────── Texto ───────── */

/** Letras de los titulares marcados con data-blur, listas para entrar desenfocadas. */
function splitChars(scope: HTMLElement) {
  return gsap.utils
    .toArray<HTMLElement>("[data-blur]", scope)
    .map((el) => SplitText.create(el, { type: "words,chars" }).chars as HTMLElement[]);
}

const BLUR_FROM = { autoAlpha: 0, filter: "blur(14px)", yPercent: 22 };
const BLUR_TO = { autoAlpha: 1, filter: "blur(0px)", yPercent: 0 };

/* ───────── Cámara del departamento 3D ───────── */

/** Centro en x de cada cuadro de la galería (igual que FRAME_X en apartment.ts). */
const FRAME_X = [0, 4.4, 8.8, 13.2, 17.6];

const v = (px: number, py: number, pz: number, tx: number, ty: number, tz: number): View => ({ px, py, pz, tx, ty, tz });

/**
 * Dos vistas por escena: a la que se llega y a la que deriva mientras se está en ella,
 * para que la cámara nunca quede quieta. Posición (p) y punto al que mira (t), en metros.
 */
function cameraStops(): [View, View][] {
  let project = 0;
  return rooms.map((room) => {
    switch (room.dataset.nav) {
      case "fachada": {
        const out = v(0, 1.45, 2.7, 0, 1.38, -12);
        return [out, out];
      }
      case "estudio":
        return [v(0, 1.5, -0.6, 0, 1.4, -12), v(0, 1.5, -2.0, 0, 1.4, -12)];
      case "proyectos": {
        const x = FRAME_X[project++ % FRAME_X.length];
        // De frente al cuadro, lo bastante lejos para ver piso, banco y lámparas en primer plano.
        return [v(x - 0.7, 1.5, -6.3, x - 0.3, 1.5, -12), v(x + 0.7, 1.5, -6.3, x + 0.3, 1.5, -12)];
      }
      case "servicios":
        return [v(21.8, 1.5, -9.4, 29.5, 1.1, -9.1), v(22.9, 1.5, -9.2, 29.5, 1.1, -9.1)];
      case "testimonios":
        return [v(24.1, 1.55, -11.0, 24.5, 0.95, -5), v(24.9, 1.5, -10.3, 24.5, 0.95, -5)];
      default: {
        const end = v(24.5, 1.35, -9.2, 24.5, 1.45, -4.5);
        return [end, end];
      }
    }
  });
}

// Three.js solo se descarga si se entra al recorrido, y la escena se crea una vez.
let apartment: Promise<Apartment> | null = null;
function loadApartment(canvas: HTMLCanvasElement) {
  apartment ??= import("./apartment").then(({ createApartment }) =>
    createApartment(canvas, JSON.parse(canvas.dataset.photos ?? "[]")),
  );
  return apartment;
}

/* ───────── Recorrido de escritorio ───────── */

interface Part {
  room: HTMLElement;
  label: string;
  inn: HTMLElement;
  out: HTMLElement;
  bg: HTMLElement | null;
  content: HTMLElement;
  hint: HTMLElement | null;
  reveal: HTMLElement[];
  grow: HTMLElement[];
  titles: HTMLElement[][];
  door: Door | null;
}

/** Lo que pasa mientras se está dentro de una escena, además del zoom lento de la foto. */
const dwell: Record<string, (tl: gsap.core.Timeline, part: Part) => void> = {
  fachada(tl, part) {
    // La puerta de entrada se abre hacia adentro.
    tl.to(part.room.querySelector(".leaf--l"), { rotationY: 84, duration: 0.75, ease: "power1.inOut" }, 0).to(
      part.room.querySelector(".leaf--r"),
      { rotationY: -84, duration: 0.75, ease: "power1.inOut" },
      0,
    );
  },
  testimonios(tl, part) {
    const quotes = gsap.utils.toArray<HTMLElement>(".quote", part.room);
    const dots = gsap.utils.toArray<HTMLElement>(".quote-dots i", part.room);
    gsap.set(dots[0], { opacity: 1 });
    quotes.forEach((quote, i) => {
      if (i === 0) return;
      tl.to(quotes[i - 1], { autoAlpha: 0, y: -24, duration: 0.3, ease: "power1.in" }, "+=0.4")
        .to(dots[i - 1], { opacity: 0.25, duration: 0.3 }, "<")
        .fromTo(quote, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power1.out" })
        .to(dots[i], { opacity: 1, duration: 0.35 }, "<");
    });
    tl.to({}, { duration: 0.4 });
  },
};

function buildWalk() {
  root.classList.add("walk");
  active = -1;

  const parts: Part[] = rooms.map((room, i) => ({
    room,
    label: room.id || `escena-${i}`,
    inn: room.querySelector<HTMLElement>(".room__in")!,
    out: room.querySelector<HTMLElement>(".room__out")!,
    bg: room.querySelector<HTMLElement>(".room__bg"),
    content: room.querySelector<HTMLElement>(".room__content")!,
    hint: room.querySelector<HTMLElement>(".room__hint, .door__hint"),
    reveal: gsap.utils.toArray<HTMLElement>("[data-reveal]", room),
    grow: gsap.utils.toArray<HTMLElement>("[data-grow]", room),
    titles: splitChars(room),
    door: doorOf(room),
  }));

  gsap.set(rooms, { autoAlpha: 0, zIndex: (i) => rooms.length - i });
  gsap.set(rooms[0], { autoAlpha: 1 });

  // Cámara: la línea de tiempo mueve `view` y el puntero añade un leve paralaje.
  const stops = cameraStops();
  const view: View = { ...stops[0][0] };
  const pointer = { x: 0, y: 0 };
  const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
  let apt: Apartment | null = null;
  let alive = true;
  // El scroll y el puntero pueden pedir dibujar varias veces en el mismo cuadro:
  // se marca como pendiente y se dibuja una sola vez por tick.
  let dirty = false;
  const draw = () => (dirty = true);
  // Calidad adaptativa: si los cuadros seguidos tardan demasiado, se apaga el posproceso.
  // Se puede forzar con ?q=alta o ?q=baja en la URL.
  const forced = new URLSearchParams(location.search).get("q");
  let adaptive = !forced;
  let painted = false;
  let lastPaint = 0;
  let slow = 0;
  const paint = () => {
    if (!dirty || !apt) return (painted = false);
    dirty = false;
    apt.render(view, pointer.x, pointer.y);
    // Se mide con el reloj real (el delta de GSAP viene recortado cuando hay retraso), y solo
    // cuenta como cuadro de 3D si en el tick anterior también se dibujó.
    const now = performance.now();
    const delta = now - lastPaint;
    lastPaint = now;
    if (adaptive && painted) {
      slow = delta > 42 ? slow + (delta > 200 ? 4 : 1) : Math.max(0, slow - 1);
      if (slow >= 10) {
        adaptive = false;
        apt.setQuality(false);
      }
    }
    painted = true;
  };
  gsap.ticker.add(paint);
  loadApartment(canvas)
    .then((ready) => {
      if (!alive) return;
      apt = ready;
      if (forced) apt.setQuality(forced !== "baja");
      apt.resize();
      draw();
      canvas.classList.add("is-ready");
    })
    .catch(() => root.classList.add("no3d"));

  const moveX = gsap.quickTo(pointer, "x", { duration: 0.9, ease: "power3", onUpdate: draw });
  const moveY = gsap.quickTo(pointer, "y", { duration: 0.9, ease: "power3", onUpdate: draw });
  const onPointer = (event: PointerEvent) => {
    moveX((event.clientX / window.innerWidth - 0.5) * 0.3);
    moveY((0.5 - event.clientY / window.innerHeight) * 0.12);
  };
  window.addEventListener("pointermove", onPointer);

  const tl = gsap.timeline({ defaults: { ease: "none" }, paused: true });
  /** Momento desde el que cada escena cuenta como "la actual". */
  const enterAt = [0];

  parts.forEach((part, i) => {
    tl.addLabel(part.label);

    // Estancia: lo propio de la escena y, mientras tanto, un zoom lento de la foto.
    const from = tl.duration();
    dwell[part.room.id]?.(tl, part);
    if (tl.duration() - from < 0.4) tl.to({}, { duration: 0.4 - (tl.duration() - from) });
    if (stops[i][0] !== stops[i][1]) tl.to(view, { ...stops[i][1], duration: tl.duration() - from }, from);

    const next = parts[i + 1];
    if (!next) return;

    const walk = `walk-${i}`;
    const leaving = [part.content, part.hint].filter(Boolean);
    let revealAt: string;

    if (part.door) {
      // Fachada: la pared crece hasta que el hueco de la puerta llena la pantalla, mientras
      // la cámara 3D avanza por el pasillo que se ve a través de él.
      const { ox, oy, S } = part.door;
      gsap.set(part.out, { transformOrigin: `${ox * 100}% ${oy * 100}%` });
      tl.addLabel(walk, "-=0.3")
        .to(leaving, { autoAlpha: 0, duration: 0.4 }, walk)
        .fromTo(part.out, { scale: 1 }, { scale: S, duration: 1, ease: approach(1, S) }, walk)
        .to(view, { ...stops[i + 1][0], duration: 1, ease: "sine.in" }, walk)
        .set(part.room, { autoAlpha: 0 }, `${walk}+=1`)
        .fromTo(next.room, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, `${walk}+=0.6`);
      revealAt = `${walk}+=0.65`;
    } else {
      // Entre escenas la cámara camina por el departamento; el texto se va y vuelve al llegar.
      tl.addLabel(walk)
        .to(part.room, { autoAlpha: 0, duration: 0.3 }, walk)
        .to(view, { ...stops[i + 1][0], duration: 1, ease: "power2.inOut" }, walk)
        .fromTo(next.room, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, `${walk}+=0.65`);
      revealAt = `${walk}+=0.75`;
    }

    // Entrada del contenido: titulares letra a letra saliendo del desenfoque, luego el resto.
    next.titles.forEach((chars, k) => {
      tl.fromTo(
        chars,
        BLUR_FROM,
        { ...BLUR_TO, duration: 0.3, stagger: { amount: 0.3 }, ease: "power2.out" },
        `${revealAt}+=${k * 0.1}`,
      );
    });
    if (next.reveal.length) {
      tl.fromTo(
        next.reveal,
        { autoAlpha: 0, y: 30 },
        { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power2.out" },
        `${revealAt}+=0.15`,
      );
    }
    if (next.grow.length) {
      tl.fromTo(
        next.grow,
        { autoAlpha: 0, scale: 0.6 },
        { autoAlpha: 1, scale: 1, duration: 0.6, ease: "power2.out" },
        revealAt,
      );
    }

    enterAt[i + 1] = tl.labels[walk] + 0.6;
  });

  const sync = () => {
    const t = tl.time();
    let index = 0;
    enterAt.forEach((at, i) => t >= at && (index = i));
    setActive(index, true);
  };

  const st = ScrollTrigger.create({
    animation: tl,
    trigger: house,
    start: "top top",
    end: () => `+=${tl.duration() * window.innerHeight * SCROLL_PER_UNIT}`,
    pin: true,
    scrub: 0.7,
    invalidateOnRefresh: true,
  });
  // Con scrub la línea de tiempo va por detrás del scroll: se sincroniza con ella, no con el scroll.
  tl.eventCallback("onUpdate", () => {
    sync();
    draw();
  });

  goTo = (id, instant) => {
    const at = tl.labels[id];
    if (at === undefined) return;
    const y = st.start + (st.end - st.start) * (at / tl.duration());
    const jump = () => {
      st.scroll(y);
      ScrollTrigger.update();
      st.getTween()?.progress(1);
      tl.progress(at / tl.duration());
      sync();
      draw();
    };
    if (instant) return jump();
    // Corte a negro: atravesar varias escenas a toda velocidad marea.
    gsap
      .timeline()
      .to(curtain, { autoAlpha: 1, duration: 0.3, ease: "power1.in" })
      .add(jump)
      .to(curtain, { autoAlpha: 0, duration: 0.55, ease: "power1.out" }, "+=0.15");
  };

  sync();

  return () => {
    alive = false;
    gsap.ticker.remove(paint);
    window.removeEventListener("pointermove", onPointer);
    root.classList.remove("walk");
    rooms.forEach((room) => (room.inert = false));
    active = -1;
  };
}

/* ───────── Escenas apiladas (móvil, tablet, movimiento reducido) ───────── */

function buildStacked(reduced: boolean) {
  root.classList.remove("walk");
  active = -1;

  goTo = (id, instant) => {
    const target = document.getElementById(id);
    if (!target) return;
    if (instant || reduced) return target.scrollIntoView();
    gsap.to(window, { scrollTo: { y: target, autoKill: true }, duration: 1, ease: "power2.inOut" });
  };

  rooms.forEach((room, i) => {
    ScrollTrigger.create({
      trigger: room,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (self) => self.isActive && setActive(i, false),
    });
  });
  setActive(0, false);

  if (reduced) return;

  rooms.forEach((room, i) => {
    // La foto se mueve un poco más lento que la página.
    const img = room.querySelector(".room__bg img");
    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.16, yPercent: i === 0 ? 0 : -5 },
        { scale: 1.16, yPercent: 5, ease: "none", scrollTrigger: { trigger: room, start: "top bottom", end: "bottom top", scrub: true } },
      );
    }
    splitChars(room).forEach((chars) => {
      gsap.fromTo(chars, BLUR_FROM, {
        ...BLUR_TO,
        duration: 0.9,
        stagger: { amount: 0.5 },
        ease: "power3.out",
        scrollTrigger: { trigger: chars[0], start: "top 90%", once: true },
      });
    });
  });

  const reveal = gsap.utils.toArray<HTMLElement>("[data-reveal], [data-grow]");
  gsap.set(reveal, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(reveal, {
    start: "top 90%",
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "power3.out", overwrite: true }),
  });
}

/* ───────── Entrada de la fachada ───────── */

function intro(reduced: boolean) {
  const wordmark = document.querySelector<HTMLElement>(".wordmark");
  if (!wordmark) return;
  gsap.set(wordmark, { visibility: "visible" });
  if (reduced) return;

  const split = SplitText.create(".wordmark span", { type: "chars", aria: "none" });
  gsap
    .timeline({ delay: 0.15 })
    .fromTo(split.chars, BLUR_FROM, { ...BLUR_TO, duration: 1.1, stagger: 0.05, ease: "power3.out" })
    .from("[data-hero]", { autoAlpha: 0, y: 20, duration: 0.9, stagger: 0.12, ease: "power3.out" }, "-=0.7");
}

/* ───────── Arranque ───────── */

function start() {
  const media = gsap.matchMedia();
  media.add({ walk: WALK, reduced: REDUCED, any: "all" }, (ctx) => {
    const { walk, reduced } = ctx.conditions as { walk: boolean; reduced: boolean };
    return walk ? buildWalk() : buildStacked(reduced);
  });
  return media;
}

let mm = start();

// La geometría de la puerta depende del tamaño de pantalla: al redimensionar
// dentro del recorrido se reconstruye y se vuelve a la sección en la que se estaba.
let size = `${window.innerWidth}x${window.innerHeight}`;
let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const now = `${window.innerWidth}x${window.innerHeight}`;
    if (now === size) return;
    size = now;
    if (!root.classList.contains("walk")) return;
    const id = rooms[Math.max(active, 0)].dataset.nav!;
    mm.revert();
    mm = start();
    goTo(id, true);
  }, 250);
});

document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest?.("a[href^='#']");
  if (!link) return;
  const id = link.getAttribute("href")!.slice(1);
  if (!document.getElementById(id)) return;
  event.preventDefault();
  goTo(id);
  history.replaceState(null, "", id === rooms[0].id ? location.pathname : `#${id}`);
});

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && document.getElementById(id)) goTo(id);
});

document.fonts.ready.then(() => {
  intro(window.matchMedia(REDUCED).matches);
  ScrollTrigger.refresh();
  // Llegada desde otra página con ancla (por ejemplo /#proyectos).
  const id = location.hash.slice(1);
  if (id && document.getElementById(id)) goTo(id, true);
});

/* ───────── Formulario de contacto ───────── */

const form = document.querySelector<HTMLFormElement>("[data-contact-form]");
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const subject = `Consulta de ${data.get("name")}`;
  const body = `${data.get("message")}\n\n${data.get("name")}\n${data.get("email")}`;
  location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const status = form.querySelector("[data-form-status]");
  if (status) status.textContent = "Se abrió tu aplicación de correo con la consulta lista para enviar.";
});
