import { SubNav } from "./ui";

export function TaxesNav() {
  return <SubNav items={[{ href: "/taxes/", label: "IVA mensual" }, { href: "/taxes/sat-export/", label: "Contabilidad electrónica (SAT)" }]} />;
}
