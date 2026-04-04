import type { Stream } from '@libp2p/interface'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'

const DELIMITER = '\n'

export class StreamReader<T> implements AsyncIterable<T> {
  constructor(private readonly stream: Stream) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    let buffer = ''

    for await (const chunk of this.stream) {
      // Ensure we have a Uint8Array for toString()
      const data = chunk instanceof Uint8Array ? chunk : chunk.subarray()
      buffer += toString(data)

      const lines = buffer.split(DELIMITER)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          yield JSON.parse(trimmed) as T
        } catch (err) {
          console.warn('StreamReader: Failed to parse line:', line, err)
        }
      }
    }

    const finalTrimmed = buffer.trim()
    if (finalTrimmed) {
      try {
        yield JSON.parse(finalTrimmed) as T
      } catch (err) {
        console.warn('StreamReader: Failed to parse final buffer:', buffer, err)
      }
    }
  }
}

export class StreamWriter<T> {
  private closed = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly stream: Stream) {}

  async write(message: T): Promise<void> {
    if (this.closed) {
      throw new Error('StreamWriter is closed')
    }

    const payload = JSON.stringify(message) + DELIMITER
    const chunk = fromString(payload)

    // Chain writes to ensure sequentiality and proper backpressure handling
    this.writeChain = this.writeChain.then(async () => {
      if (this.closed) return

      try {
        if (!this.stream.send(chunk)) {
          // If buffer is full, wait for it to empty
          await this.stream.onDrain()
        }
      } catch (err) {
        console.error('StreamWriter: Write failed:', err)
        throw err
      }
    })

    await this.writeChain
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    try {
      // Ensure all pending messages are at least queued in the muxer
      await this.writeChain
      
      // If the muxer queue is still sending, wait for it to finish (ideal for graceful close)
      if ((this.stream.writeBufferLength ?? 0) > 0) {
        await waitForStreamEvent(this.stream, 'idle')
      }
      
      await this.stream.close()
    } catch (err) {
      // Ignore non-critical transport close errors during shutdown
      console.warn('StreamWriter: Resource close info:', err)
    }
  }
}

async function waitForStreamEvent(stream: Stream, eventName: 'drain' | 'idle'): Promise<void> {
  // If the stream status suggests it's already dead, don't wait
  if (stream.status === 'closed' || stream.status === 'aborted') {
    return
  }

  return new Promise((resolve) => {
    const target = stream as unknown as EventTarget

    const handler = () => {
      target.removeEventListener(eventName, handler as EventListener)
      resolve()
    }

    target.addEventListener(eventName, handler as EventListener, { once: true })

    // Safety timeout to prevent permanent stalls on failed connections
    setTimeout(() => {
      target.removeEventListener(eventName, handler as EventListener)
      resolve()
    }, 5000)
  })
}

