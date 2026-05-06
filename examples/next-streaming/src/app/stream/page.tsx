'use client'

import { useState, useCallback } from 'react'

interface StreamState {
  rawText: string
  data: { title: string; story: string; mood: string } | null
  isStreaming: boolean
  error: string | null
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
}

export default function StreamPage() {
  const [topic, setTopic] = useState('a cat who learns to code')
  const [state, setState] = useState<StreamState>({
    rawText: '',
    data: null,
    isStreaming: false,
    error: null,
    usage: null,
  })

  const run = useCallback(async () => {
    setState({ rawText: '', data: null, isStreaming: true, error: null, usage: null })

    try {
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      })

      if (!response.ok || !response.body) {
        setState(s => ({ ...s, isStreaming: false, error: `HTTP ${response.status}` }))
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7)
          } else if (line.startsWith('data: ') && eventType) {
            const event = JSON.parse(line.slice(6))

            if (eventType === 'output_delta') {
              setState(s => ({ ...s, rawText: s.rawText + event.text }))
            } else if (eventType === 'complete') {
              setState(s => ({ ...s, data: event.data, usage: event.usage }))
            } else if (eventType === 'error') {
              setState(s => ({ ...s, error: event.message }))
            }
            eventType = ''
          }
        }
      }
    } catch (err) {
      setState(s => ({ ...s, error: err instanceof Error ? err.message : 'Failed' }))
    } finally {
      setState(s => ({ ...s, isStreaming: false }))
    }
  }, [topic])

  return (
    <main>
      <h1>Streaming structured output</h1>
      <p>
        Route handler calls <code>.streamObject()</code>, converts the <code>AsyncGenerator&lt;StreamEvent&gt;</code> to
        SSE, and the client parses events to drive React state.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Story topic..."
          style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
        />
        <button onClick={run} disabled={state.isStreaming} style={{ padding: '0.5rem 1rem' }}>
          {state.isStreaming ? 'Streaming...' : 'Generate'}
        </button>
      </div>

      {state.error && (
        <pre style={{ color: 'red', background: '#fef2f2', padding: '1rem', borderRadius: 4 }}>
          {state.error}
        </pre>
      )}

      {state.rawText && (
        <div style={{ background: '#f9fafb', padding: '1rem', borderRadius: 4, marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>Raw stream {state.isStreaming && <span style={{ color: '#6b7280' }}>●</span>}</h3>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{state.rawText}</pre>
        </div>
      )}

      {state.data && (
        <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: 4, marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>Validated result</h3>
          <p><strong>Title:</strong> {state.data.title}</p>
          <p><strong>Mood:</strong> {state.data.mood}</p>
          <p>{state.data.story}</p>
        </div>
      )}

      {state.usage && (
        <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
          Tokens: {state.usage.promptTokens} prompt + {state.usage.completionTokens} completion = {(state.usage.promptTokens ?? 0) + (state.usage.completionTokens ?? 0)} total
        </p>
      )}
    </main>
  )
}
