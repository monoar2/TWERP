# Funciones de IA

Seis funciones construidas sobre Claude. Todas respetan los roles: la IA sólo lee con el rol `erp_ai_reader`, y cualquier cambio en los libros lo confirma una persona.

## 1. Captura de facturas de proveedor

**Compras → Subir factura (IA)** (`/purchases/intake/`). Arrastra el XML del CFDI, el PDF o una foto del ticket.

- **XML**: se lee de forma exacta con `parseCfdi` (`packages/mx/src/cfdi-parse.ts`, CFDI 3.3 y 4.0, UUID del timbre). No usa IA.
- **PDF o imagen**: se envía a Claude como documento y se extrae con salida estructurada (`apps/api/src/ai/extract.ts`, JSON Schema).
- Cada concepto se relaciona con un producto por `NoIdentificacion` (SKU) o por similitud del nombre (coeficiente de Dice sobre bigramas, +0.15 si coincide la clave SAT, umbral 0.5).
- Advertencias antes de registrar: el receptor no es la empresa, moneda extranjera, UUID duplicado o ausente, RFC inválido, proveedor en la lista 69-B, totales que no cuadran.
- Al confirmar se crea el proveedor si no existe y se registra la factura (borrador o validada, con entrada al almacén y póliza).

API: `POST /intake {fileName, mediaType, contentBase64}`, `GET /intake/:id`, `POST /intake/:id/confirm`, `POST /intake/:id/discard`. Área de permisos: compras.

## 2. Copiloto que prepara operaciones

En **Pregúntale a la IA** puedes pedir "prepara una factura de 2 monitores para Comercializadora del Bajío". Claude tiene herramientas `propose_*` según tu rol:

| Propuesta | Ruta que ejecuta |
|---|---|
| Factura de venta (borrador) | `POST /sales-invoices` |
| Póliza manual | `POST /journal-entries` |
| Traspaso entre almacenes | `POST /stock/transfers` |
| Ajuste de inventario | `POST /stock/adjustments` |

Cada propuesta se valida con zod y se **ejecuta en seco** dentro de una transacción que siempre se revierte, para mostrar los totales reales. Nada cambia hasta que la persona pulsa **Aplicar**; en ese momento se vuelve a comprobar su rol y sólo quien la pidió (o un administrador) puede aplicarla. El rol de sólo consulta no recibe herramientas de propuesta.

API: `GET /ai/proposals`, `POST /ai/proposals/:id/apply`, `POST /ai/proposals/:id/reject`.

## 3. Respuestas con gráficas y tablero

Claude puede llamar `show_chart` sobre cualquier consulta que ejecutó (barras, líneas o dona). La gráfica se dibuja en SVG sin dependencias (`apps/web/components/Chart.tsx`), con tooltip, leyenda, vista de tabla y una paleta categórica validada para daltonismo en modo claro y oscuro.

**📌 Fijar en el tablero** guarda la consulta SQL, no los datos: el inicio la vuelve a ejecutar con el rol de solo lectura cada vez que se abre.

API: `GET/POST /ai/widgets`, `PATCH/DELETE /ai/widgets/:id`.

## 4. Auditor

**Auditor** (`/audit/`) revisa los libros con consultas SQL deterministas (`apps/api/src/services/auditor.ts`):

| Revisión | Severidad |
|---|---|
| Factura de proveedor duplicada (mismo proveedor y total con 10 días o menos de diferencia, o misma referencia) | alta |
| Proveedor en la lista 69-B del SAT | alta si es definitivo, media si no |
| Venta por debajo del costo | media |
| Compra con precio muy por encima del promedio | media |
| Existencia negativa | alta |
| Cobranza vencida | media, alta con más de 90 días |
| Compras validadas sin UUID | media |
| Borradores olvidados | baja |
| Productos bajo el mínimo | baja |

Cada hallazgo tiene una huella estable: si vuelve a aparecer no se duplica, si deja de aparecer se marca como resuelto, y si lo descartas con un motivo no vuelve a abrirse solo. Al final Claude escribe un resumen de qué atender primero (opcional: sin clave de API el auditor funciona igual, sin resumen).

Corre cada `AUDIT_INTERVAL_HOURS` horas (24 por omisión, `0` lo desactiva), a mano desde la página o con `pnpm --filter @erp/api audit`. Un candado de Postgres evita dos revisiones simultáneas.

### Lista 69-B del SAT

Descarga `Listado_Completo_69-B.csv` del portal de datos abiertos del SAT y cárgalo:

```bash
pnpm --filter @erp/api load:69b ./Listado_Completo_69-B.csv
```

Reemplaza el contenido de la tabla `sat_69b`. La captura de facturas y el auditor la consultan.

## 5. Servidor MCP

El ERP se puede usar desde Claude Desktop, Claude Code o cualquier cliente [MCP](https://modelcontextprotocol.io). Herramientas (todas de solo lectura):

- `describe_schema`: vistas del esquema `ai` con sus columnas.
- `run_sql`: consulta `SELECT` con el rol `erp_ai_reader`.
- `list_audit_findings`: hallazgos del auditor.
- `ask_erp`: pregunta en lenguaje natural respondida por el asistente del ERP.

**Local (stdio)**, para Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "erp": {
      "command": "pnpm",
      "args": ["--dir", "/ruta/al/erp", "--filter", "@erp/api", "mcp"],
      "env": {
        "DATABASE_URL": "postgres://erp:erp@localhost:5432/erp",
        "AI_DATABASE_URL": "postgres://erp_ai_reader:...@localhost:5432/erp",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Claude Code: `claude mcp add erp -- pnpm --dir /ruta/al/erp --filter @erp/api mcp`.

**Remoto (HTTP)**: `POST /mcp` (Streamable HTTP sin estado, JSON-RPC 2.0) con `Authorization: Bearer <token de sesión>`. Sólo los roles con acceso a la IA pueden usarlo.

```bash
TOKEN=$(curl -s localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@demo.mx","password":"demo-erp-2026"}' | jq -r .token)
curl -s localhost:4000/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 6. Evaluación de la IA

`apps/api/src/evals/questions.ts` tiene 21 preguntas de negocio (ventas, cobranza, compras, inventario, contabilidad y auditoría). La respuesta correcta de cada una sale de una consulta SQL sobre las tablas base, independiente de las vistas que usa la IA, así que un *join* equivocado del modelo se detecta.

```bash
ANTHROPIC_API_KEY=... pnpm --filter @erp/api eval              # todas
ANTHROPIC_API_KEY=... pnpm --filter @erp/api eval --only top_customer,payables --repeat 3
```

El script crea una base temporal con los datos de demostración, corre el auditor, hace cada pregunta al asistente real y califica que la respuesta contenga los números y nombres correctos (con tolerancia a formato: `$1,234.50`, "1.2 millones"). Escribe `apps/api/evals/results/report.md`, `report.json` y `badge.json`.

En GitHub, el flujo **AI eval** (`.github/workflows/ai-eval.yml`) lo corre a mano o cada lunes con el secreto `ANTHROPIC_API_KEY` y publica el reporte en el resumen del job. `EVAL_MIN_ACCURACY` (0 a 1) hace que falle por debajo de esa precisión.
