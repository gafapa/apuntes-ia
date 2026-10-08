# Apuntes IA

Aplicación de escritorio para crear apuntes con varios agentes de IA trabajando en
paralelo. Usa **Claude Code** y/o **Codex CLI** instalados en el equipo, con la
suscripción del usuario (sin claves de API). Ver el plan completo en [PLAN.md](PLAN.md).

## Modo «app en vivo»: cambiar la app mientras la usas

```bash
npm run app
```

Abre la app de escritorio con tus datos y ajustes reales (los mismos que la versión
instalada), pero conectada al código del proyecto:

- **Interfaz** (`web/`): al guardar, el cambio aparece en la ventana al instante, sin recargar.
- **Funcionalidad** (`server/`, `shared/`): al guardar, el servidor se reinicia solo (1-2 s).
  Los agentes en marcha se cierran y se relanzan enseguida: si ya habían empezado, continúan su
  propia conversación donde la dejaron.
- **Proceso principal** (`electron/`): cierra la ventana y vuelve a ejecutar `npm run app`.

La insignia verde «EN VIVO» junto al nombre indica este modo. No se puede tener abierta a la
vez la versión instalada (comparten la cola de agentes). Cuando estés contento con los
cambios, genera un instalador nuevo con `npm run dist`.

Lo mismo vale para la app instalada: al cerrarla, sus agentes se cierran (no queda nada en
segundo plano) y al volver a abrirla se relanzan los trabajos que quedaron a medias.

## Desarrollo

```bash
npm install
npm run dev          # servidor (:4317) + interfaz con recarga en caliente (http://localhost:5173)
npm run typecheck
npm start            # compila y abre la app en Electron
```

En desarrollo los datos van a `Documentos/Apuntes IA (desarrollo)`; se puede cambiar
con la variable `APUNTES_DATOS`.

## Instalador

```bash
npm run dist         # → release/Apuntes-IA-Setup.exe (o .dmg / .AppImage según el sistema)
```

`npm run dist` compila, descarga Pandoc y Typst (`scripts/fetch-bin.mjs`, se guardan en
`resources-bin/`) y genera el instalador con electron-builder. El instalador no pide
permisos de administrador y los apuntes quedan en `Documentos/Apuntes IA`.

## Publicar una versión

1. Crea el repositorio en GitHub y sustituye `TU_USUARIO` en `electron-builder.yml`,
   `package.json` (`repository`) y `docs/index.html`.
2. Sube la versión: `npm version 0.3.0 && git push && git push --tags`.
3. GitHub Actions (`.github/workflows/publicar.yml`) compila Windows, macOS y Linux y crea
   la *release*. Las apps instaladas la detectan, la descargan solas y ofrecen reiniciar.
4. Página de descarga: activa GitHub Pages con la carpeta `docs/`.

## Flujo de un documento

| Fase | Agente | Qué produce |
|---|---|---|
| 1. Investigación (opcional) | Investigador | `investigacion.md`: dossier con fuentes |
| 2. Índice | Arquitecto | `indice.json`: secciones con objetivo, contenidos y extensión; el usuario lo edita y aprueba |
| 3. Redacción | Redactor (uno por sección, en paralelo) | `secciones/NN-*.md` |
| 4. Revisión (opcional) | Estilo, calidad, fuentes | `sugerencias.json`: cambios que el usuario acepta o rechaza |
| 5. Visuales (opcional) | Director visual + ilustrador | `visuales.json` y, al aprobar, diagramas Mermaid, imágenes de Wikimedia o generadas con Codex |
| 6. Autoevaluación (opcional) | Autoevaluación | última sección con preguntas y soluciones |
| 7. Exportar | (Pandoc + Typst) | `exportados/*.docx / .odt / .pdf` |

Además: orquestador (chat libre, conoce el estado del flujo) y glosario de la asignatura.
Los agentes que proponen cosas escriben un JSON en `.agentes/` y es el servidor quien lo
valida e incorpora, para que varios agentes trabajen a la vez sin pisarse.

## Catálogo oficial de enseñanzas

Al crear una asignatura se elige la enseñanza (Primaria, ESO, Bachillerato, FP de Grado
Básico, Medio o Superior, u «Otra» libre), el curso y la asignatura de una lista oficial,
aunque siempre se puede escribir otra (las comunidades autónomas tienen materias propias).

- Primaria, ESO y Bachillerato: Reales Decretos 157/2022, 217/2022 y 243/2022 (BOE), en
  `shared/catalogo/educacion.ts`.
- FP: 190 títulos de 27 familias con sus módulos, del catálogo del Ministerio en TodoFP,
  en `shared/catalogo/fp.json`. Para actualizarlo: `npm run catalogo:fp`.
- Idiomas: los oficiales de España (castellano, catalán, valenciano, gallego, euskera y
  aranés) más «Otro» libre.

## Índice de fuentes (RAG) y consumo de tokens

- Al subir o añadir una fuente se extrae su texto (PDF página a página con pdfjs; Word,
  ODT, PowerPoint y webs con Pandoc), se trocea en fragmentos y se indexa con BM25
  (`server/rag.ts`, caché en `fuentes/.indice/`).
- Los agentes reciben un servidor MCP propio (`server/mcp-fuentes.ts` → `dist/mcp-fuentes.cjs`)
  con `buscar_en_fuentes`, `listar_fuentes` y `leer_pagina`, en Claude y en Codex.
- Los redactores reciben en el mensaje los fragmentos de las fuentes y del dossier
  relevantes para su sección.
- Claude se lanza solo con las herramientas necesarias, sin MCP ni ajustes globales y con
  un prompt de sistema propio; Codex, sin las funciones que no se usan.
- `APUNTES_SIN_RAG=1` desactiva la búsqueda en fuentes (para comparar consumos).

## Estructura

| Carpeta | Contenido |
|---|---|
| `electron/` | Proceso principal: arranca el servidor local y abre la ventana |
| `server/` | API REST + WebSocket (Fastify), almacenamiento en disco, cola de agentes |
| `server/agents/` | Detección de Claude/Codex, cola con límite de simultaneidad, prompts de los agentes |
| `shared/` | Tipos compartidos entre servidor e interfaz |
| `web/` | Interfaz (React + Tailwind + CodeMirror) |
| `scripts/` | Compilación del proceso principal y descarga de binarios |

## Cómo se ejecutan los agentes

Cada tarea lanza `claude -p --output-format stream-json` o `codex exec --json` en la
carpeta del documento, con el prompt por stdin. La salida JSON se traduce a eventos
(«Leyendo…», «Buscando en la web…», «Escribiendo…») que la interfaz muestra en directo.
Al terminar, se puede **responder** al agente: se reanuda la misma sesión
(`--resume` / `codex exec resume`).
