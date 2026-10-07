# Apuntes IA: plan

App web local para crear apuntes con varios agentes de IA en paralelo, usando
Claude Code y Codex CLI del equipo con la suscripción (sin claves de API).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Tipo de app | Interfaz web empaquetada con Electron → instalable (`.exe` en Windows, `.dmg` en macOS, `.AppImage` en Linux) |
| Motores IA | `claude -p` (stream-json) y `codex exec --json`, con suscripción |
| Imágenes IA | Codex CLI (`image_generation`, probado: ~1 min por imagen, PNG ~1,5 MB) |
| Material del profe | Opcional: el investigador trabaja con o sin él |
| Destinatario | Definido en la asignatura, se puede sobrescribir en cada documento |
| Modo de trabajo | Interactivo: la IA propone, el usuario aprueba/edita en cada fase |
| Formato base | Markdown + Mermaid; exportación a DOCX, ODT y PDF |

## Modelo de datos (carpetas en disco)

Los datos van en `Documentos/Apuntes IA/` (configurable), fuera de la carpeta
de instalación, para que sobrevivan a actualizaciones y desinstalaciones.

```
Apuntes IA/
  biologia-2bach/                   ← asignatura (proyecto)
    asignatura.json                 ← nombre, nivel, destinatario, idioma, estilo, motor por defecto
    contexto.md                     ← temario, enfoque, criterios (editable)
    glosario.md                     ← términos y notación compartidos por todos los documentos
    fuentes/                        ← material común del profe (opcional)
    documentos/
      tema-3-la-celula/             ← documento (subproyecto)
        documento.json              ← título, destinatario (override), extensión, estado de cada fase
        fuentes/                    ← material propio del tema (opcional) + lo que encuentre el investigador
        investigacion.md            ← dossier de fuentes con citas
        indice.md                   ← índice director
        secciones/01-introduccion.md, 02-…   ← una sección por archivo (evita conflictos)
        recursos/                   ← imágenes, diagramas
        sugerencias.json            ← propuestas de los revisores pendientes de decidir
        exportados/                 ← .docx / .odt / .pdf
  agentes/*.md                      ← prompt de cada agente, editable desde la app
```

Las secciones van en archivos separados: varios redactores trabajan en paralelo
sin pisarse y los revisores dejan **sugerencias** en vez de editar directamente.
Cada documento lleva git por debajo, así hay historial y se puede deshacer.

## Agentes

| Agente | Motor por defecto | Qué hace |
|---|---|---|
| **Orquestador** | Claude | Chat principal; decide qué agente lanzar, resume el estado y propone el siguiente paso |
| **Investigador** | Claude (web) | Lee el material aportado y busca en la web; genera `investigacion.md` con citas |
| **Arquitecto del índice** | Claude | Propone y mantiene `indice.md` (objetivos por sección, extensión, dependencias) |
| **Redactor** (×N) | Claude | Escribe una sección siguiendo índice, dossier, glosario y destinatario |
| **Revisor de estilo** | Claude | Tono, claridad y adecuación al destinatario → sugerencias |
| **Revisor de calidad** | Codex | Rigor, errores conceptuales, huecos → sugerencias |
| **Verificador de fuentes** | Claude (web) | Cada afirmación relevante tiene respaldo; marca lo dudoso |
| **Glosario** | Claude | Mantiene términos y notación coherentes en toda la asignatura |
| **Director visual** | Claude | Detecta dónde hace falta un apoyo visual y decide cómo: Mermaid / SVG / gráfica / imagen web / imagen IA |
| **Ilustrador** | Codex | Ejecuta: genera la imagen IA, el diagrama o descarga la imagen con su licencia |
| **Autoevaluación** | Claude | Preguntas, ejercicios resueltos y tarjetas de repaso (opcional) |
| **Maquetador** | sin IA (Pandoc) | Ensambla y exporta con plantilla |

El motor de cada agente se puede cambiar en Ajustes. Habrá un límite de agentes
simultáneos (por defecto 3) para no agotar la suscripción.

## Flujo interactivo de un documento

1. **Configurar**: título, destinatario (hereda de la asignatura), extensión, material opcional.
2. **Investigar**: el investigador propone fuentes; el usuario descarta o añade.
3. **Índice**: se propone el índice; el usuario lo edita (arrastrar, renombrar) y lo aprueba.
4. **Redactar**: un redactor por sección en paralelo; se ve en directo cómo escribe cada uno.
5. **Revisar**: los revisores dejan tarjetas con sus sugerencias (diff), que el usuario acepta, rechaza o manda rehacer.
6. **Visuales**: marcas `<!-- VISUAL -->` con su propuesta; al aprobarlas, el ilustrador las genera.
7. **Autoevaluación** (opcional).
8. **Exportar** a DOCX, ODT o PDF.

En cualquier momento el usuario puede editar el Markdown a mano, hablar con el
orquestador o relanzar un agente concreto sobre una sección.

## Interfaz

- **Izquierda**: árbol Asignaturas → Documentos, con el estado de cada fase.
- **Centro**: editor Markdown con vista previa en vivo (Mermaid, imágenes, fórmulas KaTeX); una pestaña por sección.
- **Derecha**: panel de agentes (tarjetas con su estado y salida en directo), sugerencias pendientes y chat con el orquestador.
- **Arriba**: barra de fases del documento (1→8) que indica en cuál estás.
- Tema claro/oscuro, en español.

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + shadcn/ui; CodeMirror 6; markdown-it + Mermaid + KaTeX para la vista previa.
- **Backend**: Node + Fastify + WebSocket, ejecutado dentro del proceso principal de Electron; `node:sqlite` para la cola de trabajos e historial; procesos hijos para `claude`/`codex`.
- **Escritorio**: Electron (ya incluye Node, así que el backend va dentro sin instalar nada aparte).
- **Exportación**: Pandoc + plantillas de referencia `.docx`/`.odt`; PDF con Typst. Mermaid se renderiza a PNG en el navegador antes de exportar.

## Distribución

- **Instalador**: `electron-builder` → `Apuntes-IA-Setup-x.y.z.exe` (NSIS, sin pedir permisos de administrador), `.dmg` y `.AppImage`.
- **Incluido en el instalador**: Pandoc y Typst (binarios únicos, se descargan en el build y se empaquetan como `resources/bin/`). El usuario no instala nada para exportar. Se incluyen sus licencias (Pandoc GPL-2.0, Typst Apache-2.0).
- **No incluible**: Claude Code y Codex CLI, porque cada usuario necesita su propia cuenta y suscripción. Un **asistente de primer arranque**:
  1. detecta si están `claude` y `codex` (en PATH y en las rutas típicas de instalación);
  2. si falta alguno, muestra el comando oficial de instalación con un botón «Copiar» o «Instalar» (abre una terminal);
  3. comprueba si tienen sesión iniciada y, si no, abre `claude` / `codex login` en una terminal;
  4. con uno solo de los dos ya funciona: los agentes del motor que falte pasan al que esté disponible (sin imágenes IA si falta Codex).
- **Actualizaciones automáticas**: `electron-updater` con GitHub Releases.
- **Builds**: GitHub Actions compila los tres sistemas en cada versión etiquetada.
- **Firma de código**: sin firma, Windows muestra el aviso de SmartScreen («Más información → Ejecutar de todas formas»). Firmar cuesta dinero (certificado), así que queda opcional para más adelante.

## Fases de desarrollo

1. ✅ **Base** (hecha el 2026-10-07; incluye además responder a un agente para continuar su sesión): estructura Electron + React, CRUD de asignaturas y documentos, editor con vista previa, ejecutor de agentes (claude/codex) con salida en vivo y cola con límite, asistente de primer arranque y un primer instalador `.exe` funcionando (para validar el empaquetado desde el principio).
2. ✅ **Flujo principal**: investigador → índice → redactores en paralelo → exportación DOCX/ODT/PDF. *(Primera versión ya usable.)*
3. ✅ **Revisión**: revisores de estilo y calidad, verificador de fuentes, tarjetas de sugerencias con diff.
4. ✅ **Visuales**: director visual + ilustrador (Codex), Mermaid, galería de recursos.
5. ✅ **Extras**: glosario de la asignatura, autoevaluación, chat con el orquestador, plantillas de exportación, editor de prompts de los agentes.
6. ✅ **Publicación**: GitHub Actions para Windows/macOS/Linux, actualizaciones automáticas, página de descarga.
