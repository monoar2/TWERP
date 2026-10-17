import { SubNav } from "./ui";

export function InventoryNav() {
  return (
    <SubNav items={[
      { href: "/inventory/", label: "Existencias" },
      { href: "/inventory/movements/", label: "Kárdex / movimientos" },
      { href: "/inventory/adjust/", label: "Ajustes y traspasos" },
      { href: "/inventory/counts/", label: "Inventario físico" },
    ]} />
  );
}
