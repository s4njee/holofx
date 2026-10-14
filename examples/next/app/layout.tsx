import type { ReactNode } from 'react';

export const metadata = { title: 'holofx example · next' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#0b0d11',
          color: '#f0f2f5',
          font: '15px/1.5 system-ui, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
