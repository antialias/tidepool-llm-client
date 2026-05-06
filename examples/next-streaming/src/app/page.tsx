export default function Home() {
  return (
    <main>
      <h1>@tidepool/llm-client — React Streaming Examples</h1>
      <p>Three patterns for using llm-client with React and Next.js:</p>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <a href="/stream"><strong>Streaming structured output</strong></a> — Route handler
          calls <code>.streamObject()</code>, converts to SSE, client component consumes
          the stream and renders partial output.
        </li>
        <li>
          <a href="/object"><strong>One-shot structured output</strong></a> — Route handler
          calls <code>.object()</code>, returns JSON. Client component fetches and displays.
        </li>
        <li>
          <a href="/rsc"><strong>RSC + Suspense</strong></a> — Async server component
          awaits <code>.object()</code> directly during render. No API route needed — Suspense
          streams the result when ready.
        </li>
      </ul>
    </main>
  )
}
