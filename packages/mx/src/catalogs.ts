/**
 * Subsets of the SAT catalogs used by CFDI 4.0 (catCFDI) and the electronic
 * accounting "código agrupador" (Anexo 24 RMF). The full product/service and
 * unit catalogs (c_ClaveProdServ, c_ClaveUnidad) have tens of thousands of
 * rows; load them from the official SAT spreadsheet with
 * `pnpm --filter @erp/db run load-sat-catalog` instead of hardcoding them.
 */

export interface CatalogEntry {
  code: string;
  description: string;
}

export interface RegimenFiscal extends CatalogEntry {
  fisica: boolean;
  moral: boolean;
}

export const REGIMENES_FISCALES: RegimenFiscal[] = [
  { code: "601", description: "General de Ley Personas Morales", fisica: false, moral: true },
  { code: "603", description: "Personas Morales con Fines no Lucrativos", fisica: false, moral: true },
  { code: "605", description: "Sueldos y Salarios e Ingresos Asimilados a Salarios", fisica: true, moral: false },
  { code: "606", description: "Arrendamiento", fisica: true, moral: false },
  { code: "607", description: "Régimen de Enajenación o Adquisición de Bienes", fisica: true, moral: false },
  { code: "608", description: "Demás ingresos", fisica: true, moral: false },
  { code: "610", description: "Residentes en el Extranjero sin Establecimiento Permanente en México", fisica: true, moral: true },
  { code: "611", description: "Ingresos por Dividendos (socios y accionistas)", fisica: true, moral: false },
  { code: "612", description: "Personas Físicas con Actividades Empresariales y Profesionales", fisica: true, moral: false },
  { code: "614", description: "Ingresos por intereses", fisica: true, moral: false },
  { code: "615", description: "Régimen de los ingresos por obtención de premios", fisica: true, moral: false },
  { code: "616", description: "Sin obligaciones fiscales", fisica: true, moral: false },
  { code: "620", description: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos", fisica: false, moral: true },
  { code: "621", description: "Incorporación Fiscal", fisica: true, moral: false },
  { code: "622", description: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", fisica: false, moral: true },
  { code: "623", description: "Opcional para Grupos de Sociedades", fisica: false, moral: true },
  { code: "624", description: "Coordinados", fisica: false, moral: true },
  { code: "625", description: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", fisica: true, moral: false },
  { code: "626", description: "Régimen Simplificado de Confianza", fisica: true, moral: true },
];

export const USOS_CFDI: CatalogEntry[] = [
  { code: "G01", description: "Adquisición de mercancías" },
  { code: "G02", description: "Devoluciones, descuentos o bonificaciones" },
  { code: "G03", description: "Gastos en general" },
  { code: "I01", description: "Construcciones" },
  { code: "I02", description: "Mobiliario y equipo de oficina por inversiones" },
  { code: "I03", description: "Equipo de transporte" },
  { code: "I04", description: "Equipo de cómputo y accesorios" },
  { code: "I05", description: "Dados, troqueles, moldes, matrices y herramental" },
  { code: "I06", description: "Comunicaciones telefónicas" },
  { code: "I07", description: "Comunicaciones satelitales" },
  { code: "I08", description: "Otra maquinaria y equipo" },
  { code: "D01", description: "Honorarios médicos, dentales y gastos hospitalarios" },
  { code: "D02", description: "Gastos médicos por incapacidad o discapacidad" },
  { code: "D03", description: "Gastos funerales" },
  { code: "D04", description: "Donativos" },
  { code: "D05", description: "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)" },
  { code: "D06", description: "Aportaciones voluntarias al SAR" },
  { code: "D07", description: "Primas por seguros de gastos médicos" },
  { code: "D08", description: "Gastos de transportación escolar obligatoria" },
  { code: "D09", description: "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones" },
  { code: "D10", description: "Pagos por servicios educativos (colegiaturas)" },
  { code: "S01", description: "Sin efectos fiscales" },
  { code: "CP01", description: "Pagos" },
  { code: "CN01", description: "Nómina" },
];

export const FORMAS_PAGO: CatalogEntry[] = [
  { code: "01", description: "Efectivo" },
  { code: "02", description: "Cheque nominativo" },
  { code: "03", description: "Transferencia electrónica de fondos" },
  { code: "04", description: "Tarjeta de crédito" },
  { code: "05", description: "Monedero electrónico" },
  { code: "06", description: "Dinero electrónico" },
  { code: "08", description: "Vales de despensa" },
  { code: "12", description: "Dación en pago" },
  { code: "13", description: "Pago por subrogación" },
  { code: "14", description: "Pago por consignación" },
  { code: "15", description: "Condonación" },
  { code: "17", description: "Compensación" },
  { code: "23", description: "Novación" },
  { code: "24", description: "Confusión" },
  { code: "25", description: "Remisión de deuda" },
  { code: "26", description: "Prescripción o caducidad" },
  { code: "27", description: "A satisfacción del acreedor" },
  { code: "28", description: "Tarjeta de débito" },
  { code: "29", description: "Tarjeta de servicios" },
  { code: "30", description: "Aplicación de anticipos" },
  { code: "31", description: "Intermediario pagos" },
  { code: "99", description: "Por definir" },
];

export const METODOS_PAGO: CatalogEntry[] = [
  { code: "PUE", description: "Pago en una sola exhibición" },
  { code: "PPD", description: "Pago en parcialidades o diferido" },
];

export const OBJETOS_IMPUESTO: CatalogEntry[] = [
  { code: "01", description: "No objeto de impuesto" },
  { code: "02", description: "Sí objeto de impuesto" },
  { code: "03", description: "Sí objeto del impuesto y no obligado al desglose" },
  { code: "04", description: "Sí objeto del impuesto y no causa impuesto" },
  { code: "05", description: "Sí objeto del impuesto, IVA crédito PODEBI" },
];

export const TIPOS_COMPROBANTE: CatalogEntry[] = [
  { code: "I", description: "Ingreso" },
  { code: "E", description: "Egreso" },
  { code: "T", description: "Traslado" },
  { code: "N", description: "Nómina" },
  { code: "P", description: "Pago" },
];

export const IMPUESTOS = { ISR: "001", IVA: "002", IEPS: "003" } as const;
export type ImpuestoCode = (typeof IMPUESTOS)[keyof typeof IMPUESTOS];

/** Common c_ClaveUnidad values to get started; load the full catalog from SAT. */
export const CLAVES_UNIDAD_COMUNES: CatalogEntry[] = [
  { code: "H87", description: "Pieza" },
  { code: "E48", description: "Unidad de servicio" },
  { code: "ACT", description: "Actividad" },
  { code: "KGM", description: "Kilogramo" },
  { code: "LTR", description: "Litro" },
  { code: "MTR", description: "Metro" },
  { code: "XBX", description: "Caja" },
  { code: "XPK", description: "Paquete" },
  { code: "HUR", description: "Hora" },
  { code: "DAY", description: "Día" },
];

export type Naturaleza = "D" | "A";

export interface CodigoAgrupador {
  code: string;
  description: string;
  level: 1 | 2;
  /** D = deudora, A = acreedora */
  nature: Naturaleza;
}

/**
 * Commonly used rows of the SAT "código agrupador de cuentas" (Anexo 24,
 * RMF). Enough to run a trading company; load the complete list with the
 * catalog loader when you need more.
 */
export const CODIGO_AGRUPADOR: CodigoAgrupador[] = [
  { code: "100", description: "Activo", level: 1, nature: "D" },
  { code: "100.01", description: "Activo a corto plazo", level: 2, nature: "D" },
  { code: "101", description: "Caja", level: 1, nature: "D" },
  { code: "101.01", description: "Caja y efectivo", level: 2, nature: "D" },
  { code: "102", description: "Bancos", level: 1, nature: "D" },
  { code: "102.01", description: "Bancos nacionales", level: 2, nature: "D" },
  { code: "102.02", description: "Bancos extranjeros", level: 2, nature: "D" },
  { code: "105", description: "Clientes", level: 1, nature: "D" },
  { code: "105.01", description: "Clientes nacionales", level: 2, nature: "D" },
  { code: "105.02", description: "Clientes extranjeros", level: 2, nature: "D" },
  { code: "107", description: "Deudores diversos", level: 1, nature: "D" },
  { code: "107.05", description: "Otros deudores diversos", level: 2, nature: "D" },
  { code: "113", description: "Impuestos a favor", level: 1, nature: "D" },
  { code: "113.01", description: "IVA a favor", level: 2, nature: "D" },
  { code: "113.02", description: "ISR a favor", level: 2, nature: "D" },
  { code: "114", description: "Pagos provisionales", level: 1, nature: "D" },
  { code: "114.01", description: "Pagos provisionales de ISR", level: 2, nature: "D" },
  { code: "115", description: "Inventario", level: 1, nature: "D" },
  { code: "115.01", description: "Inventario", level: 2, nature: "D" },
  { code: "118", description: "Impuestos acreditables pagados", level: 1, nature: "D" },
  { code: "118.01", description: "IVA acreditable pagado", level: 2, nature: "D" },
  { code: "119", description: "Impuestos acreditables por pagar", level: 1, nature: "D" },
  { code: "119.01", description: "IVA pendiente de pago", level: 2, nature: "D" },
  { code: "120", description: "Anticipo a proveedores", level: 1, nature: "D" },
  { code: "120.01", description: "Anticipo a proveedores nacional", level: 2, nature: "D" },
  { code: "100.02", description: "Activo a largo plazo", level: 2, nature: "D" },
  { code: "155", description: "Mobiliario y equipo de oficina", level: 1, nature: "D" },
  { code: "155.01", description: "Mobiliario y equipo de oficina", level: 2, nature: "D" },
  { code: "156", description: "Equipo de cómputo", level: 1, nature: "D" },
  { code: "156.01", description: "Equipo de cómputo", level: 2, nature: "D" },
  { code: "171", description: "Depreciación acumulada de activos fijos", level: 1, nature: "A" },
  { code: "171.04", description: "Depreciación acumulada de mobiliario y equipo de oficina", level: 2, nature: "A" },
  { code: "200", description: "Pasivo", level: 1, nature: "A" },
  { code: "200.01", description: "Pasivo a corto plazo", level: 2, nature: "A" },
  { code: "201", description: "Proveedores", level: 1, nature: "A" },
  { code: "201.01", description: "Proveedores nacionales", level: 2, nature: "A" },
  { code: "201.02", description: "Proveedores extranjeros", level: 2, nature: "A" },
  { code: "205", description: "Acreedores diversos a corto plazo", level: 1, nature: "A" },
  { code: "205.06", description: "Otros acreedores diversos a corto plazo", level: 2, nature: "A" },
  { code: "206", description: "Anticipo de cliente", level: 1, nature: "A" },
  { code: "206.01", description: "Anticipo de cliente nacional", level: 2, nature: "A" },
  { code: "208", description: "Impuestos trasladados cobrados", level: 1, nature: "A" },
  { code: "208.01", description: "IVA trasladado cobrado", level: 2, nature: "A" },
  { code: "208.02", description: "IEPS trasladado cobrado", level: 2, nature: "A" },
  { code: "209", description: "Impuestos trasladados no cobrados", level: 1, nature: "A" },
  { code: "209.01", description: "IVA trasladado no cobrado", level: 2, nature: "A" },
  { code: "209.02", description: "IEPS trasladado no cobrado", level: 2, nature: "A" },
  { code: "213", description: "Impuestos y derechos por pagar", level: 1, nature: "A" },
  { code: "213.01", description: "IVA por pagar", level: 2, nature: "A" },
  { code: "213.03", description: "ISR por pagar", level: 2, nature: "A" },
  { code: "216", description: "Impuestos retenidos", level: 1, nature: "A" },
  { code: "216.01", description: "Impuestos retenidos de ISR por sueldos y salarios", level: 2, nature: "A" },
  { code: "216.04", description: "Impuestos retenidos de ISR por servicios profesionales", level: 2, nature: "A" },
  { code: "216.10", description: "Impuestos retenidos de IVA", level: 2, nature: "A" },
  { code: "300", description: "Capital contable", level: 1, nature: "A" },
  { code: "301", description: "Capital social", level: 1, nature: "A" },
  { code: "301.01", description: "Capital fijo", level: 2, nature: "A" },
  { code: "304", description: "Resultado de ejercicios anteriores", level: 1, nature: "A" },
  { code: "304.01", description: "Utilidad de ejercicios anteriores", level: 2, nature: "A" },
  { code: "304.02", description: "Pérdida de ejercicios anteriores", level: 2, nature: "D" },
  { code: "305", description: "Resultado del ejercicio", level: 1, nature: "A" },
  { code: "305.01", description: "Utilidad del ejercicio", level: 2, nature: "A" },
  { code: "305.02", description: "Pérdida del ejercicio", level: 2, nature: "D" },
  { code: "400", description: "Ingresos", level: 1, nature: "A" },
  { code: "401", description: "Ingresos", level: 1, nature: "A" },
  { code: "401.01", description: "Ventas y/o servicios gravados a la tasa general", level: 2, nature: "A" },
  { code: "401.04", description: "Ventas y/o servicios gravados al 0%", level: 2, nature: "A" },
  { code: "401.07", description: "Ventas y/o servicios exentos", level: 2, nature: "A" },
  { code: "402", description: "Devoluciones, descuentos o bonificaciones sobre ingresos", level: 1, nature: "D" },
  { code: "402.01", description: "Devoluciones, descuentos o bonificaciones sobre ventas y/o servicios a la tasa general", level: 2, nature: "D" },
  { code: "403", description: "Otros ingresos", level: 1, nature: "A" },
  { code: "403.04", description: "Otros ingresos", level: 2, nature: "A" },
  { code: "500", description: "Costos", level: 1, nature: "D" },
  { code: "501", description: "Costo de venta y/o servicio", level: 1, nature: "D" },
  { code: "501.01", description: "Costo de venta", level: 2, nature: "D" },
  { code: "502", description: "Compras", level: 1, nature: "D" },
  { code: "502.01", description: "Compras nacionales", level: 2, nature: "D" },
  { code: "600", description: "Gastos", level: 1, nature: "D" },
  { code: "601", description: "Gastos generales", level: 1, nature: "D" },
  { code: "601.01", description: "Sueldos y salarios", level: 2, nature: "D" },
  { code: "601.45", description: "Arrendamiento", level: 2, nature: "D" },
  { code: "601.48", description: "Combustibles y lubricantes", level: 2, nature: "D" },
  { code: "601.50", description: "Teléfono, internet", level: 2, nature: "D" },
  { code: "601.52", description: "Energía eléctrica", level: 2, nature: "D" },
  { code: "601.84", description: "Otros gastos generales", level: 2, nature: "D" },
  { code: "700", description: "Resultado integral de financiamiento", level: 1, nature: "D" },
  { code: "701", description: "Gastos financieros", level: 1, nature: "D" },
  { code: "701.10", description: "Comisiones bancarias", level: 2, nature: "D" },
  { code: "702", description: "Productos financieros", level: 1, nature: "A" },
  { code: "702.10", description: "Otros productos financieros", level: 2, nature: "A" },
];
