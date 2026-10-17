import { randomUUID } from "node:crypto";

export interface StampResult {
  uuid: string;
  /** The CFDI with its TimbreFiscalDigital. */
  xml: string;
  stampedAt: string;
}

export interface CancelRequest {
  uuid: string;
  rfcEmisor: string;
  rfcReceptor: string;
  total: string;
  /** SAT motivo: 01 con relación, 02 sin relación, 03 no se llevó a cabo, 04 nominativa en global. */
  motivo: string;
  folioSustitucion?: string;
  /** The issuer's CSD, which signs the cancellation request. */
  csd: { cer: Buffer; key: Buffer; password: string };
}

export interface CancelResult {
  /** "pending" when SAT is waiting for the receptor to accept. */
  status: "cancelled" | "pending";
  acuse?: string;
}

/** Error reported by the PAC (the CFDI was rejected or the service failed). */
export class PacError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/**
 * A PAC (Proveedor Autorizado de Certificación) validates a sealed CFDI and
 * adds SAT's TimbreFiscalDigital. Other providers plug in by implementing this.
 */
export interface PacProvider {
  readonly name: string;
  /** Whether CFDIs must be sealed with the company's CSD before stamping. */
  readonly requiresCsd: boolean;
  stamp(xml: string): Promise<StampResult>;
  cancel(req: CancelRequest): Promise<CancelResult>;
}

/**
 * Development provider: returns a fake TimbreFiscalDigital so the full flow
 * can be exercised. The result is NOT a valid CFDI for SAT.
 */
export class SandboxPac implements PacProvider {
  readonly name = "sandbox";
  readonly requiresCsd = false;

  async stamp(xml: string) {
    const uuid = randomUUID().toUpperCase();
    const stampedAt = new Date().toISOString().slice(0, 19);
    const selloCfd = / Sello="([^"]*)"/.exec(xml)?.[1] ?? "SANDBOX";
    const tfd =
      `<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"` +
      ` Version="1.1" UUID="${uuid}" FechaTimbrado="${stampedAt}" RfcProvCertif="SPR190613I52"` +
      ` SelloCFD="${selloCfd}" NoCertificadoSAT="00000000000000000000" SelloSAT="SANDBOX"/></cfdi:Complemento>`;
    return { uuid, stampedAt, xml: xml.replace("</cfdi:Comprobante>", `${tfd}\n</cfdi:Comprobante>`) };
  }

  async cancel() {
    return { status: "cancelled" as const };
  }
}

export interface SwSapienOptions {
  /** https://services.test.sw.com.mx (pruebas) or https://services.sw.com.mx (producción). */
  url: string;
  /** Account user and password, or a long-lived token from the SW dashboard. */
  user?: string;
  password?: string;
  token?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface SwResponse<T> {
  status: "success" | "error";
  data?: T;
  message?: string;
  messageDetail?: string;
}

/**
 * SW Sapien (SmarterWeb) REST API: stamps a CFDI sealed by the issuer
 * (/cfdi33/stamp/v4, which also serves CFDI 4.0) and cancels with the CSD.
 */
export class SwSapienPac implements PacProvider {
  readonly name = "sw";
  readonly requiresCsd = true;
  private session?: { token: string; until: number };
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: SwSapienOptions) {
    if (!opts.token && !(opts.user && opts.password)) throw new Error("SW Sapien requiere SW_TOKEN o SW_USER y SW_PASSWORD");
    this.fetch = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit, auth = true): Promise<SwResponse<T>> {
    const headers = new Headers(init.headers);
    if (auth) headers.set("authorization", `bearer ${await this.token()}`);
    let res: Response;
    try {
      res = await this.fetch(`${this.opts.url.replace(/\/$/, "")}${path}`, {
        ...init, headers, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      });
    } catch (err) {
      throw new PacError(`No se pudo conectar con el PAC: ${(err as Error).message}`);
    }
    const text = await res.text();
    let body: SwResponse<T>;
    try {
      body = JSON.parse(text) as SwResponse<T>;
    } catch {
      throw new PacError(`Respuesta inesperada del PAC (HTTP ${res.status})`);
    }
    if (auth && res.status === 401) this.session = undefined;
    return body;
  }

  private async token(): Promise<string> {
    if (this.opts.token) return this.opts.token;
    if (this.session && this.session.until > Date.now()) return this.session.token;
    const body = await this.request<{ token: string; expires_in?: number }>("/security/authenticate", {
      method: "POST", headers: { user: this.opts.user!, password: this.opts.password! },
    }, false);
    if (body.status !== "success" || !body.data?.token) throw new PacError(`El PAC rechazó las credenciales: ${describe(body)}`);
    // Tokens last two hours; renew a little earlier.
    this.session = { token: body.data.token, until: Date.now() + 100 * 60_000 };
    return body.data.token;
  }

  async stamp(xml: string): Promise<StampResult> {
    const form = new FormData();
    form.append("xml", new Blob([xml], { type: "application/xml" }), "cfdi.xml");
    const body = await this.request<{ uuid: string; cfdi: string; fechaTimbrado: string }>("/cfdi33/stamp/v4", { method: "POST", body: form });
    // 307: this exact CFDI was already stamped; SW returns the original timbre.
    const data = body.data;
    if ((body.status === "success" || body.message?.startsWith("307")) && data?.uuid && data.cfdi) {
      return { uuid: data.uuid.toUpperCase(), xml: data.cfdi, stampedAt: data.fechaTimbrado };
    }
    throw new PacError(`El PAC rechazó la factura: ${describe(body)}`, body.message?.split(".")[0]);
  }

  async cancel(req: CancelRequest): Promise<CancelResult> {
    const body = await this.request<{ acuse?: string; uuid?: Record<string, string> }>("/cfdi33/cancel/csd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uuid: req.uuid,
        password: req.csd.password,
        rfc: req.rfcEmisor,
        motivo: req.motivo,
        foliosustitucion: req.folioSustitucion,
        b64Cer: req.csd.cer.toString("base64"),
        b64Key: req.csd.key.toString("base64"),
      }),
    });
    if (body.status !== "success") throw new PacError(`El PAC no pudo cancelar: ${describe(body)}`);
    // 201: cancellation requested and accepted; 202: it was already cancelled.
    const code = Object.entries(body.data?.uuid ?? {}).find(([u]) => u.toUpperCase() === req.uuid.toUpperCase())?.[1];
    return { status: code === "201" || code === "202" ? "cancelled" : "pending", acuse: body.data?.acuse };
  }
}

function describe(body: SwResponse<unknown>): string {
  return [body.message, body.messageDetail].filter(Boolean).join(" — ") || "sin detalle";
}

/** Pick the PAC from the environment: PAC_PROVIDER=sandbox (default) or sw. */
export function pacFromEnv(env: NodeJS.ProcessEnv = process.env): PacProvider {
  const provider = env.PAC_PROVIDER ?? "sandbox";
  if (provider === "sandbox") return new SandboxPac();
  if (provider === "sw") {
    return new SwSapienPac({
      url: env.SW_URL ?? "https://services.test.sw.com.mx",
      user: env.SW_USER,
      password: env.SW_PASSWORD,
      token: env.SW_TOKEN,
    });
  }
  throw new Error(`PAC_PROVIDER desconocido: ${provider} (usa sandbox o sw)`);
}
