# Apuntes IA

Aplicación de escritorio para crear apuntes con varios agentes de IA trabajando en
paralelo. Usa **Claude Code** y/o **Codex CLI** instalados en el equipo, con la
suscripción del usuario (sin claves de API). Ver el plan completo en [PLAN.md](PLAN.md).

**Descarga:** [última versión](https://github.com/gafapa/apuntes-ia/releases/latest) para
Windows, macOS y Linux. Las apps instaladas se actualizan solas.

## Qué hace

- **Flujo guiado por fases** (investigación, índice, redacción en paralelo, revisión, visuales,
  autoevaluación y exportación), con aprobación del usuario donde importa.
- **Asignaturas con contexto**: enseñanza y curso del catálogo oficial, destinatarios, idioma,
  fuentes propias (PDF, Word, webs) indexadas para que los agentes las consulten, glosario,
  plantillas y **currículo oficial** (BOE) para alinear el índice y revisar la cobertura.
- **Visuales**: imágenes libres de Wikimedia y de museos, bibliotecas y archivos (Europeana,
  Smithsonian, Art Institute of Chicago…), con su referencia APA en el pie; diagramas Mermaid;
  gráficas de funciones, mapas, moléculas (PubChem), química con `\ce{}`, árboles sintácticos,
  partituras, pictogramas de ARASAAC e imágenes generadas con Codex. Se comprueba que cada
  imagen se ha descargado y, si falla, se reintenta o se busca otra.
- **Actividades**: bloques independientes de autoevaluación que se piden con un diálogo
  (varios tipos de pregunta en un mismo bloque, dificultad, soluciones) y se incluyen o no en
  los apuntes; cada bloque se exporta a **Moodle** (GIFT).
- **Mejorar apuntes existentes**: se importan de Word, LibreOffice, Markdown (o un .zip con sus
  imágenes) o PDF, uno o varios a la vez, conservando su formato (tablas, estilos propios del Word,
  notas al pie, tamaño de las imágenes), y un agente hace un **diagnóstico** (qué conservar, qué falta, qué corregir,
  con acceso directo a la fase que lo resuelve). Tres modos: mejorar sobre el texto (solo
  sugerencias), reorganizar o rehacer usándolos como fuente. Se puede exportar con el estilo del
  Word u ODT original.
- **Historial de cada sección**: se guarda cómo estaba antes de cada cambio (de un agente, de
  una sugerencia o tuyo), se compara con el texto actual o con el original importado y se
  restaura.
- **Versiones adaptadas**: lectura fácil, refuerzo y ampliación.
- **Chat lateral** que actúa solo sobre la pestaña abierta o sobre el texto seleccionado en la
  vista previa, con herramientas (web, imágenes, calculadora) según los permisos.
- **Permisos por asignatura y documento** (imágenes, diagramas, búsqueda web…; todo permitido
  por defecto) y **modelo y esfuerzo por agente** con perfiles de gasto.
- **Consumo de tokens** por asignatura y por documento, **estimación** antes de lanzar cada fase
  (según lo que ha gastado antes cada agente) y **tope de tokens** por documento.
- **Límite de uso de la suscripción**: si se agota, los agentes de ese motor esperan y siguen solos
  (continuando su conversación) cuando se renueva. Aviso si un agente deja de dar señales y
  «Reintentar» en los trabajos fallidos.
- **Avisos del sistema** cuando termina una fase, falla un agente o se agota el límite, si la
  ventana no está a la vista.
- **Papelera** (restaurar lo eliminado), **duplicar** asignaturas y documentos (para otro grupo o
  el curso siguiente), **copias de seguridad** en .zip (de una asignatura o de todas) y
  **exportar todos** los documentos de una asignatura a una carpeta.
- **Exportación** a Word, LibreOffice, PDF y Markdown (zip con las figuras), con índice, pies
  numerados y solucionario opcional al final.
- Pantalla de inicio con lo que necesita la app y su estado en el equipo.

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
npm test             # pruebas (tests/): cola de agentes con un motor falso, importar/exportar, gestión
npm start            # compila y abre la app en Electron
```

Las pruebas de importar y exportar necesitan Pandoc en `resources-bin/` (`npm run fetch-bin`); sin él
se saltan. GitHub Actions las pasa en cada cambio de `main` (`.github/workflows/pruebas.yml`) y antes
de compilar cada versión.

En desarrollo los datos van a `Documentos/Apuntes IA (desarrollo)`; se puede cambiar
con la variable `APUNTES_DATOS`.

## Instalador

```bash
npm run dist         # → release/Apuntes-IA-Setup.exe (o .dmg / .AppImage según el sistema)
```

`npm run dist` compila, descarga Pandoc y Typst (`scripts/fetch-bin.mjs`, se guardan en
`resources-bin/`) y genera el instalador con electron-builder. El instalador no pide
permisos de administrador y los apuntes quedan en `Documentos/Apuntes IA`.

### Versión portable (Windows)

```bash
npm run dist:portable   # → release/Apuntes-IA-portable.exe
```

Un único `.exe` que no se instala: se puede llevar en una memoria USB. Ajustes, apuntes y
datos de la ventana se guardan en `Apuntes IA datos/`, junto al `.exe` (con rutas relativas,
así que siguen funcionando aunque cambie la letra de la unidad). No se actualiza sola: para
una versión nueva se descarga el `.exe` de nuevo y se pone en el mismo sitio. `npm run dist` y
las *releases* generan el instalador y la portable. Claude Code o Codex siguen haciendo falta
en cada equipo donde se use.

## Publicar una versión

1. Sube la versión: `npm version 0.5.0 && git push && git push --tags`.
2. GitHub Actions (`.github/workflows/publicar.yml`) pasa las pruebas, compila Windows, macOS y
   Linux y crea la *release*. Las apps instaladas la detectan, la descargan solas y ofrecen reiniciar.
3. Página de descarga: GitHub Pages con la carpeta `docs/`.

### Firmar los instaladores (opcional)

Sin firma, Windows muestra el aviso de SmartScreen y macOS dice que la app «está dañada» (hay que
abrirla con clic derecho → Abrir). Si se añaden estos secretos al repositorio (*Settings → Secrets and
variables → Actions*), el *workflow* firma los instaladores y notariza el de macOS:

| Secreto | Qué es |
|---|---|
| `WIN_CERTIFICADO`, `WIN_CERTIFICADO_CLAVE` | Certificado de firma de código de Windows (.pfx en base64) y su contraseña |
| `MAC_CERTIFICADO`, `MAC_CERTIFICADO_CLAVE` | Certificado «Developer ID Application» (.p12 en base64) y su contraseña |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Cuenta de Apple Developer para notarizar |

Para pasar un certificado a base64: `base64 -i certificado.p12 | pbcopy` (macOS) o
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx"))` (PowerShell). Con Azure
Trusted Signing, en lugar del certificado se añade `azureSignOptions` en `electron-builder.yml`.

## Flujo de un documento

| Fase | Agente | Qué produce |
|---|---|---|
| 1. Investigación (opcional) | Investigador | `investigacion.md`: dossier con fuentes |
| 2. Índice | Arquitecto | `indice.json`: secciones con objetivo, contenidos y extensión; el usuario lo edita y aprueba |
| 3. Redacción | Redactor (uno por sección, en paralelo) | `secciones/NN-*.md` |
| 4. Revisión (opcional) | Estilo, calidad, fuentes | `sugerencias.json`: cambios que el usuario acepta o rechaza |
| 5. Visuales (opcional) | Director visual + ilustrador | `visuales.json` y, al aprobar, imágenes (Wikimedia, museos y bibliotecas, o generadas con Codex), diagramas y bloques dibujados; la mezcla se elige al pedirlos |
| 6. Autoevaluación (opcional) | Actividades | bloques independientes de preguntas (varios tipos por bloque) que se incluyen o no; exportables a Moodle |
| 7. Exportar | (Pandoc + Typst) | `exportados/*.docx / .odt / .pdf` o un `.zip` con Markdown y figuras |

Además: orquestador (chat libre, conoce el estado del flujo) y glosario de la asignatura.

### Apuntes importados

`server/importar.ts` convierte el archivo con Pandoc (Word y ODT, con sus imágenes a
`recursos/`), quita lo que la app genera al exportar (índice manual, numeración de títulos,
«Figura N.») y reparte el texto en secciones por sus encabezados (cada nota al pie va a la
sección donde se cita). Antes de escribir el Markdown, `server/formatoImportado.ts` ajusta el
árbol de Pandoc para no perder formato: las tablas con celdas combinadas o varios párrafos por
celda se aplanan (antes se perdían), los estilos propios del Word quedan como
`::: {custom-style="…"}` y `[texto]{custom-style="…"}`, y se conservan el subrayado, el
resaltado y el ancho de las imágenes. Al exportar con el original de plantilla, Pandoc vuelve a
aplicar esos estilos y el texto normal y las tablas toman el estilo que tenían en el original.
La vista previa los muestra (`web/src/lib/marcasPandoc.ts`). En ODT, Pandoc no lee los estilos
propios. Un PDF lo transcribe el agente
*Transcriptor* (los escaneados sin texto se rechazan). El original queda en `original/` y, en el
modo «mejorar sobre el texto», cada sección tal como se importó en `original/secciones/`, para
compararla. En los modos «reorganizar» y «rehacer» el texto pasa a `fuentes/apuntes-originales.md`
y el arquitecto y los redactores reciben pautas para usarlo. El agente *Diagnóstico* escribe
`diagnostico.json`. El historial de las secciones (`server/historial.ts`) va en `.historial/`.
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
| `server/fases/` | El flujo de un documento por fases (base → preparación → escritura → visuales → actividades → importación → asignatura), encadenadas por herencia; `server/flujo.ts` procesa los resultados |
| `server/gestion.ts` | Papelera, duplicar, copias de seguridad y reunir lo exportado |
| `server/agents/` | Detección de Claude/Codex, cola con límite de simultaneidad, prompts de los agentes |
| `shared/` | Tipos compartidos entre servidor e interfaz |
| `web/` | Interfaz (React + Tailwind + CodeMirror) |
| `scripts/` | Compilación del proceso principal y descarga de binarios |
| `tests/` | Pruebas (`node:test`), con un motor de agentes falso y documentos de ejemplo |

## Cómo se ejecutan los agentes

Cada tarea lanza `claude -p --output-format stream-json` o `codex exec --json` en la
carpeta del documento, con el prompt por stdin. La salida JSON se traduce a eventos
(«Leyendo…», «Buscando en la web…», «Escribiendo…») que la interfaz muestra en directo.
Al terminar, se puede **responder** al agente: se reanuda la misma sesión
(`--resume` / `codex exec resume`).
