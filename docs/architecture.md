# Arquitectura

```
packages/mx       Lógica fiscal pura (RFC, IVA/ISR, catálogos SAT, CFDI 4.0, XML Anexo 24). Sin base de datos; probada con Vitest.
packages/db       Migraciones SQL, datos de referencia (código agrupador, catálogo de cuentas, diarios) y cliente Postgres.
packages/client   Cliente HTTP tipado compartido por web, escritorio y móvil.
apps/api          API Fastify: terceros, productos, inventario, facturación, compras, cobros/pagos, contabilidad, reportes, exportaciones SAT y consultas con IA.
apps/web          Next.js. Se exporta como sitio estático para el escritorio.
apps/desktop      Tauri v2: ventana nativa que carga la exportación estática de apps/web.
apps/mobile       Expo (React Native): tablero, existencias, facturas y consultas con IA.
```

## Módulos (referencia: Dolibarr)

La organización sigue los módulos de Dolibarr ERP-CRM, con el código escrito desde cero:

| Dolibarr | Aquí |
|---|---|
| Terceros (clientes/proveedores en una sola ficha) | `third_parties` con `is_customer` / `is_supplier` |
| Productos y servicios | `products` (con claves SAT y tratamiento de IVA) |
| Stocks: almacenes, movimientos, PMP, inventarios | `warehouses`, `stock`, `stock_movements`, `inventory_counts`, costo promedio en `products.avg_cost` |
| Facturas a clientes / de proveedores | `sales_invoices` (CFDI 4.0), `supplier_invoices` |
| Bancos | `bank_accounts`, `payments` |
| Contabilidad de partida doble: diarios, vinculación de cuentas por producto, cuentas por omisión | `journals`, `journal_entries`, `journal_lines`, `products.income_account_id/expense_account_id`, `account_settings` |

## Flujo contable automático

| Evento | Póliza |
|---|---|
| Factura de proveedor validada | Cargo a Inventario (o gasto) e IVA pendiente de pago; abono a retenciones por enterar y Proveedores. Entrada al almacén a costo sin IVA. |
| Pago a proveedor | Cargo a Proveedores, abono a Bancos; IVA pendiente → IVA acreditable pagado en proporción al pago. |
| Factura de venta timbrada | Cargo a Clientes y retenciones a favor; abono a Ventas (por tasa) e IVA no cobrado. Salida del almacén a costo promedio y póliza de costo de ventas. |
| Cobro | Cargo a Bancos, abono a Clientes; IVA no cobrado → IVA cobrado en proporción. |
| Cancelación de factura | Pólizas inversas y reingreso al almacén al costo original. |
| Ajuste de inventario | Inventario contra costo (merma/sobrante) o contra capital (carga inicial). |

Las cuentas usadas se resuelven por clave en `account_settings`, así que el catálogo se puede adaptar sin tocar código.

## Consultas con IA

1. `POST /ai/query { question, history }`.
2. El servidor describe las vistas del esquema `ai` (columnas y comentarios) en el prompt de sistema y ofrece a Claude una herramienta `run_sql`.
3. Cada consulta pasa por un filtro (una sola sentencia `SELECT`/`WITH`, sin funciones peligrosas ni esquemas fuera de `ai`) y se ejecuta con el rol `erp_ai_reader` en una transacción de solo lectura con límite de 5 s y 200 filas.
4. Claude responde con base en los resultados; la respuesta incluye las consultas ejecutadas para que el usuario las pueda revisar. Todo queda en `ai_query_log`.

La frontera de seguridad real es la base de datos: `erp_ai_reader` sólo tiene `SELECT` sobre las vistas del esquema `ai`, que no exponen el XML de las facturas ni tablas internas. El filtro en código es una segunda capa.

Modelo por omisión: `claude-opus-5-5` (variable `AI_MODEL`), con pensamiento adaptativo, esfuerzo medio y *fallback* del lado del servidor cuando un clasificador rechaza la petición.

## Más funciones de IA

Captura de facturas, propuestas del copiloto, gráficas fijadas, auditor, servidor MCP y evaluación: ver [ai-features.md](ai-features.md). Tablas nuevas en la migración `0005_ai_features.sql`: `document_intakes`, `ai_proposals`, `ai_widgets`, `sat_69b`, `audit_runs` y `audit_findings`.
