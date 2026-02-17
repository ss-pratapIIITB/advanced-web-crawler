import axios from 'axios'
import type { CrawlJob, WorkerState, CreateJobPayload, Metrics } from '../types'

const api = axios.create({ baseURL: '/api/v1' })

export const CrawlerAPI = {
  listJobs: () => api.get<CrawlJob[]>('/jobs').then(r => r.data),
  getJob: (id: string) => api.get<CrawlJob>(`/jobs/${id}`).then(r => r.data),
  createJob: (payload: CreateJobPayload) => api.post<CrawlJob>('/jobs', payload).then(r => r.data),
  startJob: (id: string) => api.post(`/jobs/${id}/start`).then(r => r.data),
  pauseJob: (id: string) => api.post(`/jobs/${id}/pause`).then(r => r.data),
  stopJob: (id: string) => api.post(`/jobs/${id}/stop`).then(r => r.data),
  getGraph: (id: string, limit = 500) => api.get(`/jobs/${id}/graph?limit=${limit}`).then(r => r.data),
  getPages: (id: string, limit = 50, offset = 0) =>
    api.get(`/jobs/${id}/pages?limit=${limit}&offset=${offset}`).then(r => r.data),
  getDiscards: (id: string, limit = 100, reason?: string) =>
    api.get(`/jobs/${id}/discards?limit=${limit}${reason ? `&reason=${reason}` : ''}`).then(r => r.data),
  getWorkers: () => api.get<WorkerState[]>('/workers').then(r => r.data),
  getMetrics: (id: string) => api.get<Metrics>(`/jobs/${id}/metrics`).then(r => r.data),
}
