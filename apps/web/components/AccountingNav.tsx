import { SubNav } from "./ui";

export function AccountingNav() {
  return (
    <SubNav items={[
      { href: "/accounting/", label: "Catálogo de cuentas" },
      { href: "/accounting/entries/", label: "Pólizas" },
      { href: "/accounting/trial-balance/", label: "Balanza de comprobación" },
      { href: "/accounting/ledger/", label: "Auxiliar" },
      { href: "/accounting/income-statement/", label: "Estado de resultados" },
    ]} />
  );
}
