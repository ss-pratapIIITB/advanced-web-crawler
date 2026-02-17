import { useCrawlerStore } from '../store/crawlerStore'
import { AreaChart, Area, Tooltip, ResponsiveContainer, XAxis } from 'recharts'
import { CheckCircle, XCircle, Clock, AlertTriangle, TrendingUp } from 'lucide-react'

interface Props { jobId: string }

export function MetricsBar({ jobId }: Props) {
  const m = useCrawlerStore(s => s.metrics[jobId])
  const job = useCrawlerStore(s => s.jobs[jobId])

  if (!m) return null

  const total = m.done + m.discarded + m.error
  const successRate = total > 0 ? Math.round((m.done / total) * 100) : 0
  const currentRate = m.history.length > 0 ? m.history[m.history.length - 1].rate.toFixed(1) : '0'

  const chartData = m.history.map(h => ({ t: h.t, rate: Math.max(0, h.rate) }))

  return (
    <div className="grid grid-cols-5 gap-3">
      <MetricCard
        icon={<CheckCircle size={16} className="text-accent-green" />}
        label="Crawled"
        value={m.done.toLocaleString()}
        sub={`${successRate}% success`}
        color="text-accent-green"
      />
      <MetricCard
        icon={<Clock size={16} className="text-accent-blue" />}
        label="In Queue"
        value={m.frontier_depth?.toLocaleString() ?? m.queued_total.toLocaleString()}
        sub="frontier depth"
        color="text-accent-blue"
      />
      <MetricCard
        icon={<XCircle size={16} className="text-gray-500" />}
        label="Discarded"
        value={m.discarded.toLocaleString()}
        sub="filtered out"
        color="text-gray-400"
      />
      <MetricCard
        icon={<AlertTriangle size={16} className="text-accent-red" />}
        label="Errors"
        value={m.error.toLocaleString()}
        sub="fetch/parse errors"
        color="text-accent-red"
      />
      <div className="bg-surface-card border border-surface-border rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp size={16} className="text-accent-purple" />
          <span className="text-xs text-gray-400">Rate</span>
          <span className="ml-auto text-sm font-semibold font-mono text-accent-purple">{currentRate}/s</span>
        </div>
        <ResponsiveContainer width="100%" height={36}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone" dataKey="rate"
              stroke="#a855f7" strokeWidth={1.5}
              fill="url(#rateGrad)" dot={false}
            />
            <Tooltip
              contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3a', fontSize: 10 }}
              formatter={(v: number) => [`${v.toFixed(1)}/s`, 'Rate']}
              labelFormatter={() => ''}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string
}) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  )
}
