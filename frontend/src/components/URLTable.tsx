import { useState, useMemo } from 'react'
import { useCrawlerStore, STATUS_COLOR } from '../store/crawlerStore'
import type { URLStatus, DiscardReason } from '../types'

const DISCARD_BADGE: Record<DiscardReason, string> = {
  duplicate: 'bg-gray-700 text-gray-300',
  robots_txt: 'bg-orange-900/50 text-orange-300',
  max_depth: 'bg-blue-900/50 text-blue-300',
  max_pages: 'bg-purple-900/50 text-purple-300',
  wrong_domain: 'bg-yellow-900/50 text-yellow-300',
  bad_content_type: 'bg-pink-900/50 text-pink-300',
  http_error: 'bg-red-900/50 text-red-300',
  timeout: 'bg-red-900/50 text-red-300',
  too_large: 'bg-orange-900/50 text-orange-300',
  invalid_url: 'bg-gray-700 text-gray-300',
  filter_rule: 'bg-indigo-900/50 text-indigo-300',
  parse_error: 'bg-red-900/50 text-red-300',
  connection_error: 'bg-red-900/50 text-red-300',
}

type Tab = 'all' | 'done' | 'fetching' | 'discarded' | 'error'

interface Props { jobId: string }

export function URLTable({ jobId }: Props) {
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const urlEntries = useCrawlerStore(s => s.urlEntries)
  const discardedUrls = useCrawlerStore(s => s.discardedUrls)
  const setSelectedUrl = useCrawlerStore(s => s.setSelectedUrl)

  const filtered = useMemo(() => {
    const source = tab === 'discarded' ? discardedUrls : urlEntries
    return source
      .filter(e => {
        if (tab !== 'all' && tab !== 'discarded' && e.status !== tab) return false
        if (search && !e.url.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
      .slice(0, 300)
  }, [urlEntries, discardedUrls, tab, search])

  const counts = useMemo(() => ({
    all: urlEntries.length,
    done: urlEntries.filter(e => e.status === 'done').length,
    fetching: urlEntries.filter(e => e.status === 'fetching' || e.status === 'parsing').length,
    discarded: discardedUrls.length,
    error: urlEntries.filter(e => e.status === 'error').length,
  }), [urlEntries, discardedUrls])

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        {(['all', 'done', 'fetching', 'discarded', 'error'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
              tab === t
                ? 'bg-accent-blue text-white'
                : 'text-gray-400 hover:text-white hover:bg-surface-hover'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="ml-1 text-[10px] opacity-70">({counts[t]})</span>
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter URLs…"
          className="ml-auto text-xs bg-surface border border-surface-border rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-accent-blue w-48"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-gray-500 text-left border-b border-surface-border">
              <th className="pb-1 pr-2 font-medium w-6">D</th>
              <th className="pb-1 pr-2 font-medium">URL</th>
              <th className="pb-1 pr-2 font-medium w-14">Status</th>
              <th className="pb-1 pr-2 font-medium w-12">Code</th>
              <th className="pb-1 pr-2 font-medium w-14">Links</th>
              <th className="pb-1 pr-2 font-medium w-16">Time</th>
              <th className="pb-1 font-medium w-24">Discard</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <tr
                key={entry.url + i}
                className="border-b border-surface-border/40 hover:bg-surface-hover cursor-pointer transition-colors"
                onClick={() => setSelectedUrl(entry.url)}
              >
                <td className="py-1 pr-2 font-mono text-gray-500">{entry.depth}</td>
                <td className="py-1 pr-2 font-mono max-w-0 w-full">
                  <span className="block truncate text-gray-200" title={entry.url}>
                    {entry.url}
                  </span>
                  {entry.parent_url && (
                    <span className="block truncate text-gray-600 text-[10px]" title={entry.parent_url}>
                      ← {entry.parent_url}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <span
                    className="px-1 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: STATUS_COLOR[entry.status] + '22', color: STATUS_COLOR[entry.status] }}
                  >
                    {entry.status}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono">
                  {entry.status_code != null && (
                    <span className={entry.status_code < 400 ? 'text-accent-green' : 'text-accent-red'}>
                      {entry.status_code}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2 font-mono text-gray-400">
                  {entry.links_found ?? '—'}
                </td>
                <td className="py-1 pr-2 font-mono text-gray-500">
                  {entry.fetch_duration_ms != null
                    ? `${Math.round(entry.fetch_duration_ms)}ms`
                    : '—'}
                </td>
                <td className="py-1">
                  {entry.discard_reason && (
                    <span className={`px-1 py-0.5 rounded text-[10px] ${DISCARD_BADGE[entry.discard_reason] ?? 'bg-gray-700 text-gray-300'}`}>
                      {entry.discard_reason.replace('_', ' ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-gray-600 text-xs py-8">No URLs match current filter</p>
        )}
      </div>
    </div>
  )
}
