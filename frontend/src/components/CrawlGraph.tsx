import { useCallback, useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCrawlerStore, STATUS_COLOR } from '../store/crawlerStore'
import type { URLStatus } from '../types'

const STATUS_LABELS: Record<URLStatus, string> = {
  queued: 'Q', fetching: 'F', fetched: 'X',
  parsing: 'P', done: '✓', discarded: '✗', error: '!',
}

interface Props { jobId: string }

export function CrawlGraph({ jobId }: Props) {
  const graphNodes = useCrawlerStore(s => s.graphNodes)
  const graphEdges = useCrawlerStore(s => s.graphEdges)
  const setSelectedUrl = useCrawlerStore(s => s.setSelectedUrl)

  const rfNodes: Node[] = useMemo(() => {
    return Object.values(graphNodes).map((n, i) => ({
      id: n.id,
      position: { x: (n.depth * 220) + (i % 8) * 30, y: (i % 20) * 60 + (n.depth * 15) },
      data: {
        label: (
          <div className="flex items-center gap-1" title={n.id}>
            <span
              className="w-4 h-4 rounded-sm text-[9px] flex items-center justify-center font-bold"
              style={{ background: STATUS_COLOR[n.status], color: '#fff' }}
            >
              {STATUS_LABELS[n.status]}
            </span>
            <span className="text-[10px] max-w-[120px] truncate">{n.label}</span>
          </div>
        ),
      },
      style: {
        background: '#1a1d27',
        border: `1px solid ${STATUS_COLOR[n.status]}44`,
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 10,
        color: '#e5e7eb',
        minWidth: 160,
      },
    }))
  }, [graphNodes])

  const rfEdges: Edge[] = useMemo(() => {
    return graphEdges.map((e, i) => ({
      id: `${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      style: { stroke: '#2a2d3a', strokeWidth: 1 },
      animated: false,
    }))
  }, [graphEdges])

  const [nodes, , onNodesChange] = useNodesState(rfNodes)
  const [edges, , onEdgesChange] = useEdgesState(rfEdges)

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-surface-border">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelectedUrl(node.id)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.05}
        maxZoom={2}
        defaultEdgeOptions={{ animated: false }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#2a2d3a" gap={20} size={1} />
        <Controls
          style={{ background: '#1a1d27', border: '1px solid #2a2d3a' }}
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            const gn = graphNodes[n.id]
            return gn ? STATUS_COLOR[gn.status] : '#2a2d3a'
          }}
          maskColor="#0f1117cc"
          style={{ background: '#1a1d27', border: '1px solid #2a2d3a' }}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-12 left-2 flex gap-2 flex-wrap bg-surface-card/80 backdrop-blur px-2 py-1 rounded border border-surface-border z-10">
        {(Object.entries(STATUS_COLOR) as [URLStatus, string][]).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-sm" style={{ background: c }} />
            <span className="text-gray-400">{s}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
