export const metadata = { title: '@tidepool/llm-client — React streaming examples' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
        <nav style={{ marginBottom: '2rem', display: 'flex', gap: '1.5rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
          <a href="/">Home</a>
          <a href="/stream">Streaming</a>
          <a href="/object">One-shot</a>
          <a href="/rsc">RSC + Suspense</a>
        </nav>
        {children}
      </body>
    </html>
  )
}
