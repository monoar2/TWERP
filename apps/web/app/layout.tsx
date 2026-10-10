import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP — Inventario, Facturación CFDI y Contabilidad",
  description: "ERP para empresas mexicanas",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
