import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Network } from 'lucide-react'
import { getAtomGraph } from '../../services/api'
import type { AtomGraphResponse } from '../../types'

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  key: string
  type: string
  jlpt: string | null
  pos: string | null
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relType: string
}

interface Props {
  selectedId: string | null
  onSelectAtom: (id: string, key: string) => void
}

const NODE_R = 22
const LABEL_OFFSET = NODE_R + 12

// ── Edge colors ───────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  synonym:       '#22c55e',
  derivative:    '#3b82f6',
  formal_casual: '#f97316',
  contrast:      '#ef4444',
  nuance:        '#a855f7',
  confusable:    '#f59e0b',
}
const REL_LABELS: Record<string, string> = {
  synonym:       '同義',
  derivative:    '衍生',
  formal_casual: '文体',
  contrast:      '対比',
  nuance:        '語感',
  confusable:    '易混',
}

// ── Cluster / node colors ─────────────────────────────────────────────────────

const CLUSTER_STYLE: Record<string, { fill: string; stroke: string; selected: string; bg: string; label: string }> = {
  grammar:      { fill: '#ede9fe', stroke: '#8b5cf6', selected: '#7c3aed', bg: '#f5f3ff', label: '語法' },
  vocab_名詞:   { fill: '#dbeafe', stroke: '#3b82f6', selected: '#1d4ed8', bg: '#eff6ff', label: '名詞' },
  vocab_動詞:   { fill: '#dcfce7', stroke: '#16a34a', selected: '#15803d', bg: '#f0fdf4', label: '動詞' },
  vocab_形容詞: { fill: '#ffedd5', stroke: '#ea580c', selected: '#c2410c', bg: '#fff7ed', label: '形容詞' },
  vocab_副詞:   { fill: '#fce7f3', stroke: '#db2777', selected: '#be185d', bg: '#fdf4ff', label: '副詞' },
  vocab_惯用语: { fill: '#fef9c3', stroke: '#ca8a04', selected: '#a16207', bg: '#fefce8', label: '慣用語' },
  vocab_other:  { fill: '#f1f5f9', stroke: '#64748b', selected: '#475569', bg: '#f8fafc', label: 'その他' },
}

function edgeColor(type: string) { return EDGE_COLORS[type] ?? '#94a3b8' }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }

// ── Clustering ────────────────────────────────────────────────────────────────

function posGroup(pos: string | null | undefined): string {
  if (!pos) return 'other'
  const p = pos.toLowerCase()
  if (/惯用|idiom|慣用/.test(p))                       return '惯用语'
  if (/名詞|名词|noun|代名詞|代名词|pronoun/.test(p))  return '名詞'
  if (/動詞|动词|verb/.test(p))                        return '動詞'
  if (/形容詞|形容词|adjective|adj/.test(p))           return '形容詞'
  if (/副詞|副词|adverb|adv/.test(p))                  return '副詞'
  return 'other'
}

function clusterKey(n: SimNode): string {
  if (n.type === 'grammar') return 'grammar'
  return `vocab_${posGroup(n.pos)}`
}

function nodeStyle(n: SimNode) {
  return CLUSTER_STYLE[clusterKey(n)] ?? CLUSTER_STYLE.vocab_other
}

// Cluster centres as fractions of canvas
const CLUSTERS: Record<string, { nx: number; ny: number }> = {
  grammar:      { nx: 0.76, ny: 0.50 },
  vocab_名詞:   { nx: 0.24, ny: 0.22 },
  vocab_動詞:   { nx: 0.44, ny: 0.16 },
  vocab_形容詞: { nx: 0.20, ny: 0.58 },
  vocab_副詞:   { nx: 0.38, ny: 0.80 },
  vocab_惯用语: { nx: 0.58, ny: 0.80 },
  vocab_other:  { nx: 0.62, ny: 0.28 },
}

function clusterCenter(key: string, w: number, h: number) {
  const p = CLUSTERS[key] ?? { nx: 0.50, ny: 0.50 }
  return { x: p.nx * w, y: p.ny * h }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KnowledgeGraph({ selectedId, onSelectAtom }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const [graphData, setGraphData] = useState<AtomGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setDims({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    getAtomGraph()
      .then(setGraphData)
      .catch(() => setGraphData(null))
      .finally(() => setLoading(false))
  }, [])

  // ── Build D3 graph ──────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !graphData || graphData.nodes.length === 0 || !dims.w || !dims.h) return

    const sel = d3.select(svg)
    sel.selectAll('*').remove()
    if (simRef.current) simRef.current.stop()

    const { w, h } = dims

    const nodeById = new Map<string, SimNode>()
    const nodes: SimNode[] = graphData.nodes.map((n) => {
      const sn: SimNode = { id: n.id, key: n.key, type: n.type, jlpt: n.jlpt, pos: n.pos ?? null }
      nodeById.set(n.id, sn)
      return sn
    })

    // Pre-position nodes near their cluster centre
    nodes.forEach((node) => {
      const c = clusterCenter(clusterKey(node), w, h)
      node.x = c.x + (Math.random() - 0.5) * 80
      node.y = c.y + (Math.random() - 0.5) * 80
    })

    nodesRef.current = nodes

    const links: SimLink[] = graphData.edges
      .filter((e) => nodeById.has(e.from_id) && nodeById.has(e.to_id))
      .map((e) => ({ source: e.from_id, target: e.to_id, relType: e.type }))

    // ── Arrow markers ───────────────────────────────────────────────────────
    const defs = sel.append('defs')
    const markerTypes = [...new Set(links.map(l => l.relType))]
    markerTypes.forEach((type) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', NODE_R + 6)
        .attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', edgeColor(type))
    })

    // ── Zoom layer ──────────────────────────────────────────────────────────
    const root = sel.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 6])
      .on('zoom', (event) => root.attr('transform', event.transform))
    sel.call(zoom)
    zoomRef.current = zoom

    // ── Cluster background regions ──────────────────────────────────────────
    const usedClusters = [...new Set(nodes.map(clusterKey))]
    const clusterBgGroup = root.append('g').attr('class', 'cluster-bg')
    usedClusters.forEach((key) => {
      const c = clusterCenter(key, w, h)
      const style = CLUSTER_STYLE[key] ?? CLUSTER_STYLE.vocab_other
      clusterBgGroup.append('ellipse')
        .attr('cx', c.x).attr('cy', c.y)
        .attr('rx', 90).attr('ry', 72)
        .attr('fill', style.bg)
        .attr('fill-opacity', 0.6)
        .attr('stroke', style.stroke)
        .attr('stroke-opacity', 0.18)
        .attr('stroke-dasharray', '5 4')
        .attr('pointer-events', 'none')

      clusterBgGroup.append('text')
        .attr('x', c.x).attr('y', c.y - 78)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11')
        .attr('font-weight', '600')
        .attr('fill', style.stroke)
        .attr('opacity', 0.55)
        .attr('pointer-events', 'none')
        .text(style.label)
    })

    // ── Links ───────────────────────────────────────────────────────────────
    const linkGroup = root.append('g').attr('class', 'links')
    linkGroup.selectAll<SVGLineElement, SimLink>('line')
      .data(links).join('line')
      .attr('stroke', (d) => edgeColor(d.relType))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.55)
      .attr('marker-end', (d) => `url(#arrow-${d.relType})`)

    // ── Nodes ───────────────────────────────────────────────────────────────
    const nodeGroup = root.append('g').attr('class', 'nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes).join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => onSelectAtom(d.id, d.key))

    nodeGroup.append('circle')
      .attr('r', NODE_R)
      .attr('fill', (d) => nodeStyle(d).fill)
      .attr('stroke', (d) => nodeStyle(d).stroke)
      .attr('stroke-width', 1.5)

    nodeGroup.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle').attr('dy', LABEL_OFFSET)
      .attr('font-size', '11').attr('fill', '#334155').attr('pointer-events', 'none')
      .text((d) => truncate(d.key, 8))

    nodeGroup.append('title').text((d) => d.key)

    // ── Drag ────────────────────────────────────────────────────────────────
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0.15).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0.01)
        d.fx = null; d.fy = null
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeGroup.call(drag as any)

    // ── Cluster force ────────────────────────────────────────────────────────
    function clusterForce(alpha: number) {
      for (const node of nodes) {
        const c = clusterCenter(clusterKey(node), w, h)
        node.vx! += (c.x - node.x!) * 0.5 * alpha
        node.vy! += (c.y - node.y!) * 0.5 * alpha
      }
    }

    // ── Simulation warm-up ───────────────────────────────────────────────────
    // Run cluster force at controlled strength, then tick simulation physics.
    // This keeps charge/link from pulling nodes out of their starting clusters.
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('collision', d3.forceCollide(NODE_R + 18))

    sim.stop()
    for (let i = 0; i < 250; i++) {
      const strength = 0.6 * Math.max(0, 1 - i / 120)
      clusterForce(strength)
      sim.tick()
    }

    // Add gentle ongoing drift toward cluster
    sim.force('cluster', clusterForce)
    sim.alphaDecay(0).alphaTarget(0.01).velocityDecay(0.65).alpha(0.01).restart()

    simRef.current = sim

    const linkEl = linkGroup.selectAll<SVGLineElement, SimLink>('line')
    const nodeEl = root.select<SVGGElement>('.nodes').selectAll<SVGGElement, SimNode>('g')

    sim.on('tick', () => {
      linkEl
        .attr('x1', (d) => (d.source as SimNode).x!)
        .attr('y1', (d) => (d.source as SimNode).y!)
        .attr('x2', (d) => (d.target as SimNode).x!)
        .attr('y2', (d) => (d.target as SimNode).y!)
      nodeEl.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  }, [graphData, dims, onSelectAtom])

  // ── Pan to selected node ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId || !svgRef.current || !zoomRef.current || !dims.w || !dims.h) return
    const node = nodesRef.current.find((n) => n.id === selectedId)
    if (!node || node.x == null || node.y == null) return

    const currentK = d3.zoomTransform(svgRef.current).k
    const k = Math.max(currentK, 1.2)
    d3.select(svgRef.current)
      .transition().duration(500).ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform,
        d3.zoomIdentity.translate(dims.w / 2 - k * node.x, dims.h / 2 - k * node.y).scale(k))
  }, [selectedId, dims])

  // ── Highlight selected + neighbours ──────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !graphData) return

    const adjacent = new Set<string>()
    if (selectedId) {
      adjacent.add(selectedId)
      for (const e of graphData.edges) {
        if (e.from_id === selectedId) adjacent.add(e.to_id)
        if (e.to_id === selectedId) adjacent.add(e.from_id)
      }
    }

    d3.select(svgRef.current).select('.nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .each(function (d) {
        const style = nodeStyle(d)
        const isSelected = d.id === selectedId
        const isDimmed = !!selectedId && !adjacent.has(d.id)

        d3.select(this).select('circle')
          .attr('r', isSelected ? NODE_R + 5 : NODE_R)
          .attr('fill', isSelected ? style.selected : isDimmed ? '#f1f5f9' : style.fill)
          .attr('stroke', isDimmed ? '#e2e8f0' : style.stroke)
          .attr('stroke-width', isSelected ? 2.5 : 1.5)

        d3.select(this).select('.node-label')
          .attr('fill', isSelected ? style.selected : isDimmed ? '#d1d5db' : '#334155')
          .attr('font-weight', isSelected ? 'bold' : 'normal')
          .attr('dy', isSelected ? LABEL_OFFSET + 4 : LABEL_OFFSET)
      })

    d3.select(svgRef.current).select('.links')
      .selectAll<SVGLineElement, SimLink>('line')
      .attr('stroke-opacity', (d) => {
        if (!selectedId) return 0.55
        const s = (d.source as SimNode).id, t = (d.target as SimNode).id
        return (s === selectedId || t === selectedId) ? 1 : 0.05
      })
      .attr('stroke-width', (d) => {
        if (!selectedId) return 1.5
        const s = (d.source as SimNode).id, t = (d.target as SimNode).id
        return (s === selectedId || t === selectedId) ? 2.5 : 1.5
      })
  }, [selectedId, graphData])

  // ── Legend data ───────────────────────────────────────────────────────────
  const usedEdgeTypes = graphData
    ? [...new Set(graphData.edges.map((e) => e.type))].filter((t) => t in REL_LABELS)
    : []

  const usedNodeClusters = graphData
    ? [...new Set(graphData.nodes.map((n) =>
        n.type === 'grammar' ? 'grammar' : `vocab_${posGroup(n.pos)}`
      ))].filter((k) => k in CLUSTER_STYLE)
    : []

  const isEmpty = !loading && (!graphData || graphData.nodes.length === 0)

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      <svg ref={svgRef} width={dims.w} height={dims.h} className="absolute inset-0" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-subtle">
          <Network className="w-12 h-12 opacity-20" />
          <p className="text-sm">知識庫暫無詞條</p>
        </div>
      )}

      {/* Legend: node clusters + edge types */}
      {(usedNodeClusters.length > 0 || usedEdgeTypes.length > 0) && (
        <div className="absolute bottom-3 left-3 flex flex-col gap-2.5 bg-surface/90 backdrop-blur-sm px-2.5 py-2 rounded-lg border border-border text-xs pointer-events-none">
          {usedNodeClusters.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-fg-subtle opacity-60 font-medium">詞類</span>
              {usedNodeClusters.map((key) => {
                const style = CLUSTER_STYLE[key]
                return (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0 border" style={{ backgroundColor: style.fill, borderColor: style.stroke }} />
                    <span className="text-fg-subtle">{style.label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {usedEdgeTypes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-fg-subtle opacity-60 font-medium">關聯</span>
              {usedEdgeTypes.map((type) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-5 h-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: edgeColor(type) }} />
                  <span className="text-fg-subtle">{REL_LABELS[type] ?? type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {graphData && graphData.nodes.length > 0 && (
        <div className="absolute bottom-3 right-3 text-xs text-fg-subtle pointer-events-none">
          {graphData.nodes.length} 詞條 · {graphData.edges.length} 關聯
        </div>
      )}
    </div>
  )
}
