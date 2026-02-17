import { useMemo } from 'react'
import { useCrawlerStore } from '../store/crawlerStore'
import { formatDistanceToNow } from 'date-fns'
import type { CrawlEvent, URLStatus, DiscardReason } from '../types'

const EVENT_COLORS: Record<string, string> = {
  url_queued:    'text-accent-blue',
  url_fetching:  'text-accent-yellow',
  url_fetched:   'text-accent-cyan',
  url_parsing:   'text-accent-purple',
  url_stored:    'text-accent-green',
  url_discarded: 'text-gray-500',
  url_error:     'text-accent-red',
  worker_online: 'text-accent-green',
  worker_offline:'text-accent-red',
  job_started:   'text-accent-green font-semibold',
  job_completed: 'text-accent-green font-semibold',
}

const DISCARD_LABELS: Record<DiscardReason, string> = {
  duplicate: 'DUP',
  robots_txt: 'ROBOTS',
  max_depth: 'DEPTH',
  max_pages: 'LIMIT',
  wrong_domain: 'DOMAIN',
  bad_content_type: 'CTYPE',
  http_error: 'HTTP',
  timeout: 'TIMEOUT',
  too_large: 'SIZE',
  invalid_url: 'INVALID',
  filter_rule: 'FILTER',
  parse_error: 'PARSE',
  connection_error: 'CONN',
}

interface Props {
  jobId?: string
  maxHeight?: string
}

export function EventFeed({ jobId, maxHeight = '100%' }: Props) {
  const allEvents = useCrawlerStore(s => s.events)
  const events = useMemo(
    () => jobId ? allEvents.filter(e => e.job_id === jobId) : allEvents,
    [allEvents, jobId]
  )

  return (
    <div className="flex flex-col h-full" style={{ maxHeight }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Events</h3>
        <span className="text-xs text-gray-600 font-mono">{events.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-0.5 font-mono text-[11px]">
        {events.slice(0, 200).map((e, i) => (
          <EventRow key={e.event_id ?? i} event={e} />
        ))}
      </div>
    </div>
  )
}

function EventRow({ event: e }: { event: CrawlEvent }) {
  const color = EVENT_COLORS[e.event_type] ?? 'text-gray-400'
  const time = new Date(e.timestamp)

  return (
    <div className="flex items-start gap-2 py-0.5 px-1 hover:bg-surface-hover rounded group">
      {/* Time */}
      <span className="text-gray-600 shrink-0 w-[50px]">
        {time.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>

      {/* Event type badge */}
      <span className={`shrink-0 ${color}`}>
        {formatEventType(e.event_type)}
      </span>

      {/* URL / detail */}
      <span className="text-gray-300 truncate flex-1" title={e.url}>
        {e.url ? shortUrl(e.url) : e.event_type.startsWith('worker') ? (e.worker_id ?? '') : ''}
      </span>

      {/* Extras */}
      <span className="shrink-0 text-gray-600">
        {e.discard_reason && (
          <span className="text-gray-500 bg-surface px-1 rounded text-[10px]">
            {DISCARD_LABELS[e.discard_reason] ?? e.discard_reason}
          </span>
        )}
        {e.status_code != null && e.status_code > 0 && (
          <span className={`px-1 rounded text-[10px] ${e.status_code < 400 ? 'text-accent-green' : 'text-accent-red'}`}>
            {e.status_code}
          </span>
        )}
        {e.depth != null && (
          <span className="text-gray-600 ml-1">d{e.depth}</span>
        )}
      </span>
    </div>
  )
}

function formatEventType(t: string): string {
  const map: Record<string, string> = {
    url_queued: '→ QUEUE',
    url_fetching: '⟳ FETCH',
    url_fetched: '✓ FETCH',
    url_parsing: '⟳ PARSE',
    url_stored: '✓ STORE',
    url_discarded: '✗ DISCARD',
    url_error: '✗ ERROR',
    worker_online: '↑ WORKER',
    worker_offline: '↓ WORKER',
    worker_heartbeat: '♥ HB',
    job_started: '▶ JOB',
    job_completed: '■ JOB',
    job_paused: '⏸ JOB',
  }
  return map[t] ?? t.toUpperCase().replace('_', ' ')
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname.length > 35 ? u.pathname.slice(0, 35) + '…' : u.pathname)
  } catch {
    return url.slice(0, 50)
  }
}
