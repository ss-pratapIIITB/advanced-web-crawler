import { useMemo } from 'react'
import { useCrawlerStore } from '../store/crawlerStore'
import { formatDistanceToNow } from 'date-fns'
import { Cpu, Wifi, WifiOff } from 'lucide-react'

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function WorkerPanel() {
  const workersMap = useCrawlerStore(s => s.workers)
  const workers = useMemo(() => Object.values(workersMap), [workersMap])
  const wsConnected = useCrawlerStore(s => s.wsConnected)

  return (
    <div className="flex flex-col gap-3 h-full overflow-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Workers <span className="text-accent-blue ml-1">({workers.length})</span>
        </h2>
        <span className={`flex items-center gap-1 text-xs ${wsConnected ? 'text-accent-green' : 'text-accent-red'}`}>
          {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {wsConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      {workers.length === 0 && (
        <div className="text-gray-500 text-xs text-center py-6 border border-dashed border-surface-border rounded-lg">
          No workers online. Start a worker process.
        </div>
      )}

      {workers.map(w => (
        <WorkerCard key={w.worker_id} worker={w} />
      ))}
    </div>
  )
}

function WorkerCard({ worker }: { worker: ReturnType<typeof useCrawlerStore>['workers'][string] }) {
  const isBusy = worker.status === 'busy'
  const isOffline = worker.status === 'offline'

  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isOffline
        ? 'border-surface-border bg-surface-card opacity-50'
        : isBusy
          ? 'border-accent-yellow/40 bg-surface-card'
          : 'border-accent-green/30 bg-surface-card'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu size={14} className={isBusy ? 'text-accent-yellow' : 'text-accent-green'} />
          <span className="text-xs font-mono text-gray-300 truncate max-w-[140px]" title={worker.worker_id}>
            {worker.hostname}:{worker.pid}
          </span>
        </div>
        <StatusDot status={worker.status as 'idle' | 'busy' | 'offline'} />
      </div>

      {/* Current URL */}
      {isBusy && worker.current_url && (
        <div className="mb-2 bg-surface rounded px-2 py-1">
          <p className="text-[10px] text-gray-500 mb-0.5">Processing</p>
          <p className="text-xs font-mono text-accent-yellow truncate" title={worker.current_url}>
            {worker.current_url}
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-1 mt-1">
        <Stat label="Done" value={(worker.urls_processed ?? 0).toLocaleString()} />
        <Stat label="Errors" value={(worker.errors ?? 0).toString()} color="text-accent-red" />
        <Stat label="Downloaded" value={fmt(worker.bytes_downloaded ?? 0)} />
      </div>

      {/* Heartbeat */}
      {worker.last_heartbeat && (
        <p className="text-[10px] text-gray-600 mt-1.5">
          ♥ {formatDistanceToNow(new Date(worker.last_heartbeat), { addSuffix: true })}
        </p>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: 'idle' | 'busy' | 'offline' }) {
  const map = {
    idle: 'bg-accent-green',
    busy: 'bg-accent-yellow animate-pulse',
    offline: 'bg-gray-600',
  }
  return <span className={`w-2 h-2 rounded-full ${map[status]}`} />
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className={`text-xs font-semibold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  )
}
