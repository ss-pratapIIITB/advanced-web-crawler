export type EventType =
  | 'url_discovered' | 'url_queued' | 'url_dequeued'
  | 'url_fetching' | 'url_fetched' | 'url_parsing'
  | 'url_parsed' | 'url_stored' | 'url_discarded' | 'url_error'
  | 'worker_online' | 'worker_offline' | 'worker_idle' | 'worker_busy' | 'worker_heartbeat'
  | 'job_created' | 'job_started' | 'job_paused' | 'job_resumed' | 'job_completed' | 'job_failed'
  | 'metrics_update'

export type URLStatus = 'queued' | 'fetching' | 'fetched' | 'parsing' | 'done' | 'discarded' | 'error'

export type DiscardReason =
  | 'duplicate' | 'robots_txt' | 'max_depth' | 'max_pages'
  | 'wrong_domain' | 'bad_content_type' | 'http_error'
  | 'timeout' | 'too_large' | 'invalid_url' | 'filter_rule'
  | 'parse_error' | 'connection_error'

export interface WorkerState {
  worker_id: string
  hostname: string
  pid: number
  current_url?: string
  current_job_id?: string
  status: 'idle' | 'busy' | 'offline'
  urls_processed: number
  errors: number
  bytes_downloaded: number
  started_at: string
  last_heartbeat: string
}

export interface CrawlEvent {
  event_id: string
  event_type: EventType
  job_id: string
  timestamp: string
  worker_id?: string
  url?: string
  parent_url?: string
  depth?: number
  status_code?: number
  content_type?: string
  content_length?: number
  links_found?: number
  fetch_duration_ms?: number
  status?: URLStatus
  discard_reason?: DiscardReason
  discard_detail?: string
  worker_state?: WorkerState
  metrics?: Record<string, number>
  source_url?: string
  target_url?: string
  domain?: string
  queue_shard?: number
}

export interface CrawlJob {
  id: string
  name: string
  status: 'created' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed'
  seed_urls: string[]
  max_depth: number
  max_pages: number
  urls_queued: number
  urls_fetched: number
  urls_discarded: number
  urls_error: number
  bytes_downloaded: number
  pages_per_second: number
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface GraphNode {
  id: string
  label: string
  depth: number
  status: URLStatus
  status_code?: number
  title?: string
  x?: number
  y?: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface URLEntry {
  url: string
  parent_url?: string
  depth: number
  status: URLStatus
  status_code?: number
  content_type?: string
  links_found?: number
  fetch_duration_ms?: number
  fetched_at?: string
  discard_reason?: DiscardReason
  discard_detail?: string
  worker_id?: string
  timestamp: string
}

export interface Metrics {
  queued_total: number
  done: number
  discarded: number
  error: number
  frontier_depth: number
}

export interface DomainStats {
  domain: string
  queued: number
  done: number
  avg_fetch_ms: number
  active_worker: string | null
  queue_shard: number
  queue_name: string
}

export interface QueueStats {
  [queueName: string]: number   // queue name → pending task count
}

export interface CreateJobPayload {
  name: string
  seed_urls: string[]
  max_depth: number
  max_pages: number
  allowed_domains?: string[]
  url_pattern?: string
  politeness_delay: number
  respect_robots: boolean
  use_playwright: boolean
}
