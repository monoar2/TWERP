/**
 * Typed client for the ERP API. Amounts arrive as decimal strings (never
 * floats) so they can be displayed or summed with a decimal library.
 */

export type Money = string;

export interface Product {
  id: number; sku: string; name: string; description: string | null; type: "product" | "service";
  clave_prod_serv: string; clave_unidad: string; unit_name: string; sale_price: Money; purchase_price: Money;
  objeto_imp: string; iva_factor: "Tasa" | "Exento"; iva_rate: string; avg_cost: Money; min_stock: string; total_qty: string;
}
export interface ThirdParty {
  id: number; name: string; rfc: string; regimen_fiscal: string; codigo_postal: string; uso_cfdi: string;
  is_customer: boolean; is_supplier: boolean; email: string | null; phone: string | null; credit_days: number;
}
export interface Warehouse { id: number; code: string; name: string; address: string | null }
export interface BankAccount { id: number; name: string; bank: string | null; clabe: string | null; account_code: string }
export interface StockRow {
  product_id: number; sku: string; name: string; warehouse_id: number; warehouse_code: string;
  qty: string; avg_cost: Money; value: Money; min_stock: string; below_min: boolean;
}
export interface StockMovement {
  id: number; moved_at: string; product_id: number; sku: string; product_name: string; warehouse_code: string;
  kind: string; qty: string; unit_cost: Money; avg_cost_after: Money; label: string | null;
}
export interface SalesInvoiceSummary {
  id: number; serie: string; folio: number | null; issue_date: string; status: "draft" | "stamped" | "cancelled";
  metodo_pago: "PUE" | "PPD"; subtotal: Money; total_traslados: Money; total_retenciones: Money; total: Money; paid_amount: Money;
  uuid: string | null; customer_name: string; customer_rfc: string;
}
export interface SalesInvoiceLine {
  id: number; line_no: number; product_id: number | null; description: string; clave_prod_serv: string; clave_unidad: string;
  qty: string; unit_price: Money; discount: Money; iva_rate: string; base: Money; iva_amount: Money; total: Money;
}
export interface SalesInvoice extends SalesInvoiceSummary {
  third_party_id: number; warehouse_id: number | null; uso_cfdi: string; forma_pago: string; hasXml: boolean;
  lines: SalesInvoiceLine[]; payments: Payment[];
}
export interface SupplierInvoice {
  id: number; third_party_id: number; supplier_name: string; supplier_rfc: string; supplier_ref: string | null; uuid: string | null;
  issue_date: string; metodo_pago: "PUE" | "PPD"; subtotal: Money; iva: Money; ret_iva: Money; ret_isr: Money; total: Money;
  paid_amount: Money; status: "draft" | "validated" | "cancelled";
}
export interface Payment { id: number; direction: "in" | "out"; paid_on: string; amount: Money; forma_pago: string; reference: string | null }
export interface Account {
  id: number; code: string; name: string; parent_code: string | null; level: number; nature: "D" | "A";
  kind: string; sat_code: string; sat_description: string; postable: boolean;
}
export interface JournalEntry {
  id: number; journal_code: string; number: number | null; entry_date: string; concept: string; status: string;
  source_type: string | null; source_id: number | null; amount?: Money;
}
export interface JournalLine { id: number; line_no: number; code: string; name: string; debit: Money; credit: Money; description: string; cfdi_uuid: string | null }
export interface TrialBalanceRow {
  accountId: number; code: string; name: string; satCode: string; level: number; nature: "D" | "A";
  saldoIni: Money; debe: Money; haber: Money; saldoFin: Money;
}
export interface IncomeStatement { from: string; to: string; income: Money; costs: Money; grossProfit: Money; expenses: Money; netProfit: Money; accounts: Array<{ code: string; name: string; kind: string; amount: Money }> }
export interface IvaReport { year: number; month: number; ivaCausado: Money; ivaAcreditable: Money; ivaRetenidoPorClientes: Money; ivaACargo: Money; ivaAFavor: Money; retencionesIvaAEnterar: Money; note: string }
export interface Dashboard {
  sales_this_month: Money; receivables: Money; payables: Money; inventory_value: Money; low_stock_items: number; draft_invoices: number;
  topProducts: Array<{ sku: string; name: string; qty: string; sales: Money }>;
}
export interface AiQuery { sql: string; purpose: string; rowCount: number; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; error?: string }
export interface AiAnswer { answer: string; queries: AiQuery[]; model: string; usage: { inputTokens: number; outputTokens: number } }
export interface CatalogEntry { code: string; description: string }
export interface SatCatalogs {
  regimenesFiscales: Array<CatalogEntry & { fisica: boolean; moral: boolean }>; usosCfdi: CatalogEntry[]; formasPago: CatalogEntry[];
  metodosPago: CatalogEntry[]; objetosImpuesto: CatalogEntry[]; clavesUnidad: Array<{ code: string; name: string }>;
}

export interface SalesLineInput { productId?: number; description?: string; qty: number | string; unitPrice?: number | string; discount?: number | string; retIvaRate?: string; retIsrRate?: string }
export interface SupplierLineInput { productId?: number; accountId?: number; description?: string; qty: number | string; unitPrice: number | string; ivaRate?: string; retIvaRate?: string; retIsrRate?: string }

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      const err = data as { error?: string; details?: unknown };
      throw new ApiError(res.status, err?.error ?? `HTTP ${res.status}`, err?.details);
    }
    return data as T;
  }
  const qs = (params: Record<string, string | number | boolean | undefined>) => {
    const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
    return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : "";
  };
  const get = <T>(path: string) => request<T>("GET", path);
  const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
  const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);

  return {
    /** Absolute URL for downloads (XML files); add the token header yourself if the API requires one. */
    url: (path: string) => `${base}${path}`,
    request,

    satCatalogs: () => get<SatCatalogs>("/sat/catalogs"),
    searchProdServ: (q: string) => get<CatalogEntry[]>(`/sat/prodserv${qs({ q })}`),
    company: () => get<Record<string, unknown> | null>("/company"),
    saveCompany: (b: { rfc: string; razonSocial: string; regimenFiscal: string; codigoPostal: string; invoiceSerie?: string; allowNegativeStock?: boolean }) => put("/company", b),
    dashboard: () => get<Dashboard>("/dashboard"),

    thirdParties: (p: { role?: "customer" | "supplier"; q?: string } = {}) => get<ThirdParty[]>(`/third-parties${qs(p)}`),
    createThirdParty: (b: { name: string; rfc: string; regimenFiscal: string; codigoPostal: string; usoCfdi?: string; isCustomer?: boolean; isSupplier?: boolean; email?: string; phone?: string }) =>
      post<ThirdParty>("/third-parties", b),

    products: (q?: string) => get<Product[]>(`/products${qs({ q })}`),
    product: (id: number) => get<Product & { stock: Array<{ warehouse_id: number; code: string; name: string; qty: string }> }>(`/products/${id}`),
    createProduct: (b: { sku: string; name: string; type?: "product" | "service"; claveProdServ: string; claveUnidad: string; unitName?: string; salePrice?: number | string; purchasePrice?: number | string; ivaRate?: string; ivaFactor?: "Tasa" | "Exento"; minStock?: number | string }) =>
      post<Product>("/products", b),
    warehouses: () => get<Warehouse[]>("/warehouses"),
    createWarehouse: (b: { code: string; name: string; address?: string }) => post<Warehouse>("/warehouses", b),
    bankAccounts: () => get<BankAccount[]>("/bank-accounts"),
    createBankAccount: (b: { name: string; bank?: string; clabe?: string; accountCode?: string }) => post<BankAccount>("/bank-accounts", b),

    stock: (p: { warehouseId?: number; lowOnly?: boolean } = {}) => get<StockRow[]>(`/stock${qs(p)}`),
    movements: (p: { productId?: number; from?: string; to?: string; limit?: number } = {}) => get<StockMovement[]>(`/stock/movements${qs(p)}`),
    adjustStock: (b: { productId: number; warehouseId: number; qty: number | string; unitCost?: number | string; reason: string; initial?: boolean }) => post("/stock/adjustments", b),
    transferStock: (b: { productId: number; fromWarehouseId: number; toWarehouseId: number; qty: number | string; label?: string }) => post("/stock/transfers", b),
    inventoryCounts: () => get<Array<{ id: number; label: string; status: string; warehouse_code: string; created_at: string }>>("/inventory-counts"),
    inventoryCount: (id: number) => get<{ id: number; label: string; status: string; lines: Array<{ product_id: number; sku: string; name: string; qty_expected: string; qty_counted: string | null }> }>(`/inventory-counts/${id}`),
    createInventoryCount: (b: { warehouseId: number; label: string }) => post<{ id: number }>("/inventory-counts", b),
    setCountLines: (id: number, lines: Array<{ productId: number; qtyCounted: number | string | null }>) => put(`/inventory-counts/${id}/lines`, lines),
    validateCount: (id: number) => post<{ adjustments: number[] }>(`/inventory-counts/${id}/validate`),

    salesInvoices: (p: { status?: string; customerId?: number } = {}) => get<SalesInvoiceSummary[]>(`/sales-invoices${qs(p)}`),
    salesInvoice: (id: number) => get<SalesInvoice>(`/sales-invoices/${id}`),
    createSalesInvoice: (b: { thirdPartyId: number; warehouseId?: number; metodoPago: "PUE" | "PPD"; formaPago?: string; usoCfdi?: string; notes?: string; lines: SalesLineInput[] }) =>
      post<{ id: number }>("/sales-invoices", b),
    issueSalesInvoice: (id: number) => post<{ id: number; folio: number; uuid: string }>(`/sales-invoices/${id}/issue`),
    cancelSalesInvoice: (id: number, motivo = "02", folioSustitucion?: string) => post(`/sales-invoices/${id}/cancel`, { motivo, folioSustitucion }),
    collectPayment: (id: number, b: { bankAccountId: number; amount: number | string; paidOn?: string; formaPago?: string; reference?: string }) => post(`/sales-invoices/${id}/payments`, b),

    supplierInvoices: () => get<SupplierInvoice[]>("/supplier-invoices"),
    supplierInvoice: (id: number) => get<SupplierInvoice & { lines: Array<{ id: number; line_no: number; product_id: number | null; account_id: number | null; description: string; qty: string; unit_price: Money; base: Money; iva_amount: Money; ret_iva_amount: Money; ret_isr_amount: Money; total: Money }> }>(`/supplier-invoices/${id}`),
    createSupplierInvoice: (b: { thirdPartyId: number; warehouseId?: number; supplierRef?: string; uuid?: string; issueDate?: string; metodoPago?: "PUE" | "PPD"; lines: SupplierLineInput[] }) =>
      post<{ id: number }>("/supplier-invoices", b),
    validateSupplierInvoice: (id: number) => post(`/supplier-invoices/${id}/validate`),
    paySupplier: (id: number, b: { bankAccountId: number; amount: number | string; paidOn?: string; formaPago?: string; reference?: string }) => post(`/supplier-invoices/${id}/payments`, b),

    accounts: () => get<Account[]>("/accounts"),
    createAccount: (b: { code: string; name: string; parentCode: string; satCode?: string }) => post<Account>("/accounts", b),
    journalEntries: (p: { from?: string; to?: string; journal?: string; limit?: number } = {}) => get<JournalEntry[]>(`/journal-entries${qs(p)}`),
    journalEntry: (id: number) => get<JournalEntry & { lines: JournalLine[] }>(`/journal-entries/${id}`),
    createJournalEntry: (b: { journal?: string; date: string; concept: string; lines: Array<{ accountCode: string; debit?: number | string; credit?: number | string; description?: string }> }) =>
      post<{ id: number }>("/journal-entries", b),
    trialBalance: (year: number, month: number) => get<TrialBalanceRow[]>(`/reports/trial-balance${qs({ year, month })}`),
    ledger: (account: string, from: string, to: string) => get<{ account: { code: string; name: string }; openingBalance: Money; closingBalance: Money; lines: Array<{ entryId: number; date: string; journal: string; concept: string; debit: Money; credit: Money; balance: Money }> }>(`/reports/ledger${qs({ account, from, to })}`),
    incomeStatement: (from: string, to: string) => get<IncomeStatement>(`/reports/income-statement${qs({ from, to })}`),
    ivaReport: (year: number, month: number) => get<IvaReport>(`/reports/iva${qs({ year, month })}`),
    closePeriod: (year: number, month: number) => post(`/periods/${year}/${month}/close`),

    /** Paths for the Anexo 24 XML downloads. */
    satExportPath: (kind: "catalogo" | "balanza" | "polizas", year: number, month: number, extra: Record<string, string> = {}) =>
      `/sat/electronic-accounting/${kind}${qs({ year, month, ...extra })}`,
    salesInvoiceXmlPath: (id: number) => `/sales-invoices/${id}/xml`,

    askAi: (question: string, history: Array<{ role: "user" | "assistant"; content: string }> = []) => post<AiAnswer>("/ai/query", { question, history }),
  };
}

export type ErpClient = ReturnType<typeof createClient>;

/** Format a decimal string as Mexican pesos. */
export function formatMXN(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}
