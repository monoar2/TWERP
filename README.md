# ERP

ERP para empresas mexicanas con inventarios, facturación CFDI 4.0, contabilidad electrónica del SAT y consultas en lenguaje natural con Claude. Funciona en web, escritorio (Tauri) y móvil (Expo).

> Estado: versión 0.2. Las facturas se sellan con el CSD de la empresa y se timbran con SW Sapien (`PAC_PROVIDER=sw`) o con un PAC de prueba que **no** genera CFDI válidos (`PAC_PROVIDER=sandbox`, el valor por omisión). Revisa [docs/mexico-compliance.md](docs/mexico-compliance.md) para ver qué está cubierto y qué falta.

## Qué incluye

- **Inventario**: almacenes, existencias, kardex, costo promedio ponderado, ajustes, carga inicial, transferencias e inventario físico.
- **Facturación**: facturas CFDI 4.0 (PUE/PPD, IVA 16/8/0/exento, retenciones) selladas con el CSD de la empresa, timbrado y cancelación con SW Sapien, cobros y descarga del XML.
- **Compras**: facturas de proveedores con UUID, entrada al almacén, pagos.
- **Contabilidad**: catálogo con código agrupador SAT, pólizas automáticas y manuales, balanza, auxiliares, estado de resultados, cierre de periodos.
- **Impuestos**: IVA mensual en flujo de efectivo y pago provisional de ISR de personas morales.
- **SAT**: XML de catálogo de cuentas, balanza y pólizas (Anexo 24, versión 1.3).
- **Usuarios**: inicio de sesión con correo y contraseña, roles (administrador, contador, ventas, almacén, sólo consulta) y bitácora de cambios.
- **IA**: preguntas como "¿qué productos están bajo el mínimo?" o "¿cuánto me debe Comercializadora del Bajío?" respondidas con consultas SQL de solo lectura, y además:
  - **Captura de facturas**: arrastra el XML, el PDF o una foto de una factura de proveedor y el ERP llena la compra, relaciona los productos y avisa de duplicados o proveedores en la lista 69-B.
  - **Copiloto**: "prepara una factura de 2 monitores para Comercializadora del Bajío" deja un borrador con los totales reales; nada cambia hasta que lo apliques.
  - **Gráficas**: pide una gráfica y fíjala en el inicio; se recalcula cada vez que lo abres.
  - **Auditor**: revisa los libros cada día (duplicados, 69-B, ventas bajo costo, precios atípicos, cobranza vencida…) y resume qué atender primero.
  - **Servidor MCP**: usa el ERP desde Claude Desktop o Claude Code.
  - **Evaluación**: 21 preguntas con respuesta conocida miden la precisión del asistente.

  Detalles en [docs/ai-features.md](docs/ai-features.md).

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
cp .env.example .env            # ajusta ANTHROPIC_API_KEY, ERP_SECRET_KEY y contraseñas
docker compose up -d db
set -a && . ./.env && set +a
pnpm build                      # compila los paquetes compartidos
pnpm db:migrate                 # crea el esquema y la contraseña del rol de IA
pnpm db:seed                    # catálogos SAT, catálogo de cuentas y datos de la empresa (COMPANY_* en .env)
pnpm --filter @erp/api seed:demo   # opcional: datos de ejemplo de 3 meses y el usuario admin@demo.mx / demo-erp-2026
pnpm --filter @erp/api user:create tu@empresa.mx "Tu nombre" admin   # primer administrador (imprime la contraseña)
pnpm dev:api                    # http://localhost:4000
pnpm dev:web                    # http://localhost:3000
```

Escritorio: `pnpm dev:desktop`. Móvil: `pnpm dev:mobile` y define `EXPO_PUBLIC_API_URL` con la IP de tu computadora.

## Facturar con validez ante el SAT

1. Genera `ERP_SECRET_KEY` (`openssl rand -hex 32`) y guárdala en `.env`. Cifra la llave privada del CSD en la base de datos.
2. Crea una cuenta en [SW Sapien](https://sw.com.mx). Para pruebas usa su ambiente de pruebas (`SW_URL=https://services.test.sw.com.mx`).
3. Define `PAC_PROVIDER=sw` y `SW_USER`/`SW_PASSWORD` (o `SW_TOKEN`) y reinicia la API.
4. En Configuración sube el CSD de la empresa: archivo `.cer`, archivo `.key` y su contraseña. El RFC del CSD debe coincidir con el de la empresa. En el ambiente de pruebas usa un CSD de pruebas del SAT, como el de `packages/mx/test/fixtures/csd` (contraseña `12345678a`, RFC EKU9003173C9).

Al timbrar, la factura toma la fecha y hora actuales (`ERP_TIMEZONE`), porque el SAT rechaza CFDI con más de 72 horas de antigüedad.

## Pruebas

```bash
pnpm test        # lógica fiscal + pruebas de integración de la API contra Postgres
pnpm typecheck
ANTHROPIC_API_KEY=... pnpm --filter @erp/api eval   # precisión de la IA sobre los datos de demostración
```

Las pruebas de la API crean y borran una base temporal usando `TEST_DATABASE_URL` (por omisión `postgres://erp:erp@localhost:5432/postgres`).

## Seguridad

- Cada usuario inicia sesión con correo y contraseña (scrypt). Las sesiones duran 30 días y en la base sólo se guarda un hash del token.
- Tras 5 intentos fallidos la cuenta se bloquea 15 minutos; un administrador puede restablecer la contraseña.
- Cada rol sólo ve y modifica sus módulos; las escrituras quedan en la tabla `audit_log`.
- La llave privada del CSD y su contraseña se guardan cifradas con AES-256-GCM usando `ERP_SECRET_KEY`.
- La IA sólo puede leer las vistas del esquema `ai` mediante el rol `erp_ai_reader`, en transacciones de solo lectura con límite de tiempo y filas.
- Las operaciones que propone la IA se ejecutan en seco y sólo se aplican cuando una persona con el rol adecuado las confirma.
