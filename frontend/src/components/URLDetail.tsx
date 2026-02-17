import { useCrawlerStore, STATUS_COLOR } from '../store/crawlerStore'
import { X, ExternalLink } from 'lucide-react'

export function URLDetail() {
  const selectedUrl = useCrawlerStore(s => s.selectedUrl)
  const setSelectedUrl = useCrawlerStore(s => s.setSelectedUrl)
  const urlEntries = useCrawlerStore(s => s.urlEntries)
  const discards = useCrawlerStore(s => s.discardedUrls)
  const events = useCrawlerStore(s => s.events)

  if (!selectedUrl) return null

  const entry = urlEntries.find(e => e.url === selectedUrl)
    ?? discards.find(e => e.url === selectedUrl)

  const relatedEvents = events
    .filter(e => e.url === selectedUrl || e.source_url === selectedUrl)
    .slice(0, 30)

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-surface-card border-l border-surface-border shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-border">
        <h3 className="text-sm font-semibold">URL Details</h3>
        <div className="flex items-center gap-2">
          <a href={selectedUrl} target="_blank" rel="noopener noreferrer"
             className="text-gray-400 hover:text-white">
            <ExternalLink size={14} />
          </a>
          <button onClick={() => setSelectedUrl(null)} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* URL */}
        <div>
          <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">URL</p>
          <p className="font-mono text-xs text-gray-200 break-all">{selectedUrl}</p>
        </div>

        {entry && (
          <>
            {/* Status */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <span className="font-mono text-xs font-semibold"
                  style={{ color: STATUS_COLOR[entry.status] }}>
                  {entry.status.toUpperCase()}
                </span>
              </Field>
              <Field label="Depth">
                <span className="font-mono text-xs">{entry.depth}</span>
              </Field>
              {entry.status_code != null && (
                <Field label="HTTP Status">
                  <span className={`font-mono text-xs ${entry.status_code < 400 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {entry.status_code}
                  </span>
                </Field>
              )}
              {entry.fetch_duration_ms != null && (
                <Field label="Fetch Time">
                  <span className="font-mono text-xs">{Math.round(entry.fetch_duration_ms)}ms</span>
                </Field>
              )}
              {entry.content_type && (
                <Field label="Content-Type">
                  <span className="font-mono text-xs text-gray-400">{entry.content_type.split(';')[0]}</span>
                </Field>
              )}
              {entry.links_found != null && (
                <Field label="Links Found">
                  <span className="font-mono text-xs">{entry.links_found}</span>
                </Field>
              )}
            </div>

            {entry.discard_reason && (
              <div className="bg-red-900/20 border border-red-900/40 rounded p-3">
                <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Discard Reason</p>
                <p className="text-sm font-semibold text-red-300">{entry.discard_reason.replace('_', ' ')}</p>
                {entry.discard_detail && (
                  <p className="text-xs text-red-400/80 mt-1">{entry.discard_detail}</p>
                )}
              </div>
            )}

            {entry.parent_url && (
              <div>
                <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Discovered from</p>
                <p className="font-mono text-xs text-accent-blue break-all">{entry.parent_url}</p>
              </div>
            )}
          </>
        )}

        {/* Pipeline timeline */}
        {relatedEvents.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider">Processing Pipeline</p>
            <div className="space-y-1">
              {relatedEvents.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-gray-600 font-mono shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString('en', { hour12: false })}
                  </span>
                  <span className="text-gray-400">{e.event_type.replace(/_/g, ' ')}</span>
                  {e.worker_id && (
                    <span className="text-gray-600 text-[10px] ml-auto shrink-0">@{e.worker_id.split('-')[0]}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      {children}
    </div>
  )
}
