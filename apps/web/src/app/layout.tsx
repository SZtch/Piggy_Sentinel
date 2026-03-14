import type { Metadata } from "next";
import "./globals.css";
import { Providers }   from "./providers";
import { PennyBubble } from "@/components/PennyBubble";

export const metadata: Metadata = {
  title:       "Piggy Sentinel — Your AI Savings Agent",
  description: "Tell Penny your financial goal. She builds and manages the strategy automatically.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>
          {children}
          <PennyBubble />
        </Providers>
      </body>
    </html>
  );
}
