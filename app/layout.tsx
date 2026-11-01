import type { Metadata } from "next";
import { MarketplaceProvider } from "@/components/providers/marketplace";
import "./globals.css";

export const metadata: Metadata = { title: "Campaign Studio" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MarketplaceProvider>{children}</MarketplaceProvider>
      </body>
    </html>
  );
}
