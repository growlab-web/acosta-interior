import type { ImageMetadata } from "astro";

const files = import.meta.glob<{ default: ImageMetadata }>("../assets/photos/*.jpg", { eager: true });

/** Foto por nombre de archivo (sin extensión) dentro de src/assets/photos. */
export function photo(name: string): ImageMetadata {
  const hit = files[`../assets/photos/${name}.jpg`];
  if (!hit) throw new Error(`Falta la foto src/assets/photos/${name}.jpg`);
  return hit.default;
}

export const studio = {
  name: "Acosta Interior",
  tagline: "Estudio de diseño interior",
  city: "Lima, Perú",
  email: "contacto@acostainterior.com",
  instagram: "https://instagram.com",
  linkedin: "https://linkedin.com",
};

/** Las habitaciones de la casa, en el orden del recorrido. */
export const rooms = [
  { id: "fachada", room: "Fachada", section: "Inicio" },
  { id: "estudio", room: "Recibidor", section: "El estudio" },
  { id: "proyectos", room: "Sala", section: "Proyectos" },
  { id: "servicios", room: "Cocina", section: "Servicios" },
  { id: "testimonios", room: "Comedor", section: "Testimonios" },
  { id: "contacto", room: "Estudio", section: "Contacto" },
] as const;

export type RoomId = (typeof rooms)[number]["id"];

export interface Project {
  slug: string;
  title: string;
  year: string;
  category: string;
  place: string;
  description: string;
  tags: string[];
  /** Nombres de archivo: `${slug}-0` es la portada. */
  images: string[];
}

export const projects: Project[] = [
  {
    slug: "casa-miraflores",
    title: "Casa Miraflores",
    year: "2024",
    category: "Residencial",
    place: "Miraflores, Lima",
    description:
      "Vivienda unifamiliar con énfasis en materiales naturales y luz natural. El proyecto explora la relación entre los espacios interiores y el jardín que la rodea, con una continuidad fluida entre adentro y afuera.",
    tags: ["Luz natural", "Materiales naturales", "Jardín"],
    images: ["miraflores-0", "miraflores-1", "miraflores-2", "miraflores-3"],
  },
  {
    slug: "oficinas-palomino",
    title: "Oficinas Palomino",
    year: "2023",
    category: "Comercial",
    place: "Centro de Lima",
    description:
      "Espacio de trabajo colaborativo para una empresa creativa. El diseño integra zonas de trabajo abierto, cabinas privadas y áreas de descanso bajo una misma idea de fluidez espacial.",
    tags: ["Corporativo", "Planta abierta", "Trabajo colaborativo"],
    images: ["palomino-0", "palomino-1", "palomino-2", "palomino-3"],
  },
  {
    slug: "loft-barranco",
    title: "Loft Barranco",
    year: "2023",
    category: "Residencial",
    place: "Barranco, Lima",
    description:
      "Rehabilitación de un espacio industrial en Barranco. La intervención conserva la estructura original y suma nuevas capas de materialidad contemporánea: madera, fibras naturales y color en dosis medidas.",
    tags: ["Loft", "Industrial", "Rehabilitación"],
    images: ["barranco-0", "barranco-1", "barranco-2", "barranco-3"],
  },
  {
    slug: "galeria-norte",
    title: "Galería Norte",
    year: "2024",
    category: "Conceptual",
    place: "Lima",
    description:
      "Proyecto conceptual para una galería de arte contemporáneo. Una secuencia de ambientes guía al visitante en un recorrido sensorial donde la arquitectura enmarca la obra expuesta.",
    tags: ["Galería", "Arte contemporáneo", "Conceptual"],
    images: ["galeria-0", "galeria-1", "galeria-2", "galeria-3"],
  },
  {
    slug: "residencia-san-isidro",
    title: "Residencia San Isidro",
    year: "2022",
    category: "Residencial",
    place: "San Isidro, Lima",
    description:
      "Apartamento de alto estándar rediseñado con una paleta de materiales nobles: mármol travertino, madera de roble y bronce envejecido. El proyecto equilibra la representación con la intimidad doméstica.",
    tags: ["Materiales nobles", "Apartamento", "Detalle a medida"],
    images: ["sanisidro-0", "sanisidro-1", "sanisidro-2", "sanisidro-3"],
  },
];

export const services = [
  {
    title: "Arquitectura de interiores",
    text: "Gestión completa de reformas, del concepto a la ejecución: obra, iluminación, fontanería y climatización.",
  },
  {
    title: "Mobiliario a medida",
    text: "Diseño y fabricación de piezas exclusivas, gabinetes y estanterías pensadas para cada espacio.",
  },
  {
    title: "Styling",
    text: "Selección y disposición de accesorios, textiles, iluminación y objetos que terminan de dar carácter.",
  },
  {
    title: "Supervisión de proyectos",
    text: "Seguimiento en obra para que el diseño se ejecute tal como fue concebido, fiel a materiales y detalles.",
  },
  {
    title: "Ejecución de proyectos",
    text: "Coordinación de contratistas, proveedores, tiempos y costos para llegar al resultado en plazo y presupuesto.",
  },
  {
    title: "Asesorías integrales",
    text: "Consultas por horas para resolver dudas de diseño, funcionalidad, paletas de color o distribución.",
  },
];

export const testimonials = [
  {
    quote: "El equipo de Andrea entregó espacios que superaron incluso nuestras expectativas más altas.",
    author: "María y Carlos Vega",
    project: "Casa Miraflores",
  },
  {
    quote: "Andrea convierte una visión artística en espacios habitables y gestiona sin problemas toda la complejidad de la obra.",
    author: "Sofía Ramírez",
    project: "Oficinas Palomino",
  },
  {
    quote: "Desde el primer día quedó claro que estábamos en manos expertas. Cada detalle estuvo perfectamente coordinado.",
    author: "Familia Torres",
    project: "Loft Barranco",
  },
];
