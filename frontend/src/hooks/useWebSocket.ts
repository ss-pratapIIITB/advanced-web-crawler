import { useEffect, useRef } from 'react'
import { useCrawlerStore } from '../store/crawlerStore'
import type { CrawlEvent } from '../types'

const RECONNECT_DELAY = 2000
const MAX_RECONNECT = 10

export function useWebSocket(jobId?: string) {
  const ingestEvent = useCrawlerStore(s => s.ingestEvent)
  const setConnected = useCrawlerStore(s => s.setWsConnected)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCount = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    let destroyed = false

    function connect() {
      if (destroyed) return
      const wsUrl = jobId
        ? `ws://${window.location.hostname}:8000/ws/${jobId}`
        : `ws://${window.location.hostname}:8000/ws`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectCount.current = 0
        setConnected(true)
      }

      ws.onmessage = (e) => {
        try {
          const event: CrawlEvent = JSON.parse(e.data)
          ingestEvent(event)
        } catch { /* ignore */ }
      }

      ws.onclose = () => {
        setConnected(false)
        if (!destroyed && reconnectCount.current < MAX_RECONNECT) {
          reconnectCount.current++
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
        }
      }

      ws.onerror = () => ws.close()
    }

    connect()

    // Keep-alive ping every 25s
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 25_000)

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer.current)
      clearInterval(pingInterval)
      wsRef.current?.close()
    }
  }, [jobId])
}
