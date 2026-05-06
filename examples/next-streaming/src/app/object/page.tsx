'use client'

import { useState, useCallback } from 'react'

interface SentimentResult {
  output: { sentiment: string; confidence: number; keyPhrases: string[] }
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  provider: string
  model: string
}

export default function ObjectPage() {
  const [text, setText] = useState('The battery lasts forever but the screen is dim in sunlight. Overall I\'d buy it again.')
  const [result, setResult] = useState<SentimentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const run = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(`${data.error}: ${data.message}`)
        return
      }
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setIsLoading(false)
    }
  }, [text])

  return (
    <main>
      <h1>One-shot structured output</h1>
      <p>
        Route handler calls <code>.object()</code> with a Zod schema, validates the response,
        and returns typed JSON. The client fetches and displays.
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', marginBottom: '0.5rem' }}
      />
      <button onClick={run} disabled={isLoading} style={{ padding: '0.5rem 1rem', marginBottom: '1rem' }}>
        {isLoading ? 'Analyzing...' : 'Analyze sentiment'}
      </button>

      {error && (
        <pre style={{ color: 'red', background: '#fef2f2', padding: '1rem', borderRadius: 4 }}>
          {error}
        </pre>
      )}

      {result && (
        <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: 4 }}>
          <p><strong>Sentiment:</strong> {result.output.sentiment} ({(result.output.confidence * 100).toFixed(0)}% confidence)</p>
          <p><strong>Key phrases:</strong> {result.output.keyPhrases.join(', ')}</p>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '1rem' }}>
            {result.provider}/{result.model} — {result.usage.totalTokens} tokens
          </p>
        </div>
      )}
    </main>
  )
}
