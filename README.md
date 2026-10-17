# ERP

ERP para empresas mexicanas con inventarios, facturación CFDI 4.0, contabilidad electrónica del SAT y consultas en lenguaje natural con Claude. Funciona en web, escritorio (Tauri) y móvil (Expo).

> Estado: versión 0.1. El timbrado usa un PAC de prueba que **no** genera CFDI válidos ante el SAT. Revisa [docs/mexico-compliance.md](docs/mexico-compliance.md) para ver qué está cubierto y qué falta.

## Qué incluye

- **Inventario**: almacenes, existencias, kardex, costo promedio ponderado, ajustes, carga inicial, transferencias e inventario físico.
- **Facturación**: facturas CFDI 4.0 (PUE/PPD, IVA 16/8/0/exento, retenciones), timbrado, cancelación con motivo, cobros y descarga del XML.
- **Compras**: facturas de proveedores con UUID, entrada al almacén, pagos.
- **Contabilidad**: catálogo con código agrupador SAT, pólizas automáticas y manuales, balanza, auxiliares, estado de resultados, cierre de periodos.
- **Impuestos**: IVA mensual en flujo de efectivo y pago provisional de ISR de personas morales.
- **SAT**: XML de catálogo de cuentas, balanza y pólizas (Anexo 24, versión 1.3).
- **IA**: preguntas como "¿qué productos están bajo el mínimo?" o "¿cuánto me debe Comercializadora del Bajío?" respondidas con consultas SQL de solo lectura.

La estructura de módulos toma como referencia [Dolibarr ERP-CRM](https://www.dolibarr.org/); el código es propio. Detalles en [docs/architecture.md](docs/architecture.md).

## Requisitos

- Node.js 22+ y pnpm 10+
- Docker (para Postgres 16) o un Postgres propio
- Para escritorio: Rust y los [requisitos de Tauri](https://tauri.app/start/prerequisites/)
- Para móvil: la app Expo Go o un emulador
- Una clave de la API de Claude para las consultas con IA

## Inicio rápido

```bash
pnpm install
cp .env.example .env            # ajusta ANTHROPIC_API_KEY, ERP_API_TOKEN y contraseñas
docker compose up -d db
set -a && . ./.env && set +a
pnpm build                      # compila los paquetes compartidos
pnpm db:migrate                 # crea el esquema y la contraseña del rol de IA
pnpm db:seed                    # catálogos SAT, catálogo de cuentas y datos de la empresa (COMPANY_* en .env)
pnpm --filter @erp/api seed:demo   # opcional: datos de ejemplo de 3 meses
pnpm dev:api                    # http://localhost:4000
pnpm dev:web                    # http://localhost:3000
```

Escritorio: `pnpm dev:desktop`. Móvil: `pnpm dev:mobile` y define `EXPO_PUBLIC_API_URL` con la IP de tu computadora.

## Pruebas

```bash
pnpm test        # lógica fiscal + pruebas de integración de la API contra Postgres
pnpm typecheck
```

Las pruebas de la API crean y borran una base temporal usando `TEST_DATABASE_URL` (por omisión `postgres://erp:erp@localhost:5432/postgres`).

## Seguridad

- La API usa un token compartido (`ERP_API_TOKEN`). Usuarios, roles y permisos por módulo son el siguiente paso.
- La IA sólo puede leer las vistas del esquema `ai` mediante el rol `erp_ai_reader`, en transacciones de solo lectura con límite de tiempo y filas.
