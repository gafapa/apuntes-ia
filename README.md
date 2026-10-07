# Apuntes IA

Aplicación de escritorio para crear apuntes con varios agentes de IA trabajando en
paralelo. Usa **Claude Code** y/o **Codex CLI** instalados en el equipo, con la
suscripción del usuario (sin claves de API). Ver el plan completo en [PLAN.md](PLAN.md).

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
npm run dist         # → release/Apuntes-IA-Setup-x.y.z.exe
```

`npm run dist` compila, descarga Pandoc y Typst (`scripts/fetch-bin.mjs`, se guardan en
`resources-bin/`) y genera el instalador con electron-builder. El instalador no pide
permisos de administrador y los apuntes quedan en `Documentos/Apuntes IA`.

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
