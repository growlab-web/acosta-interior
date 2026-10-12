import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);

/** Debe coincidir con la consulta del script inline de Base.astro. */
const WALK = "(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";
const REDUCED = "(prefers-reduced-motion: reduce)";
/** Línea donde la pared toca el piso, en fracción del alto (--floor-line). */
const FLOOR = 0.76;
/** Cuánto scroll (en altos de pantalla) dura una unidad de la línea de tiempo. */
const SCROLL_PER_UNIT = 0.62;

const root = document.documentElement;
const house = document.querySelector<HTMLElement>("#house")!;
const rooms = gsap.utils.toArray<HTMLElement>(".room", house);
const curtain = document.querySelector<HTMLElement>(".curtain")!;

type GoTo = (id: string, instant?: boolean) => void;
let goTo: GoTo = () => {};

/* ───────── Estado de navegación (cabecera + plano) ───────── */

const navLinks = gsap.utils.toArray<HTMLElement>("[data-nav]");
const planLinks = gsap.utils.toArray<SVGAElement>("[data-plan]");
const planRoom = document.querySelector("[data-plan-room]");
const planSection = document.querySelector("[data-plan-section]");
let active = -1;

function setActive(index: number, trapFocus: boolean) {
  if (index === active) return;
  active = index;
  const id = rooms[index].id;
  navLinks.forEach((a) => a.setAttribute("aria-current", String(a.dataset.nav === id)));
  planLinks.forEach((a) => {
    const on = a.dataset.plan === id;
    a.setAttribute("aria-current", String(on));
    if (on) {
      if (planRoom) planRoom.textContent = a.dataset.room ?? "";
      if (planSection) planSection.textContent = a.dataset.section ?? "";
    }
  });
  // En el recorrido solo la habitación actual es interactiva.
  rooms.forEach((room, i) => (room.inert = trapFocus && i !== index));
}

/* ───────── Geometría de las puertas ───────── */

interface Door {
  ox: number;
  oy: number;
  /** Escala con la que el hueco cubre toda la pantalla. */
  S: number;
  /** Escala inicial de la habitación siguiente, vista a través del hueco. */
  s0: number;
  /** Exponente de paralaje: el fondo crece como (escala de la pared)^lag, siempre cubriendo el hueco. */
  lag: number;
}

function doorOf(room: HTMLElement): Door | null {
  // Se mide el hueco real (offset*, sin transformaciones): la puerta de la fachada
  // depende de la proporción de la pantalla porque sale del render de fondo.
  const el = room.querySelector<HTMLElement>(".door");
  if (!el) return null;
  const w = el.offsetWidth / window.innerWidth;
  const top = el.offsetTop / window.innerHeight;
  // En la sala la puerta está al final de la pared y acaba centrada tras recorrerla.
  const x = room.classList.contains("room--wide") ? 0.5 - w / 2 : el.offsetLeft / window.innerWidth;
  const L = x;
  const R = x + w;
  const ox = x + w / 2;
  const oy = (top + FLOOR) / 2;
  const S = Math.max(ox / (ox - L), (1 - ox) / (R - ox), oy / (oy - top), (1 - oy) / (FLOOR - oy)) * 1.03;
  // Lado del hueco que más tarda en salir de pantalla: fija cuánto puede "retrasarse" el fondo.
  const tight = Math.max((ox - L) / ox, (R - ox) / (1 - ox), (oy - top) / oy, (FLOOR - oy) / (1 - oy));
  const s0 = Math.min(0.86, tight + 0.2);
  return { ox, oy, S, s0, lag: Math.log(s0) / Math.log(tight) };
}

/**
 * Easing de perspectiva: al acercarse a un plano su tamaño aparente crece como 1/distancia,
 * no de forma lineal. Devuelve el progreso normalizado para ir de la escala `a` a la `b`.
 */
const approach = (a: number, b: number) => (p: number) => (a / (1 - p * (1 - a / b)) - a) / (b - a);

/**
 * La habitación del fondo está más lejos, así que crece más despacio que la pared que cruzamos
 * (paralaje), pero nunca tan despacio como para dejar ver el vacío por el hueco de la puerta.
 */
const beyondEase = ({ S, s0, lag }: Door) => {
  const wall = approach(1, S);
  return (p: number) => (Math.min(1, s0 * (1 + wall(p) * (S - 1)) ** lag) - s0) / (1 - s0);
};

/* ───────── Recorrido de escritorio ───────── */

interface Part {
  room: HTMLElement;
  id: string;
  inn: HTMLElement;
  out: HTMLElement;
  pan: HTMLElement;
  shade: HTMLElement;
  content: HTMLElement;
  beyond: HTMLElement | null;
  reveal: HTMLElement[];
  door: Door | null;
}

type Dwell = (tl: gsap.core.Timeline, part: Part, next?: Part) => void;

/** Lo que pasa mientras se está dentro de cada habitación, antes de caminar a la siguiente. */
const dwell: Record<string, Dwell> = {
  fachada(tl, part) {
    // La puerta de entrada se abre hacia adentro.
    tl.to(part.room.querySelector(".leaf--l"), { rotationY: 84, duration: 0.75, ease: "power1.inOut" }, 0).to(
      part.room.querySelector(".leaf--r"),
      { rotationY: -84, duration: 0.75, ease: "power1.inOut" },
      0,
    );
  },
  estudio(tl, part) {
    tl.fromTo(part.room.querySelector(".doorway--hang img"), { yPercent: 0 }, { yPercent: -10, duration: 0.6 });
  },
  proyectos(tl, part, next) {
    // Se camina a lo largo de la pared hasta que la puerta queda centrada.
    const travel = () => part.pan.scrollWidth - window.innerWidth;
    tl.to(part.pan, { x: () => -travel(), duration: 3.4, ease: "sine.inOut" });
    if (next) tl.fromTo(next.inn, { x: () => window.innerWidth * 0.2 }, { x: 0, duration: 1.4, ease: "sine.out" }, "<2");
  },
  servicios(tl, part) {
    tl.fromTo(part.room.querySelector(".doorway--hang img"), { yPercent: 0 }, { yPercent: -10, duration: 0.6 });
  },
  testimonios(tl, part) {
    const quotes = gsap.utils.toArray<HTMLElement>(".quote", part.room);
    const dots = gsap.utils.toArray<HTMLElement>(".quote-dots i", part.room);
    gsap.set(dots[0], { opacity: 1 });
    quotes.forEach((quote, i) => {
      if (i === 0) return;
      tl.to(quotes[i - 1], { autoAlpha: 0, y: -24, duration: 0.3, ease: "power1.in" }, "+=0.4")
        .to(dots[i - 1], { opacity: 0.2, duration: 0.3 }, "<")
        .fromTo(quote, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power1.out" })
        .to(dots[i], { opacity: 1, duration: 0.35 }, "<");
    });
    tl.to({}, { duration: 0.4 });
  },
  contacto(tl) {
    tl.to({}, { duration: 0.35 });
  },
};

function buildWalk() {
  root.classList.add("walk");
  active = -1;

  const pick = <T extends HTMLElement>(el: HTMLElement, sel: string) => el.querySelector<T>(sel)!;
  const parts: Part[] = rooms.map((room) => ({
    room,
    id: room.id,
    inn: pick(room, ".room__in"),
    out: pick(room, ".room__out"),
    pan: pick(room, ".room__pan"),
    shade: pick(room, ".room__shade"),
    content: pick(room, ".room__content"),
    beyond: room.querySelector<HTMLElement>(".door__beyond"),
    reveal: gsap.utils.toArray<HTMLElement>("[data-reveal]", room),
    door: doorOf(room),
  }));

  gsap.set(rooms, { autoAlpha: 0, zIndex: (i) => rooms.length - i });
  gsap.set(rooms.slice(0, 2), { autoAlpha: 1 });
  // Tras la puerta de entrada se ve desde el inicio el interior real, no el relleno.
  gsap.set(parts[0].beyond, { autoAlpha: 0 });

  const tl = gsap.timeline({ defaults: { ease: "none" }, paused: true });
  /** Momento desde el que cada habitación cuenta como "la actual". */
  const enterAt = [0];

  parts.forEach((part, i) => {
    tl.addLabel(part.id);
    dwell[part.id]?.(tl, part, parts[i + 1]);

    const next = parts[i + 1];
    if (!next || !part.door) return;

    const { ox, oy, S, s0 } = part.door;
    const origin = `${ox * 100}% ${oy * 100}%`;
    const walk = `walk-${i}`;
    gsap.set(part.out, { transformOrigin: origin });
    gsap.set(next.inn, { transformOrigin: origin });
    gsap.set(next.shade, { opacity: 0.2 });
    const far = beyondEase(part.door);

    // En la fachada se empieza a caminar mientras la puerta termina de abrirse.
    tl.addLabel(walk, part.id === "fachada" ? "-=0.3" : ">")
      .to([part.content, part.room.querySelector(".door__hint")], { autoAlpha: 0, duration: 0.4 }, walk)
      .fromTo(part.out, { scale: 1 }, { scale: S, duration: 1, ease: approach(1, S) }, walk)
      .fromTo(next.inn, { scale: s0 }, { scale: 1, duration: 1, ease: far }, walk)
      .to(next.shade, { opacity: 0, duration: 0.7 }, walk)
      .set(part.room, { autoAlpha: 0 }, `${walk}+=1`)
      .fromTo(
        next.reveal,
        { autoAlpha: 0, y: 34 },
        { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.045, ease: "power2.out" },
        `${walk}+=0.6`,
      );

    // La habitación de más allá solo se enciende cuando ya estamos entrando a la siguiente.
    const beyond = parts[i + 2];
    if (beyond && next.beyond) {
      tl.set(beyond.room, { autoAlpha: 1 }, `${walk}+=0.68`).to(next.beyond, { autoAlpha: 0, duration: 0.3 }, `${walk}+=0.7`);
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
  tl.eventCallback("onUpdate", sync);

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
    };
    if (instant) return jump();
    // Corte a negro: atravesar varias habitaciones a toda velocidad marea.
    gsap
      .timeline()
      .to(curtain, { autoAlpha: 1, duration: 0.3, ease: "power1.in" })
      .add(jump)
      .to(curtain, { autoAlpha: 0, duration: 0.55, ease: "power1.out" }, "+=0.15");
  };

  sync();

  return () => {
    root.classList.remove("walk");
    rooms.forEach((room) => (room.inert = false));
    active = -1;
  };
}

/* ───────── Secciones apiladas (móvil, tablet, movimiento reducido) ───────── */

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

  if (reduced) return;

  // Cada foto es un umbral: las hojas de la puerta se abren al llegar.
  gsap.utils.toArray<HTMLElement>("[data-doorway]").forEach((el, i) => {
    const leaves = el.querySelectorAll(".doorway__leaf");
    if (i === 0) {
      gsap.to(leaves, { scaleX: 0, duration: 1.4, ease: "power3.inOut", delay: 0.5 });
      return;
    }
    gsap.to(leaves, {
      scaleX: 0,
      ease: "none",
      scrollTrigger: { trigger: el, start: "top 85%", end: "top 30%", scrub: 0.5 },
    });
  });

  const reveal = gsap.utils.toArray<HTMLElement>("[data-reveal]");
  gsap.set(reveal, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(reveal, {
    start: "top 88%",
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

  const split = SplitText.create(".wordmark span", { type: "chars", mask: "chars", aria: "none" });
  gsap
    .timeline({ delay: 0.15 })
    .from(split.chars, { yPercent: 110, duration: 1.2, stagger: 0.04, ease: "power4.out" })
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

// La geometría de las puertas depende del tamaño de pantalla: al redimensionar
// dentro del recorrido se reconstruye y se vuelve a la habitación en la que se estaba.
let size = `${window.innerWidth}x${window.innerHeight}`;
let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const now = `${window.innerWidth}x${window.innerHeight}`;
    if (now === size) return;
    size = now;
    if (!root.classList.contains("walk")) return;
    const id = rooms[Math.max(active, 0)].id;
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
