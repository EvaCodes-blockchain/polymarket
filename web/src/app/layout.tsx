// Placeholder layout so the package builds before the UI scaffold lands.
// Replaced by frontend-engineer's scaffold (feat/mvp/web-scaffold) on rebase.
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Justify — Trade Smarter, Together',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
