# ERP de escritorio (Tauri v2)

Shell nativo que carga la interfaz web de `apps/web`. No contiene lógica de negocio:
todas las operaciones van contra la API (`apps/api`), cuya URL y token se configuran
en **Configuración** dentro de la app (se guardan en el almacenamiento local de la ventana).

## Requisitos del sistema

- Node.js 22+ y pnpm 10 (`corepack enable`)
- Rust estable (1.77.2 o superior) — https://rustup.rs
- Dependencias de Tauri según el sistema operativo
  (https://v2.tauri.app/start/prerequisites/):
  - **Linux (Debian/Ubuntu):**
    `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev`
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Microsoft C++ Build Tools y WebView2 (incluido en Windows 10/11 recientes)

## Desarrollo

```bash
pnpm install                 # en la raíz del monorepo
pnpm dev:api                 # en otra terminal: la API en http://localhost:4000
pnpm --filter @erp/desktop dev
```

`tauri dev` ejecuta `pnpm --filter @erp/web dev` (Next.js en http://localhost:3000)
y abre la ventana apuntando a ese servidor, con recarga en caliente.

## Compilar instaladores

```bash
pnpm --filter @erp/desktop build
```

Antes de compilar, Tauri ejecuta `NEXT_OUTPUT=export pnpm --filter @erp/web build`,
que genera el sitio estático en `apps/web/out`; ese directorio se empaqueta en la app.
Los instaladores quedan en `src-tauri/target/release/bundle/`.

La URL predeterminada de la API se toma de `NEXT_PUBLIC_API_URL` al momento de compilar
(por defecto `http://localhost:4000`); el usuario puede cambiarla en Configuración.

> En Windows, la sintaxis `NEXT_OUTPUT=export …` de `beforeBuildCommand` requiere un
> shell tipo POSIX (Git Bash). Desde `cmd`/PowerShell ejecuta antes
> `set NEXT_OUTPUT=export` / `$env:NEXT_OUTPUT="export"` y compila la web manualmente.

## Íconos

`src-tauri/icons` contiene íconos PNG provisionales. Para generar el juego completo
(`.ico`, `.icns`) a partir de una imagen de 1024×1024:

```bash
pnpm --filter @erp/desktop tauri icon ruta/al/logo.png
```
