import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { CrawlerAPI } from '../hooks/useApi'
import { useCrawlerStore } from '../store/crawlerStore'
import type { CreateJobPayload } from '../types'

interface Props {
  onClose: () => void
  onCreated: (jobId: string) => void
}

const DEFAULTS: CreateJobPayload = {
  name: 'New Crawl',
  seed_urls: ['https://example.com'],
  max_depth: 3,
  max_pages: 1000,
  politeness_delay: 1.0,
  respect_robots: true,
  use_playwright: false,
}

export function CreateJobModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState<CreateJobPayload>(DEFAULTS)
  const [urlInput, setUrlInput] = useState(DEFAULTS.seed_urls[0])
  const [domainInput, setDomainInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const updateJob = useCrawlerStore(s => s.updateJob)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.seed_urls.length) {
      setError('Add at least one seed URL')
      return
    }
    setLoading(true)
    setError('')
    try {
      const job = await CrawlerAPI.createJob(form)
      updateJob(job)
      const startResult = await CrawlerAPI.startJob(job.id)
      onCreated(job.id)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message ?? 'Failed to create job')
    } finally {
      setLoading(false)
    }
  }

  function addSeed() {
    try { new URL(urlInput) } catch { setError('Invalid URL'); return }
    setForm(f => ({ ...f, seed_urls: [...f.seed_urls, urlInput] }))
    setUrlInput('')
    setError('')
  }

  function removeSeed(i: number) {
    setForm(f => ({ ...f, seed_urls: f.seed_urls.filter((_, j) => j !== i) }))
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-surface-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <h2 className="text-base font-semibold">New Crawl Job</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Job Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-surface border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-blue"
              required
            />
          </div>

          {/* Seed URLs */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Seed URLs</label>
            <div className="flex gap-2 mb-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSeed())}
                placeholder="https://…"
                className="flex-1 bg-surface border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-blue font-mono"
              />
              <button type="button" onClick={addSeed}
                className="bg-accent-blue/20 text-accent-blue border border-accent-blue/30 rounded px-3 hover:bg-accent-blue/30 transition-colors">
                <Plus size={14} />
              </button>
            </div>
            {form.seed_urls.map((u, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface rounded px-2 py-1 mb-1">
                <span className="flex-1 text-xs font-mono text-gray-300 truncate">{u}</span>
                <button type="button" onClick={() => removeSeed(i)} className="text-gray-600 hover:text-accent-red">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Config grid */}
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Max Depth" value={form.max_depth} min={1} max={20}
              onChange={v => setForm(f => ({ ...f, max_depth: v }))} />
            <NumberField label="Max Pages" value={form.max_pages} min={1} max={1_000_000}
              onChange={v => setForm(f => ({ ...f, max_pages: v }))} />
            <NumberField label="Politeness (s)" value={form.politeness_delay} min={0} max={60} step={0.1}
              onChange={v => setForm(f => ({ ...f, politeness_delay: v }))} />
          </div>

          {/* Toggles */}
          <div className="flex gap-4">
            <Toggle label="Respect robots.txt" value={form.respect_robots}
              onChange={v => setForm(f => ({ ...f, respect_robots: v }))} />
            <Toggle label="JS rendering (Playwright)" value={form.use_playwright}
              onChange={v => setForm(f => ({ ...f, use_playwright: v }))} />
          </div>

          {/* Allowed domains */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Allowed Domains <span className="text-gray-600">(leave empty for all)</span>
            </label>
            <div className="flex gap-2">
              <input
                value={domainInput}
                onChange={e => setDomainInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (domainInput) {
                      setForm(f => ({ ...f, allowed_domains: [...(f.allowed_domains ?? []), domainInput] }))
                      setDomainInput('')
                    }
                  }
                }}
                placeholder="example.com"
                className="flex-1 bg-surface border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-blue"
              />
            </div>
            {form.allowed_domains?.map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-surface rounded px-2 py-0.5 text-xs mr-1 mt-1">
                {d}
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, allowed_domains: f.allowed_domains?.filter((_, j) => j !== i) }))}
                  className="text-gray-600 hover:text-accent-red ml-1">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>

          {error && <p className="text-xs text-accent-red">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-surface-border rounded py-2 text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-accent-blue rounded py-2 text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-50">
              {loading ? 'Starting…' : '▶ Start Crawl'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-surface border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-blue" />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div className={`w-8 h-4 rounded-full transition-colors ${value ? 'bg-accent-blue' : 'bg-surface-border'}`}
        onClick={() => onChange(!value)}>
        <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </label>
  )
}
