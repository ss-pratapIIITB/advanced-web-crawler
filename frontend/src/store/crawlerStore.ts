import { create } from 'zustand'
import type {
  CrawlJob, CrawlEvent, WorkerState, URLEntry,
  GraphNode, GraphEdge, Metrics, URLStatus, DomainStats
} from '../types'

const MAX_EVENTS = 2000
const MAX_URL_ENTRIES = 5000
const MAX_GRAPH_NODES = 1000

interface MetricsState extends Metrics {
  history: { t: number; done: number; rate: number }[]
}

interface CrawlerState {
  jobs: Record<string, CrawlJob>
  activeJobId: string | null
  events: CrawlEvent[]
  urlEntries: URLEntry[]
  discardedUrls: URLEntry[]
  graphNodes: Record<string, GraphNode>
  graphEdges: GraphEdge[]
  workers: Record<string, WorkerState>
  metrics: Record<string, MetricsState>
  // domain → live stats (keyed by job_id → domain → stats)
  domains: Record<string, Record<string, DomainStats>>
  wsConnected: boolean
  selectedUrl: string | null

  setActiveJob: (id: string | null) => void
  setJobs: (jobs: CrawlJob[]) => void
  updateJob: (job: CrawlJob) => void
  ingestEvent: (event: CrawlEvent) => void
  setWorkers: (workers: WorkerState[]) => void
  setDomains: (jobId: string, domains: DomainStats[]) => void
  setWsConnected: (v: boolean) => void
  setSelectedUrl: (url: string | null) => void
}

const STATUS_ORDER: URLStatus[] = ['queued', 'fetching', 'fetched', 'parsing', 'done', 'discarded', 'error']

export const useCrawlerStore = create<CrawlerState>((set, get) => ({
  jobs: {},
  activeJobId: null,
  events: [],
  urlEntries: [],
  discardedUrls: [],
  graphNodes: {},
  graphEdges: [],
  workers: {},
  metrics: {},
  domains: {},
  wsConnected: false,
  selectedUrl: null,

  setActiveJob: (id) => set({ activeJobId: id }),

  setJobs: (jobs) => {
    const map: Record<string, CrawlJob> = {}
    jobs.forEach(j => { map[j.id] = j })
    set({ jobs: map })
  },

  updateJob: (job) => set(s => ({ jobs: { ...s.jobs, [job.id]: job } })),

  setWorkers: (workers) => {
    const map: Record<string, WorkerState> = {}
    workers.forEach(w => {
      map[w.worker_id] = {
        ...w,
        urls_processed: w.urls_processed ?? 0,
        errors: w.errors ?? 0,
        bytes_downloaded: w.bytes_downloaded ?? 0,
      }
    })
    set({ workers: map })
  },

  setWsConnected: (v) => set({ wsConnected: v }),
  setSelectedUrl: (url) => set({ selectedUrl: url }),

  setDomains: (jobId, domainList) => set(s => {
    const map: Record<string, DomainStats> = {}
    domainList.forEach(d => { map[d.domain] = d })
    return { domains: { ...s.domains, [jobId]: map } }
  }),

  ingestEvent: (event) => {
    const s = get()

    // --- Event feed ---
    const newEvents = [event, ...s.events].slice(0, MAX_EVENTS)

    // --- Worker state ---
    let newWorkers = s.workers
    if (event.worker_state && event.worker_id) {
      const ws = event.worker_state as WorkerState
      newWorkers = {
        ...s.workers,
        [event.worker_id]: {
          ...ws,
          urls_processed: ws.urls_processed ?? 0,
          errors: ws.errors ?? 0,
          bytes_downloaded: ws.bytes_downloaded ?? 0,
        },
      }
    }

    // --- URL entry tracking ---
    let newEntries = s.urlEntries
    let newDiscards = s.discardedUrls
    let newNodes = s.graphNodes
    let newEdges = s.graphEdges

    if (event.url) {
      const entry: URLEntry = {
        url: event.url,
        parent_url: event.parent_url,
        depth: event.depth ?? 0,
        status: event.status ?? 'queued',
        status_code: event.status_code,
        content_type: event.content_type,
        links_found: event.links_found,
        fetch_duration_ms: event.fetch_duration_ms,
        discard_reason: event.discard_reason,
        discard_detail: event.discard_detail,
        worker_id: event.worker_id,
        timestamp: event.timestamp,
      }

      if (event.event_type === 'url_discarded') {
        newDiscards = [entry, ...s.discardedUrls].slice(0, MAX_URL_ENTRIES)
      }

      const idx = s.urlEntries.findIndex(e => e.url === event.url)
      if (idx >= 0) {
        const existing = s.urlEntries[idx]
        const newRank = STATUS_ORDER.indexOf(entry.status)
        const oldRank = STATUS_ORDER.indexOf(existing.status)
        if (newRank >= oldRank) {
          newEntries = [...s.urlEntries]
          newEntries[idx] = { ...existing, ...entry }
        }
      } else {
        newEntries = [entry, ...s.urlEntries].slice(0, MAX_URL_ENTRIES)
      }

      // Graph nodes
      if (Object.keys(s.graphNodes).length < MAX_GRAPH_NODES) {
        const existing = s.graphNodes[event.url]
        if (!existing) {
          newNodes = {
            ...s.graphNodes,
            [event.url]: {
              id: event.url,
              label: shortUrl(event.url),
              depth: event.depth ?? 0,
              status: entry.status,
              status_code: event.status_code,
            }
          }
        } else if (existing.status !== entry.status) {
          newNodes = {
            ...s.graphNodes,
            [event.url]: { ...existing, status: entry.status, status_code: event.status_code ?? existing.status_code }
          }
        }
      }

      // Graph edges
      if (event.source_url && event.target_url && event.event_type === 'url_queued') {
        const exists = s.graphEdges.some(e => e.source === event.source_url && e.target === event.target_url)
        if (!exists && s.graphEdges.length < MAX_GRAPH_NODES * 2) {
          newEdges = [...s.graphEdges, { source: event.source_url, target: event.target_url }]
        }
      }
    }

    // --- Metrics ---
    let newMetrics = s.metrics
    if (event.job_id && event.job_id !== '__system__') {
      const prev: MetricsState = s.metrics[event.job_id] ?? {
        queued_total: 0, done: 0, discarded: 0, error: 0, frontier_depth: 0, history: []
      }
      const updated = { ...prev }

      if (event.event_type === 'url_queued') updated.queued_total = prev.queued_total + 1
      if (event.event_type === 'url_stored') {
        updated.done = prev.done + 1
        const now = Date.now()
        const last = prev.history[prev.history.length - 1]
        const rate = last && (now - last.t) > 0 ? (updated.done - last.done) / ((now - last.t) / 1000) : 0
        const newHistory = [...prev.history, { t: now, done: updated.done, rate }]
        updated.history = newHistory.slice(-120)
      }
      if (event.event_type === 'url_discarded') updated.discarded = prev.discarded + 1
      if (event.event_type === 'url_error') updated.error = prev.error + 1
      if (event.metrics) Object.assign(updated, event.metrics)

      newMetrics = { ...s.metrics, [event.job_id]: updated }
    }

    // --- Domain stats (live updates from events) ---
    let newDomains = s.domains
    if (event.domain && event.job_id && event.job_id !== '__system__') {
      const jobDomains = { ...(s.domains[event.job_id] ?? {}) }
      const prev = jobDomains[event.domain] ?? {
        domain: event.domain,
        queued: 0, done: 0,
        avg_fetch_ms: 0,
        active_worker: null,
        queue_shard: event.queue_shard ?? 0,
        queue_name: `crawl.${event.queue_shard ?? 0}`,
      }
      const updated = { ...prev }

      if (event.event_type === 'url_queued') updated.queued = prev.queued + 1
      if (event.event_type === 'url_stored') {
        updated.done = prev.done + 1
        if (event.fetch_duration_ms) {
          // Running average
          const total = prev.avg_fetch_ms * (prev.done || 1) + event.fetch_duration_ms
          updated.avg_fetch_ms = Math.round(total / (updated.done))
        }
      }
      if (event.event_type === 'url_fetching') {
        updated.active_worker = event.worker_id ?? null
      }
      if (event.event_type === 'url_stored' || event.event_type === 'url_discarded') {
        updated.active_worker = null
      }

      jobDomains[event.domain] = updated
      newDomains = { ...s.domains, [event.job_id]: jobDomains }
    }

    // --- Job status ---
    let newJobs = s.jobs
    if (event.event_type === 'job_started' && s.jobs[event.job_id]) {
      newJobs = { ...s.jobs, [event.job_id]: { ...s.jobs[event.job_id], status: 'running' } }
    }
    if (event.event_type === 'job_completed' && s.jobs[event.job_id]) {
      newJobs = { ...s.jobs, [event.job_id]: { ...s.jobs[event.job_id], status: 'completed' } }
    }

    set({
      events: newEvents,
      workers: newWorkers,
      urlEntries: newEntries,
      discardedUrls: newDiscards,
      graphNodes: newNodes,
      graphEdges: newEdges,
      metrics: newMetrics,
      domains: newDomains,
      jobs: newJobs,
    })
  },
}))

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname)
  } catch {
    return url.slice(0, 40)
  }
}

export const STATUS_COLOR: Record<URLStatus, string> = {
  queued:    '#3b82f6',
  fetching:  '#eab308',
  fetched:   '#06b6d4',
  parsing:   '#a855f7',
  done:      '#22c55e',
  discarded: '#6b7280',
  error:     '#ef4444',
}
