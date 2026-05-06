# Next.js Streaming Example

Three patterns for consuming `@tidepool/llm-client` from React and Next.js:

| Route | Pattern | What it demonstrates |
|-------|---------|---------------------|
| `/stream` | **SSE streaming** | Route handler converts `AsyncGenerator<StreamEvent>` to Server-Sent Events. Client component parses events to drive React state with live partial output. |
| `/object` | **One-shot structured output** | Route handler calls `.object()` with a Zod schema, returns validated JSON. Client component fetches and displays. |
| `/rsc` | **RSC + Suspense** | Async server components `await .object()` directly during render — no API route, no client-side fetch. React streams HTML when each Suspense boundary resolves. |

## Setup

```sh
# From the repo root
pnpm install

# Set your OpenAI API key
echo "OPENAI_API_KEY=sk-..." > packages/llm-client/examples/next-streaming/.env.local

# Start the dev server (port 3002)
pnpm --filter llm-client-next-streaming-example dev
```

Then open [http://localhost:3002](http://localhost:3002).

## How it works

### Intent registry (`src/lib/ai.ts`)

The example defines three intents — one per demo page:

```ts
const registry = defineIntentRegistry({
  'demo.sentiment': { kind: 'text-object', defaultModel: 'openai/gpt-4.1-nano' },
  'demo.haiku':     { kind: 'text',        defaultModel: 'openai/gpt-4.1-nano' },
  'demo.stream':    { kind: 'text-stream',  defaultModel: 'openai/gpt-4.1-mini' },
})
```

### Stream-to-SSE bridge (`src/app/api/stream/route.ts`)

The key pattern: converting llm-client's async generator into an HTTP streaming response.

```ts
const result = await ai.intent('demo.stream').streamObject({ schema, prompt })

const stream = new ReadableStream({
  async start(controller) {
    for await (const event of result.stream) {
      controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    }
    controller.close()
  },
})

return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream' },
})
```

### Client-side SSE consumer (`src/app/stream/page.tsx`)

The client reads the stream with `response.body.getReader()` and parses SSE frames to update React state:

- `output_delta` events append to the raw text display
- `complete` provides the Zod-validated object and token usage
- `error` surfaces failures

### RSC pattern (`src/app/rsc/page.tsx`)

No API route needed. Each `<Haiku>` is an async server component that awaits the LLM call directly. Wrap in `<Suspense>` with a skeleton fallback — React streams the HTML when each boundary resolves, so all three haikus load in parallel.
