/**
 * DomainPanel — live table of crawled domains showing:
 *   domain | queue shard | pages done | queued | avg fetch ms | active worker
 *
 * Each domain hashes to a shard (crawl.N) so different domains process
 * in parallel across workers, eliminating slow-domain I/O head-of-line blocking.
 */
import { useMemo } from 'react'
import { useCrawlerStore } from '../store/crawlerStore'

const SHARD_COLORS = [
  '#3b82f6', '#22c55e', '#eab308', '#ef4444',
  '#a855f7', '#06b6d4', '#f97316', '#ec4899',
  '#14b8a6', '#84cc16', '#6366f1', '#f43f5e',
  '#0ea5e9', '#d946ef', '#10b981', '#fb923c',
]

function shardColor(shard: number) {
  return SHARD_COLORS[shard % SHARD_COLORS.length]
}

function fmtMs(ms: number) {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface Props { jobId: string }

export function DomainPanel({ jobId }: Props) {
  const domainsMap = useCrawlerStore(s => s.domains[jobId])
  const domains = useMemo(
    () => Object.values(domainsMap ?? {}).sort((a, b) => b.done - a.done),
    [domainsMap]
  )

  if (!domains.length) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        No domain activity yet — start a crawl to see parallel queue routing
      </div>
    )
  }

  const activeDomains = domains.filter(d => d.active_worker).length
  const totalDone = domains.reduce((s, d) => s + d.done, 0)
  const totalQueued = domains.reduce((s, d) => s + d.queued, 0)
  const shardsUsed = new Set(domains.map(d => d.queue_shard)).size

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3 mb-3 shrink-0">
        <SummaryCard label="Domains seen" value={domains.length.toString()} color="text-white" />
        <SummaryCard label="Active now" value={activeDomains.toString()} color="text-accent-yellow" pulse={activeDomains > 0} />
        <SummaryCard label="Queue shards used" value={`${shardsUsed} / 16`} color="text-accent-blue" />
        <SummaryCard label="Pages crawled" value={totalDone.toLocaleString()} color="text-accent-green" />
      </div>

      {/* Shard usage heatmap */}
      <div className="mb-3 shrink-0">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Queue Shard Activity (crawl.0 … crawl.15)</p>
        <div className="grid grid-cols-16 gap-0.5" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
          {Array.from({ length: 16 }, (_, i) => {
            const shardDomains = domains.filter(d => d.queue_shard === i)
            const hasActive = shardDomains.some(d => d.active_worker)
            const count = shardDomains.length
            return (
              <div
                key={i}
                title={`crawl.${i} — ${count} domain(s)${hasActive ? ' (active)' : ''}`}
                className={`h-5 rounded-sm flex items-center justify-center text-[9px] font-mono transition-all ${
                  hasActive ? 'animate-pulse' : ''
                }`}
                style={{
                  background: count > 0 ? shardColor(i) + (hasActive ? 'ff' : '55') : '#2a2d3a',
                  color: count > 0 ? '#fff' : '#4b5563',
                }}
              >
                {count > 0 ? count : i}
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5 px-0.5">
          <span>crawl.0</span>
          <span>crawl.15</span>
        </div>
      </div>

      {/* Domain table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="text-gray-500 text-left border-b border-surface-border">
              <th className="pb-1 pr-3 font-medium">Domain</th>
              <th className="pb-1 pr-3 font-medium w-20">Queue</th>
              <th className="pb-1 pr-3 font-medium w-16 text-right">Done</th>
              <th className="pb-1 pr-3 font-medium w-16 text-right">Queued</th>
              <th className="pb-1 pr-3 font-medium w-20 text-right">Avg Fetch</th>
              <th className="pb-1 font-medium w-24">Worker</th>
            </tr>
          </thead>
          <tbody>
            {domains.map(d => (
              <DomainRow key={d.domain} domain={d} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DomainRow({ domain: d }: { domain: ReturnType<typeof useCrawlerStore>['domains'][string][string] }) {
  const isActive = !!d.active_worker
  const color = shardColor(d.queue_shard)

  return (
    <tr className={`border-b border-surface-border/40 transition-colors ${
      isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover/50'
    }`}>
      {/* Domain name */}
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'animate-pulse' : ''}`}
            style={{ background: isActive ? color : '#4b5563' }}
          />
          <span className="font-mono text-gray-200 truncate max-w-[180px]" title={d.domain}>
            {d.domain}
          </span>
        </div>
      </td>

      {/* Queue shard badge */}
      <td className="py-1.5 pr-3">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold"
          style={{ background: color + '22', color }}
        >
          crawl.{d.queue_shard}
        </span>
      </td>

      {/* Done */}
      <td className="py-1.5 pr-3 text-right font-mono text-accent-green">
        {d.done.toLocaleString()}
      </td>

      {/* Queued */}
      <td className="py-1.5 pr-3 text-right font-mono text-accent-blue">
        {d.queued.toLocaleString()}
      </td>

      {/* Avg fetch */}
      <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
        {fmtMs(d.avg_fetch_ms)}
      </td>

      {/* Active worker */}
      <td className="py-1.5">
        {d.active_worker ? (
          <span className="text-[10px] font-mono text-accent-yellow truncate block max-w-[90px]"
                title={d.active_worker}>
            ⟳ {d.active_worker.split('-')[0]}
          </span>
        ) : (
          <span className="text-[10px] text-gray-600">—</span>
        )}
      </td>
    </tr>
  )
}

function SummaryCard({ label, value, color, pulse = false }: {
  label: string; value: string; color: string; pulse?: boolean
}) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg px-3 py-2">
      <p className={`text-base font-bold font-mono ${color} ${pulse ? 'animate-pulse' : ''}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
