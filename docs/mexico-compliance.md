# Cumplimiento fiscal en México

Este documento resume qué cubre la versión 0.1 del ERP en materia fiscal mexicana, cómo lo hace y qué falta. **No sustituye la revisión de un contador**: valida el catálogo de cuentas, las cuentas por omisión y los reportes de impuestos con tu despacho antes de usarlos en producción.

## Contabilidad electrónica (Anexo 24 RMF)

| Requisito | Cómo se cubre | Dónde |
|---|---|---|
| Catálogo de cuentas con código agrupador SAT | Cada cuenta (`accounts.sat_code`) apunta a `sat_codigo_agrupador`. Las cuentas de nivel 1 sólo acumulan; las de detalle reciben pólizas. | `packages/db/migrations/0001_accounting.sql`, `packages/db/src/seed.ts` |
| XML Catálogo de cuentas 1.3 | `GET /sat/electronic-accounting/catalogo?year&month` | `packages/mx/src/contabilidad.ts` |
| XML Balanza de comprobación 1.3 (normal y complementaria) | `GET /sat/electronic-accounting/balanza?year&month&tipoEnvio=N|C` con saldos inicial, debe, haber y final por naturaleza de la cuenta; las cuentas padre suman a sus hijas. | `apps/api/src/services/accounting.ts` (`trialBalance`) |
| XML Pólizas del periodo 1.3 con CFDI relacionado | `GET /sat/electronic-accounting/polizas?year&month&tipoSolicitud=AF|FC|DE|CO&numOrden|numTramite`. Cada movimiento lleva `CompNal` con UUID, RFC y monto del CFDI. | `apps/api/src/services/sat.ts` |
| Pólizas cuadradas e inalterables | Un trigger de Postgres rechaza pólizas que no cuadran, que usan cuentas acumulativas, que caen en un periodo cerrado o que se intentan modificar ya contabilizadas. Las cancelaciones generan pólizas inversas. | `check_journal_entry`, `protect_posted_lines` |
| Tipos de póliza | Los diarios (Ventas, Compras, Cobranza, Pagos, Inventarios, Diario) se mapean a pólizas de Ingreso, Egreso o Diario. | tabla `journals` |

El código agrupador incluido es un subconjunto de las cuentas más usadas por una empresa comercial. Si necesitas más, agrégalas a `sat_codigo_agrupador` desde el listado oficial del Anexo 24.

Pendiente: firma y empaquetado ZIP de los XML para el envío al buzón tributario, y validación contra los XSD oficiales.

## CFDI 4.0

- Construcción del XML con Emisor, Receptor (incluido `DomicilioFiscalReceptor` y `RegimenFiscalReceptor`), Conceptos con `ObjetoImp`, impuestos trasladados y retenidos por concepto y agrupados en el comprobante, `InformacionGlobal` y `CfdiRelacionados`. (`packages/mx/src/cfdi40.ts`)
- Validaciones previas al timbrado de las reglas que más rechazos causan: RFC, régimen fiscal compatible con persona física o moral, uso de CFDI, código postal, PPD con forma de pago 99, PUE sin 99, reglas de PUBLICO EN GENERAL, `ObjetoImp` 02 con impuestos, tipo de cambio para moneda extranjera.
- Redondeo a centavos por concepto (Importe y cada impuesto), que mantiene los totales dentro de la tolerancia del SAT para MXN.
- **Sello digital** con el CSD de la empresa (`packages/mx/src/csd.ts`): se valida que la llave abra con su contraseña, que corresponda al certificado, que sea CSD y no e.firma, que esté vigente y que su RFC sea el de la empresa. La cadena original se genera en el código con el mismo orden que `cadenaoriginal_4_0.xslt`. Las pruebas comparan el resultado con el XSLT oficial del SAT, validan el XML contra `cfdv40.xsd` y verifican el sello RSA-SHA256 con el CSD de pruebas EKU9003173C9.
- El CSD se guarda en `company_csd` con la llave privada y su contraseña cifradas (AES-256-GCM, `ERP_SECRET_KEY`).
- Timbrado mediante la interfaz `PacProvider` (`apps/api/src/services/pac.ts`):
  - `sw`: SW Sapien. Envía el CFDI sellado a `/cfdi33/stamp/v4` y cancela con `/cfdi33/cancel/csd`. Probado contra un servidor simulado con las respuestas documentadas por SW; falta probarlo contra el ambiente de pruebas real de SW con una cuenta.
  - `sandbox`: devuelve un `TimbreFiscalDigital` ficticio y **no genera CFDI válidos**. Las facturas timbradas así se cancelan sólo en el ERP.
- Al timbrar con un PAC real la fecha del CFDI es la actual en `ERP_TIMEZONE`; el SAT rechaza fechas con más de 72 horas.
- El inventario sale antes de llamar al PAC, así que una falta de existencias nunca deja un CFDI timbrado sin su factura. Si el PAC rechaza el CFDI, toda la operación se revierte y el error del PAC se muestra al usuario.
- Cancelación con motivo 01–04 y folio de sustitución para el motivo 01. El acuse del PAC se guarda en la factura. Si el SAT requiere que el receptor acepte la cancelación, la factura sigue timbrada y hay que reintentar después.

Pendiente: complemento de pagos 2.0 para facturas PPD, notas de crédito (tipo E), CFDI de traslado, carta porte, nómina, descarga masiva y validación de CFDI recibidos, PDF de la representación impresa.

## IVA

- IVA trasladado a la tasa general (16 %), frontera (8 %), tasa 0 % y exento; `ObjetoImp` 01/03/04 sin desglose.
- **Flujo de efectivo** (LIVA art. 1-B y 5): al facturar, el IVA va a *IVA trasladado no cobrado* (209.01) y se reclasifica proporcionalmente a *IVA trasladado cobrado* (208.01) con cada cobro. En compras, el IVA va a *IVA pendiente de pago* (119.01) y pasa a *IVA acreditable pagado* (118.01) con cada pago.
- Retenciones de IVA (2/3 partes, 4 % fletes) e ISR (10 % honorarios y arrendamiento, 1.25 % RESICO) en ventas y compras.
- Reporte de IVA mensual (`GET /reports/iva`) desde la contabilidad: causado, acreditable, retenido por clientes, a cargo o a favor y retenciones por enterar.

Pendiente: DIOT, proporción de IVA acreditable para actos exentos, IVA de importaciones.

## ISR

- Pago provisional de personas morales (LISR art. 14): `GET /reports/isr-provisional?year&month&coeficienteUtilidad=...` con ingresos nominales acumulados desde la contabilidad, PTU, pérdidas y pagos previos.

Pendiente: personas físicas (actividad empresarial y RESICO), declaración anual, depreciaciones fiscales, ajuste anual por inflación.

## Inventarios

- Costo promedio ponderado (permitido por LISR art. 41), recalculado con cada entrada; las salidas se valúan al promedio vigente y generan la póliza de costo de ventas.
- Inventario físico con ajustes contabilizados (mermas y sobrantes), carga inicial contra capital, transferencias entre almacenes.
