import { useEffect, useState, useMemo } from 'react'
import { useCrawlerStore } from '../store/crawlerStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { CrawlerAPI } from '../hooks/useApi'
import { MetricsBar } from './MetricsBar'
import { CrawlGraph } from './CrawlGraph'
import { EventFeed } from './EventFeed'
import { URLTable } from './URLTable'
import { WorkerPanel } from './WorkerPanel'
import { URLDetail } from './URLDetail'
import { CreateJobModal } from './CreateJobModal'
import { Plus, Play, Pause, Square, RefreshCw, Spider } from 'lucide-react'
import type { CrawlJob } from '../types'

type View = 'graph' | 'table' | 'feed'

export function Dashboard() {
  const { activeJobId, setActiveJob, setJobs, updateJob, setWorkers } = useCrawlerStore()
  const jobs = useCrawlerStore(s => s.jobs)
  const [view, setView] = useState<View>('graph')
  const [showCreate, setShowCreate] = useState(false)
  const [polling, setPolling] = useState(false)

  useWebSocket() // Connect to global WS

  useEffect(() => {
    async function load() {
      try {
        const [jobsList, workers] = await Promise.all([
          CrawlerAPI.listJobs(),
          CrawlerAPI.getWorkers(),
        ])
        setJobs(jobsList)
        setWorkers(workers)
        if (jobsList.length > 0 && !activeJobId) {
          setActiveJob(jobsList[0].id)
        }
      } catch (e) {
        console.error('Failed to load jobs:', e)
      }
    }
    load()

    const interval = setInterval(async () => {
      try {
        const workers = await CrawlerAPI.getWorkers()
        setWorkers(workers)
      } catch {}
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const activeJob = activeJobId ? jobs[activeJobId] : null
  const jobList = useMemo(
    () => Object.values(jobs).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [jobs]
  )

  async function handleAction(action: 'pause' | 'stop') {
    if (!activeJobId) return
    try {
      if (action === 'pause') await CrawlerAPI.pauseJob(activeJobId)
      if (action === 'stop') await CrawlerAPI.stopJob(activeJobId)
      const job = await CrawlerAPI.getJob(activeJobId)
      updateJob(job)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-surface-card border-r border-surface-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-accent-blue/20 rounded-lg flex items-center justify-center">
              <span className="text-accent-blue text-sm">🕷</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white">WebCrawler</p>
              <p className="text-[10px] text-gray-500">Control Plane</p>
            </div>
          </div>
        </div>

        {/* New Job */}
        <div className="p-3 border-b border-surface-border">
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-2 bg-accent-blue/10 hover:bg-accent-blue/20 border border-accent-blue/30 text-accent-blue rounded-lg py-2 text-xs font-medium transition-colors"
          >
            <Plus size={13} />
            New Crawl Job
          </button>
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto py-2">
          {jobList.length === 0 && (
            <p className="text-xs text-gray-600 text-center px-4 py-6">
              No jobs yet. Create one to start crawling.
            </p>
          )}
          {jobList.map(job => (
            <JobListItem
              key={job.id}
              job={job}
              active={job.id === activeJobId}
              onClick={() => setActiveJob(job.id)}
            />
          ))}
        </div>

        {/* Workers */}
        <div className="p-3 border-t border-surface-border max-h-80 overflow-y-auto">
          <WorkerPanel />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 border-b border-surface-border flex items-center px-4 gap-3 shrink-0">
          {activeJob ? (
            <>
              <h1 className="text-sm font-semibold truncate max-w-xs">{activeJob.name}</h1>
              <JobStatusBadge status={activeJob.status} />
              <div className="flex items-center gap-1 ml-2">
                {activeJob.status === 'running' && (
                  <ActionBtn icon={<Pause size={12} />} label="Pause" onClick={() => handleAction('pause')} />
                )}
                {['running','paused'].includes(activeJob.status) && (
                  <ActionBtn icon={<Square size={12} />} label="Stop" onClick={() => handleAction('stop')} danger />
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">Select or create a crawl job</p>
          )}

          {/* View switcher */}
          <div className="ml-auto flex gap-1 bg-surface rounded-lg p-0.5">
            {(['graph', 'table', 'feed'] as View[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  view === v ? 'bg-surface-card text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </header>

        {/* Metrics */}
        {activeJobId && (
          <div className="px-4 py-3 border-b border-surface-border bg-surface shrink-0">
            <MetricsBar jobId={activeJobId} />
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-hidden relative">
          {!activeJobId ? (
            <EmptyState onNew={() => setShowCreate(true)} />
          ) : view === 'graph' ? (
            <div className="h-full p-2">
              <CrawlGraph jobId={activeJobId} />
            </div>
          ) : view === 'table' ? (
            <div className="h-full p-4 overflow-hidden flex flex-col">
              <URLTable jobId={activeJobId} />
            </div>
          ) : (
            <div className="h-full p-4 overflow-hidden flex flex-col">
              <EventFeed jobId={activeJobId} />
            </div>
          )}

          <URLDetail />
        </div>
      </main>

      {showCreate && (
        <CreateJobModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => setActiveJob(id)}
        />
      )}
    </div>
  )
}

function JobListItem({ job, active, onClick }: { job: CrawlJob; active: boolean; onClick: () => void }) {
  const STATUS_DOT: Record<string, string> = {
    running: 'bg-accent-green animate-pulse',
    paused: 'bg-accent-yellow',
    stopped: 'bg-gray-600',
    completed: 'bg-accent-blue',
    failed: 'bg-accent-red',
    created: 'bg-gray-500',
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-surface-hover transition-colors ${
        active ? 'bg-surface-hover border-r-2 border-accent-blue' : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${STATUS_DOT[job.status] ?? 'bg-gray-500'}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-200 truncate">{job.name}</p>
        <p className="text-[10px] text-gray-500 mt-0.5">
          {job.urls_fetched.toLocaleString()} pages
          {job.status === 'running' && ` · ${job.pages_per_second.toFixed(1)}/s`}
        </p>
      </div>
    </button>
  )
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'text-accent-green bg-accent-green/10 border-accent-green/30',
    paused: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
    stopped: 'text-gray-400 bg-gray-700/30 border-gray-600',
    completed: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
    failed: 'text-accent-red bg-accent-red/10 border-accent-red/30',
    created: 'text-gray-400 bg-gray-700/30 border-gray-600',
  }
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${map[status] ?? ''}`}>
      {status}
    </span>
  )
}

function ActionBtn({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
        danger
          ? 'border-accent-red/30 text-accent-red hover:bg-accent-red/10'
          : 'border-surface-border text-gray-400 hover:text-white hover:border-gray-500'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <div className="w-16 h-16 bg-surface-card rounded-full flex items-center justify-center mb-4 border border-surface-border">
        <span className="text-3xl">🕷</span>
      </div>
      <h2 className="text-lg font-semibold mb-2">No Active Crawl</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs">
        Create a new crawl job to start discovering pages. The graph will update in real time.
      </p>
      <button
        onClick={onNew}
        className="flex items-center gap-2 bg-accent-blue hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        <Plus size={14} />
        New Crawl Job
      </button>
    </div>
  )
}
