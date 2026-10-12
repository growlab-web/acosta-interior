import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);

const mm = gsap.matchMedia();

mm.add("(prefers-reduced-motion: no-preference)", () => {
  // Entrada: el título sube letra a letra y la portada se abre como una puerta.
  document.fonts.ready.then(() => {
    SplitText.create(".project__title", {
      type: "chars",
      mask: "chars",
      onSplit: (self) => gsap.from(self.chars, { yPercent: 110, duration: 1.1, stagger: 0.03, ease: "power4.out" }),
    });
  });

  gsap.from("[data-in]", { autoAlpha: 0, y: 18, duration: 0.9, stagger: 0.12, ease: "power3.out", delay: 0.2 });
  gsap.from("[data-cover]", { clipPath: "inset(0 50% 0 50%)", duration: 1.5, ease: "power3.inOut", delay: 0.25 });

  // La portada se desplaza más lento que la página.
  gsap.fromTo(
    "[data-cover] img",
    { yPercent: 0 },
    {
      yPercent: -13,
      ease: "none",
      scrollTrigger: { trigger: "[data-cover]", start: "top bottom", end: "bottom top", scrub: true },
    },
  );

  const reveal = gsap.utils.toArray<HTMLElement>("[data-reveal]");
  gsap.set(reveal, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(reveal, {
    start: "top 88%",
    once: true,
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.1, ease: "power3.out" }),
  });

  gsap.utils.toArray<HTMLElement>("[data-shot]").forEach((shot) => {
    gsap.from(shot, {
      clipPath: "inset(100% 0 0 0)",
      duration: 1.3,
      ease: "power3.inOut",
      scrollTrigger: { trigger: shot, start: "top 86%", once: true },
    });
    gsap.from(shot.querySelector("img"), {
      scale: 1.18,
      duration: 1.6,
      ease: "power3.out",
      scrollTrigger: { trigger: shot, start: "top 86%", once: true },
    });
  });
});
