import { createVerify, generateKeyPairSync, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCfdiXml, CsdError, loadCsd } from "../src/index.js";
import { CFDI_CASES } from "./cfdi-cases.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const cer = fixture("csd/EKU9003173C9.cer");
const key = fixture("csd/EKU9003173C9.key");
// Produced by SAT's cadenaoriginal_4_0.xslt from the signed XML of each case.
const satCadenas = JSON.parse(fixture("cadenas-sat.json").toString("utf8")) as Record<string, string>;
const at = new Date("2026-10-01T12:00:00Z");

describe("CSD", () => {
  it("loads the SAT test CSD", () => {
    const csd = loadCsd(cer, key, "12345678a", at);
    expect(csd.rfc).toBe("EKU9003173C9");
    expect(csd.noCertificado).toBe("30001000000500003416");
    expect(csd.sucursal).toBe("Sucursal 1");
  });

  it("rejects a wrong password, a key from another certificate and an expired certificate", () => {
    expect(() => loadCsd(cer, key, "incorrecta", at)).toThrow(CsdError);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ format: "der", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "12345678a" });
    expect(() => loadCsd(cer, other, "12345678a", at)).toThrow(/no corresponde/);
    expect(() => loadCsd(cer, key, "12345678a", new Date("2030-01-01"))).toThrow(/vigente/);
  });
});

describe("CFDI sealing", () => {
  const csd = loadCsd(cer, key, "12345678a", at);

  for (const [name, input] of Object.entries(CFDI_CASES)) {
    it(`matches SAT's cadena original and signs it (${name})`, () => {
      const { xml, cadenaOriginal } = buildCfdiXml(input, csd.signer);
      expect(cadenaOriginal).toBe(satCadenas[name]);
      expect(xml).toContain('NoCertificado="30001000000500003416"');
      const sello = / Sello="([^"]+)"/.exec(xml)![1]!;
      const certificado = / Certificado="([^"]+)"/.exec(xml)![1]!;
      const publicKey = new X509Certificate(Buffer.from(certificado, "base64")).publicKey;
      expect(createVerify("RSA-SHA256").update(cadenaOriginal, "utf8").verify(publicKey, sello, "base64")).toBe(true);
    });
  }

  it("leaves Sello and Certificado out when not signing", () => {
    const { xml } = buildCfdiXml(CFDI_CASES.simple!);
    expect(xml).not.toContain("Sello=");
    expect(xml).not.toContain("NoCertificado=");
  });
});
