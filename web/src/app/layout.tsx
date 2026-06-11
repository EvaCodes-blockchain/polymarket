import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Justify — Trade Smarter, Together",
  description:
    "Social prediction-market platform. Post ideas, follow creators, and trade on embedded markets.",
  icons: { icon: "/img/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Material Icons (Google CDN — same as prototype) */}
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons"
          rel="stylesheet"
        />
      </head>
      <body className="bg-brown-gradient min-h-screen">{children}</body>
    </html>
  );
}
