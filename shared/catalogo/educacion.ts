// Catálogo oficial de enseñanzas, cursos y materias del sistema educativo español (LOMLOE).
//
// Fuentes:
// - Educación Primaria: Real Decreto 157/2022, art. 8 (BOE-A-2022-3296).
// - ESO: Real Decreto 217/2022, arts. 8, 9, 10 y 24 (BOE-A-2022-4975).
// - Bachillerato: Real Decreto 243/2022, arts. 9 a 14 (BOE-A-2022-5521).
// - Formación Profesional: catálogo de títulos del Ministerio en todofp.es (fp.json,
//   generado con scripts/catalogo-fp.mjs).
// Las comunidades autónomas pueden añadir materias propias; por eso siempre se puede
// escribir una asignatura que no esté en la lista.
import fp from './fp.json';

export type Etapa = 'primaria' | 'eso' | 'bachillerato' | 'fp-basica' | 'fp-medio' | 'fp-superior' | 'libre';

export interface InfoEtapa {
  id: Etapa;
  nombre: string;
  corto: string;
  edades?: string;
}

export const ETAPAS: InfoEtapa[] = [
  { id: 'primaria', nombre: 'Educación Primaria', corto: 'Primaria', edades: '6-12 años' },
  { id: 'eso', nombre: 'Educación Secundaria Obligatoria', corto: 'ESO', edades: '12-16 años' },
  { id: 'bachillerato', nombre: 'Bachillerato', corto: 'Bachillerato', edades: '16-18 años' },
  { id: 'fp-basica', nombre: 'FP de Grado Básico', corto: 'FP Básica' },
  { id: 'fp-medio', nombre: 'FP de Grado Medio', corto: 'FP Grado Medio' },
  { id: 'fp-superior', nombre: 'FP de Grado Superior', corto: 'FP Grado Superior' },
  { id: 'libre', nombre: 'Otra (libre)', corto: 'Otra' },
];

export const esFP = (e?: string): e is 'fp-basica' | 'fp-medio' | 'fp-superior' => !!e && e.startsWith('fp-');

// ---------------------------------------------------------------------------
// Idiomas oficiales en España (Constitución y estatutos de autonomía)

export const IDIOMAS = [
  'Castellano',
  'Catalán',
  'Valenciano',
  'Gallego',
  'Euskera',
  'Aranés (occitano)',
];

/** Nombre de la materia de lengua cooficial según el idioma. */
const LENGUA_COOFICIAL: Record<string, string> = {
  Catalán: 'Lengua Catalana y Literatura',
  Valenciano: 'Valenciano: Lengua y Literatura',
  Gallego: 'Lengua Gallega y Literatura',
  Euskera: 'Lengua Vasca y Literatura',
  'Aranés (occitano)': 'Lengua Aranesa y Literatura',
};

const LENGUAS_EXTRANJERAS = ['Inglés', 'Francés', 'Alemán', 'Italiano', 'Portugués'];

// ---------------------------------------------------------------------------
// Cursos

export interface Curso {
  id: string;
  nombre: string; // «3º de ESO»
  edad?: string;
}

const cursos = (n: number, etapa: string, edadInicial: number): Curso[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${i + 1}`, nombre: `${i + 1}º de ${etapa}`, edad: `${edadInicial + i}-${edadInicial + i + 1} años` }));

export const CURSOS: Partial<Record<Etapa, Curso[]>> = {
  primaria: cursos(6, 'Primaria', 6),
  eso: cursos(4, 'ESO', 12),
  bachillerato: cursos(2, 'Bachillerato', 16),
  'fp-basica': [
    { id: '1', nombre: '1.er curso' },
    { id: '2', nombre: '2.º curso' },
  ],
  'fp-medio': [
    { id: '1', nombre: '1.er curso' },
    { id: '2', nombre: '2.º curso' },
  ],
  'fp-superior': [
    { id: '1', nombre: '1.er curso' },
    { id: '2', nombre: '2.º curso' },
  ],
};

// ---------------------------------------------------------------------------
// Modalidades de Bachillerato (RD 243/2022, art. 8)

export const MODALIDADES_BACHILLERATO = [
  { id: 'ciencias', nombre: 'Ciencias y Tecnología' },
  { id: 'humanidades', nombre: 'Humanidades y Ciencias Sociales' },
  { id: 'artes-plasticas', nombre: 'Artes: Artes Plásticas, Imagen y Diseño' },
  { id: 'artes-musica', nombre: 'Artes: Música y Artes Escénicas' },
  { id: 'general', nombre: 'General' },
];

// ---------------------------------------------------------------------------
// Materias

export interface Materia {
  nombre: string;
  grupo: string; // «Troncal», «Específica de modalidad», «Optativa»…
}

function lenguas(idioma: string | undefined, sufijo = ''): Materia[] {
  const res: Materia[] = [{ nombre: `Lengua Castellana y Literatura${sufijo}`, grupo: 'Común' }];
  const coof = idioma && LENGUA_COOFICIAL[idioma];
  if (coof) res.push({ nombre: `${coof}${sufijo}`, grupo: 'Común' });
  return res;
}

const extranjeras = (sufijo = '', grupo = 'Común'): Materia[] =>
  LENGUAS_EXTRANJERAS.map((l) => ({ nombre: `Lengua Extranjera${sufijo}: ${l}`, grupo }));

const segundas = (sufijo = ''): Materia[] =>
  LENGUAS_EXTRANJERAS.map((l) => ({ nombre: `Segunda Lengua Extranjera${sufijo}: ${l}`, grupo: 'Optativa' }));

const m = (grupo: string, ...nombres: string[]): Materia[] => nombres.map((nombre) => ({ nombre, grupo }));

function materiasPrimaria(curso: number, idioma?: string): Materia[] {
  return [
    ...m(
      'Área',
      'Conocimiento del Medio Natural, Social y Cultural',
      'Ciencias de la Naturaleza',
      'Ciencias Sociales',
      'Educación Artística',
      'Educación Plástica y Visual',
      'Música y Danza',
      'Educación Física',
    ),
    ...lenguas(idioma).map((x) => ({ ...x, grupo: 'Área' })),
    ...extranjeras('', 'Área'),
    ...m('Área', 'Matemáticas'),
    ...(curso >= 5 ? m('Área (tercer ciclo)', 'Educación en Valores Cívicos y Éticos') : []),
    ...segundas(),
    ...m('Otras', 'Religión', 'Lengua de Signos Española'),
  ];
}

function materiasESO(curso: number, idioma?: string): Materia[] {
  if (curso <= 3) {
    return [
      ...m('Materia', 'Biología y Geología', 'Educación Física', 'Educación Plástica, Visual y Audiovisual', 'Física y Química', 'Geografía e Historia'),
      ...lenguas(idioma).map((x) => ({ ...x, grupo: 'Materia' })),
      ...extranjeras('', 'Materia'),
      ...m('Materia', 'Matemáticas', 'Música', 'Tecnología y Digitalización', 'Educación en Valores Cívicos y Éticos'),
      ...m('Optativa', 'Cultura Clásica'),
      ...segundas(),
      ...(curso === 3 ? m('Diversificación curricular', 'Ámbito Lingüístico y Social', 'Ámbito Científico-Tecnológico') : []),
      ...m('Otras', 'Religión', 'Lengua de Signos Española'),
    ];
  }
  return [
    ...m('Común', 'Educación Física', 'Geografía e Historia'),
    ...lenguas(idioma),
    ...extranjeras(),
    ...m('Común', 'Matemáticas A', 'Matemáticas B', 'Educación en Valores Cívicos y Éticos'),
    ...m(
      'De opción',
      'Biología y Geología',
      'Digitalización',
      'Economía y Emprendimiento',
      'Expresión Artística',
      'Física y Química',
      'Formación y Orientación Personal y Profesional',
      'Latín',
      'Música',
      'Tecnología',
    ),
    ...segundas(),
    ...m('Diversificación curricular', 'Ámbito Lingüístico y Social', 'Ámbito Científico-Tecnológico'),
    ...m('Otras', 'Religión', 'Lengua de Signos Española'),
  ];
}

const MODALIDAD: Record<string, [string[], string[]]> = {
  // [primer curso, segundo curso] (RD 243/2022, arts. 10-13)
  ciencias: [
    ['Matemáticas I', 'Biología, Geología y Ciencias Ambientales', 'Dibujo Técnico I', 'Física y Química', 'Tecnología e Ingeniería I'],
    ['Matemáticas II', 'Matemáticas Aplicadas a las Ciencias Sociales II', 'Biología', 'Dibujo Técnico II', 'Física', 'Geología y Ciencias Ambientales', 'Química', 'Tecnología e Ingeniería II'],
  ],
  humanidades: [
    ['Latín I', 'Matemáticas Aplicadas a las Ciencias Sociales I', 'Economía', 'Griego I', 'Historia del Mundo Contemporáneo', 'Literatura Universal'],
    ['Latín II', 'Matemáticas Aplicadas a las Ciencias Sociales II', 'Empresa y Diseño de Modelos de Negocio', 'Geografía', 'Griego II', 'Historia del Arte'],
  ],
  'artes-plasticas': [
    ['Dibujo Artístico I', 'Cultura Audiovisual', 'Dibujo Técnico Aplicado a las Artes Plásticas y al Diseño I', 'Proyectos Artísticos', 'Volumen'],
    ['Dibujo Artístico II', 'Dibujo Técnico Aplicado a las Artes Plásticas y al Diseño II', 'Diseño', 'Fundamentos Artísticos', 'Técnicas de Expresión Gráfico-plástica'],
  ],
  'artes-musica': [
    ['Análisis Musical I', 'Artes Escénicas I', 'Coro y Técnica Vocal I', 'Cultura Audiovisual', 'Lenguaje y Práctica Musical'],
    ['Análisis Musical II', 'Artes Escénicas II', 'Coro y Técnica Vocal II', 'Historia de la Música y de la Danza', 'Literatura Dramática'],
  ],
  general: [
    ['Matemáticas Generales', 'Economía, Emprendimiento y Actividad Empresarial'],
    ['Ciencias Generales', 'Movimientos Culturales y Artísticos'],
  ],
};

function materiasBachillerato(curso: number, modalidad?: string, idioma?: string): Materia[] {
  const sufijo = curso === 1 ? ' I' : ' II';
  const comunes =
    curso === 1
      ? [...m('Común', 'Educación Física', 'Filosofía'), ...lenguas(idioma, sufijo), ...extranjeras(sufijo)]
      : [...m('Común', 'Historia de España', 'Historia de la Filosofía'), ...lenguas(idioma, sufijo), ...extranjeras(sufijo)];
  // En la modalidad General se puede cursar cualquier materia de modalidad del curso
  const claves = !modalidad ? Object.keys(MODALIDAD) : modalidad === 'general' ? Object.keys(MODALIDAD) : [modalidad];
  const deModalidad = [...new Set(claves.flatMap((k) => MODALIDAD[k][curso - 1]))];
  return [...comunes, ...m('Específica de modalidad', ...deModalidad), ...segundas(sufijo), ...m('Otras', 'Religión')];
}

/** Materias oficiales de un curso. */
export function materias(etapa: Etapa, curso?: string, opciones: { modalidad?: string; idioma?: string } = {}): Materia[] {
  const n = Number(curso) || 1;
  if (etapa === 'primaria') return materiasPrimaria(n, opciones.idioma);
  if (etapa === 'eso') return materiasESO(n, opciones.idioma);
  if (etapa === 'bachillerato') return materiasBachillerato(n, opciones.modalidad, opciones.idioma);
  return [];
}

// ---------------------------------------------------------------------------
// Formación Profesional

export interface ModuloFP {
  codigo?: string;
  nombre: string;
}

export interface TituloFP {
  nombre: string;
  nivel: 'fp-basica' | 'fp-medio' | 'fp-superior';
  horas?: number;
  url: string;
  modulos: ModuloFP[];
}

export interface FamiliaFP {
  nombre: string;
  titulos: TituloFP[];
}

export const CATALOGO_FP = fp as { fuente: string; generado: string; familias: FamiliaFP[] };

/** Familias profesionales que tienen títulos del nivel indicado. */
export function familiasFP(nivel: Etapa): FamiliaFP[] {
  return CATALOGO_FP.familias
    .map((f) => ({ ...f, titulos: f.titulos.filter((t) => t.nivel === nivel) }))
    .filter((f) => f.titulos.length > 0);
}

// ---------------------------------------------------------------------------
// Textos derivados

export interface Ensenanza {
  etapa?: Etapa;
  curso?: string;
  modalidad?: string;
  familia?: string;
  titulo?: string;
}

/** Descripción del nivel: «3º de ESO», «1º de Bachillerato · Ciencias y Tecnología», «Técnico en… (2.º curso)». */
export function describirNivel(e: Ensenanza): string {
  if (!e.etapa || e.etapa === 'libre') return '';
  const curso = CURSOS[e.etapa]?.find((c) => c.id === e.curso);
  if (esFP(e.etapa)) {
    return [e.titulo || ETAPAS.find((x) => x.id === e.etapa)!.nombre, curso && `(${curso.nombre})`].filter(Boolean).join(' ');
  }
  const mod = MODALIDADES_BACHILLERATO.find((x) => x.id === e.modalidad)?.nombre;
  return [curso?.nombre ?? ETAPAS.find((x) => x.id === e.etapa)!.nombre, mod].filter(Boolean).join(' · ');
}

/** Sugerencia de destinatarios según la enseñanza. */
export function destinatariosSugeridos(e: Ensenanza): string {
  if (!e.etapa || e.etapa === 'libre') return '';
  const curso = CURSOS[e.etapa]?.find((c) => c.id === e.curso);
  if (e.etapa === 'primaria' || e.etapa === 'eso') return `Alumnado de ${curso?.nombre ?? ETAPAS.find((x) => x.id === e.etapa)!.nombre}${curso?.edad ? ` (${curso.edad})` : ''}`;
  if (e.etapa === 'bachillerato') {
    return `Alumnado de ${curso?.nombre ?? 'Bachillerato'}${curso?.edad ? ` (${curso.edad})` : ''}${curso?.id === '2' ? ' que prepara la PAU' : ''}`;
  }
  return `Alumnado de ${ETAPAS.find((x) => x.id === e.etapa)!.nombre}${e.titulo ? ` (${e.titulo})` : ''}${curso ? `, ${curso.nombre}` : ''}`;
}
