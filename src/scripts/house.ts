import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";

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
  /** Escala inicial de la escena siguiente, vista a través del hueco. */
  s0: number;
  /** Exponente de paralaje: el fondo crece como (escala de la pared)^lag, siempre cubriendo el hueco. */
  lag: number;
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
 * La escena del fondo está más lejos, así que crece más despacio que la pared que cruzamos
 * (paralaje), pero nunca tan despacio como para dejar ver el vacío por el hueco de la puerta.
 */
const beyondEase = ({ S, s0, lag }: Door) => {
  const wall = approach(1, S);
  return (p: number) => (Math.min(1, s0 * (1 + wall(p) * (S - 1)) ** lag) - s0) / (1 - s0);
};

/* ───────── Texto ───────── */

/** Letras de los titulares marcados con data-blur, listas para entrar desenfocadas. */
function splitChars(scope: HTMLElement) {
  return gsap.utils
    .toArray<HTMLElement>("[data-blur]", scope)
    .map((el) => SplitText.create(el, { type: "words,chars" }).chars as HTMLElement[]);
}

const BLUR_FROM = { autoAlpha: 0, filter: "blur(14px)", yPercent: 22 };
const BLUR_TO = { autoAlpha: 1, filter: "blur(0px)", yPercent: 0 };

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
  // Tras la puerta de entrada se ve desde el inicio el interior real.
  gsap.set(rooms.slice(0, 2), { autoAlpha: 1 });

  const tl = gsap.timeline({ defaults: { ease: "none" }, paused: true });
  /** Momento desde el que cada escena cuenta como "la actual". */
  const enterAt = [0];

  parts.forEach((part, i) => {
    tl.addLabel(part.label);

    // Estancia: lo propio de la escena y, mientras tanto, un zoom lento de la foto.
    const from = tl.duration();
    dwell[part.room.id]?.(tl, part);
    if (tl.duration() - from < 0.4) tl.to({}, { duration: 0.4 - (tl.duration() - from) });
    if (part.bg && !part.door) tl.to(part.bg, { scale: 1.08, duration: tl.duration() - from }, from);

    const next = parts[i + 1];
    if (!next) return;

    const walk = `walk-${i}`;
    const leaving = [part.content, part.hint].filter(Boolean);
    let revealAt: string;

    if (part.door) {
      // Fachada: se cruza el hueco de la puerta; la pared crece y la escena del fondo se acerca.
      const { ox, oy, S, s0 } = part.door;
      const origin = `${ox * 100}% ${oy * 100}%`;
      gsap.set(part.out, { transformOrigin: origin });
      gsap.set(next.inn, { transformOrigin: origin });
      tl.addLabel(walk, "-=0.3")
        .to(leaving, { autoAlpha: 0, duration: 0.4 }, walk)
        .fromTo(part.out, { scale: 1 }, { scale: S, duration: 1, ease: approach(1, S) }, walk)
        .fromTo(next.inn, { scale: s0 }, { scale: 1, duration: 1, ease: beyondEase(part.door) }, walk)
        .set(part.room, { autoAlpha: 0 }, `${walk}+=1`);
      revealAt = `${walk}+=0.6`;
    } else {
      // Zoom continuo: la foto actual se acerca a su punto de interés y se funde con la
      // siguiente, que llega todavía ampliada y termina de asentarse.
      tl.addLabel(walk)
        .to(leaving, { autoAlpha: 0, duration: 0.3 }, walk)
        .set(next.room, { autoAlpha: 1 }, walk)
        .to(part.room, { autoAlpha: 0, duration: 0.5, ease: "power1.in" }, `${walk}+=0.45`);
      if (part.bg) tl.to(part.bg, { scale: 2.2, duration: 0.95, ease: "power2.in" }, walk);
      if (next.bg) tl.fromTo(next.bg, { scale: 1.32 }, { scale: 1, duration: 0.95, ease: "power2.out" }, `${walk}+=0.4`);
      revealAt = `${walk}+=0.8`;
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
    // Corte a negro: atravesar varias escenas a toda velocidad marea.
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
