import { useState, useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import { getQuestionAnalysis, followupAnalysis, createAtom, createRelation } from '../../services/api'
import type { QuestionAnalysisResponse, VocabItem, GrammarItem } from '../../types'
import VocabChip from '../analysis/VocabChip'
import GrammarKBCard from '../analysis/GrammarCard'

type SD = Record<string, unknown>

// ─── Atom display — reuse VocabChip / GrammarCard with adapters ──────────────

type ExamAtom = {
  type: string; key: string; reading?: string; meaning?: string
  part_of_speech?: string; jlpt_level?: string; register?: string
  connection?: string; usage?: string; nuance?: string; example?: string
}

type ExamRelation = {
  from_key: string; to_key: string; relation_type: string; note?: string
}

// ─── Atom cards ───────────────────────────────────────────────────────────────

function toVocabItem(a: ExamAtom): VocabItem {
  return {
    surface: a.key, base: a.key,
    reading: a.reading ?? null,
    meaning: a.meaning ?? '',
    part_of_speech: a.part_of_speech ?? null,
    jlpt_level: a.jlpt_level ?? null,
    register: a.register ?? null,
    usage: a.usage ?? null,
    nuance: a.nuance ?? null,
    example: a.example ?? null,
  }
}

function toGrammarItem(a: ExamAtom): GrammarItem {
  return {
    pattern: a.key,
    meaning: a.meaning ?? '',
    connection: a.connection ?? null,
    jlpt_level: a.jlpt_level ?? null,
    register: a.register ?? null,
    usage: a.usage ?? null,
    nuance: a.nuance ?? null,
    example: a.example ?? null,
  }
}

function AtomsSection({ atoms }: { atoms: ExamAtom[] }) {
  if (!atoms?.length) return null
  const words = atoms.filter(a => a.type === 'word')
  const grammars = atoms.filter(a => a.type === 'grammar')
  return (
    <div className="space-y-2">
      {words.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {words.map((a, i) => <VocabChip key={i} item={toVocabItem(a)} />)}
        </div>
      )}
      {grammars.length > 0 && (
        <div className="space-y-2">
          {grammars.map((a, i) => <GrammarKBCard key={i} item={toGrammarItem(a)} />)}
        </div>
      )}
    </div>
  )
}

// ─── Option tabs ──────────────────────────────────────────────────────────────

interface OptionEntry {
  option: string
  is_correct?: boolean
  explanation: string
  detail?: React.ReactNode
}

function OptionTabs({ options }: { options: OptionEntry[] }) {
  const defaultOpt = options.find(o => o.is_correct)?.option ?? options[0]?.option ?? '1'
  const [active, setActive] = useState(defaultOpt)
  const cur = options.find(o => o.option === active)

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {options.map(o => {
          const isCur = active === o.option
          const hasResult = o.is_correct !== undefined
          let cls = 'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all border '
          if (hasResult) {
            cls += isCur
              ? (o.is_correct
                ? 'bg-success text-white border-success shadow-sm'
                : 'bg-danger/80 text-white border-danger shadow-sm')
              : (o.is_correct
                ? 'border-success/50 text-success-fg'
                : 'border-border text-fg-muted hover:border-accent/40')
          } else {
            cls += isCur
              ? 'bg-accent text-white border-accent shadow-sm'
              : 'border-border text-fg-muted hover:border-accent/40'
          }
          return (
            <button key={o.option} onClick={() => setActive(o.option)} className={cls}>
              {o.option}
            </button>
          )
        })}
      </div>

      {cur && (
        <div className="p-3 bg-bg border border-border rounded-xl space-y-2 text-xs">
          {cur.detail}
          <p className="text-fg leading-relaxed">{cur.explanation}</p>
          {cur.is_correct !== undefined && (
            <div className={`flex items-center gap-1 text-[10px] font-semibold pt-0.5 ${cur.is_correct ? 'text-success-fg' : 'text-danger-fg'}`}>
              {cur.is_correct
                ? <CheckCircle className="w-3 h-3" />
                : <XCircle className="w-3 h-3" />}
              {cur.is_correct ? '正确' : '错误'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Shared detail cards (inside tab content) ─────────────────────────────────

function WordDetail({ w }: {
  w: { surface: string; reading: string; meaning: string; usage_condition?: string; synonym_note?: string }
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-2 space-y-0.5">
      <p className="font-semibold text-sky-700">
        {w.surface}
        <span className="text-fg-muted font-normal ml-1.5 font-mono">【{w.reading}】</span>
      </p>
      <p className="text-fg-muted">{w.meaning}</p>
      {(w.usage_condition || w.synonym_note) && (
        <p className="text-fg-muted border-t border-border pt-1 mt-1">
          {w.usage_condition ?? w.synonym_note}
        </p>
      )}
    </div>
  )
}

function GrammarDetail({ g }: {
  g: { pattern: string; meaning: string; connection?: string | null; example?: string }
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-2 space-y-0.5">
      <p className="font-mono font-semibold text-accent">{g.pattern}</p>
      <p className="text-fg-muted">{g.meaning}</p>
      {g.connection && <p className="text-fg-muted">接続：{g.connection}</p>}
      {g.example && <p className="text-fg italic border-t border-border pt-1 mt-1">「{g.example}」</p>}
    </div>
  )
}

// ─── 10 type renderers ────────────────────────────────────────────────────────

function VocabFillAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
    word?: { surface: string; reading: string; meaning: string; usage_condition?: string }
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: o.word ? <WordDetail w={o.word} /> : undefined,
    })) ?? []} />
  )
}

function SynonymAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
    word?: { surface: string; reading: string; meaning: string; synonym_note?: string }
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: o.word ? <WordDetail w={o.word} /> : undefined,
    })) ?? []} />
  )
}

function UsageAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string; violation?: string
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: o.violation ? (
        <p className="text-danger-fg text-[11px] bg-danger/5 border border-danger/20 rounded px-2 py-1">
          ⚠ {o.violation}
        </p>
      ) : undefined,
    })) ?? []} />
  )
}

function WordFormationAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
    word?: { surface: string; reading: string; meaning: string }
    formation?: { components: Array<{ part: string; meaning: string }>; pattern: string }
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: (o.word || o.formation) ? (
        <div className="space-y-1">
          {o.word && <WordDetail w={o.word} />}
          {o.formation && (
            <div className="text-[11px] text-fg-muted">
              {o.formation.components.map((c, i) => (
                <span key={i} className="mr-2">
                  <span className="font-medium text-fg">{c.part}</span>「{c.meaning}」
                </span>
              ))}
            </div>
          )}
        </div>
      ) : undefined,
    })) ?? []} />
  )
}

function KanjiReadingAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
    })) ?? []} />
  )
}

function KanjiWritingAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string; kanji_note?: string
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: o.kanji_note ? <p className="text-fg text-xs">{o.kanji_note}</p> : undefined,
    })) ?? []} />
  )
}

function GrammarFillAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
    grammar?: { pattern: string; meaning: string; connection?: string | null; example?: string }
  }>
  return (
    <OptionTabs options={opts?.map(o => ({
      option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      detail: o.grammar ? <GrammarDetail g={o.grammar} /> : undefined,
    })) ?? []} />
  )
}

function SentenceOrderAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; role: string; explanation: string
  }>
  return (
    <div className="space-y-3">
      {(data.correct_order || data.star_answer) && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5 space-y-1">
          {data.correct_order && (
            <p className="text-sm font-semibold text-fg">{data.correct_order as string}</p>
          )}
          {data.star_answer && (
            <p className="text-xs text-fg-muted">
              ★ <span className="text-fg font-medium">{data.star_answer as string}</span>
            </p>
          )}
        </div>
      )}
      {data.order_logic && (
        <p className="text-xs text-fg leading-relaxed bg-surface border border-border rounded-lg px-3 py-2">
          {data.order_logic as string}
        </p>
      )}
      <OptionTabs options={opts?.map(o => ({
        option: o.option, explanation: o.explanation,
        detail: o.role ? <p className="text-fg-muted text-xs font-medium">{o.role}</p> : undefined,
      })) ?? []} />
    </div>
  )
}

function PassageFillAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
    grammar?: { pattern: string; meaning: string; connection?: string | null; example?: string }
    context_note?: string
  }>
  return (
    <div className="space-y-3">
      {data.context_reason && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5 text-xs text-fg leading-relaxed">
          <span className="font-semibold text-accent mr-1.5">上下文</span>
          {data.context_reason as string}
        </div>
      )}
      <OptionTabs options={opts?.map(o => ({
        option: o.option, is_correct: o.is_correct, explanation: o.explanation,
        detail: (o.grammar || o.context_note) ? (
          <div className="space-y-1">
            {o.grammar && <GrammarDetail g={o.grammar} />}
            {o.context_note && <p className="text-fg-muted text-[11px]">{o.context_note}</p>}
          </div>
        ) : undefined,
      })) ?? []} />
    </div>
  )
}

function ReadingCompAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
  }>
  return (
    <div className="space-y-3">
      {data.key_sentence && (
        <p className="text-xs text-fg-muted italic bg-bg border border-border rounded-lg px-3 py-2 leading-relaxed">
          关键句：「{data.key_sentence as string}」
        </p>
      )}
      <OptionTabs options={opts?.map(o => ({
        option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      })) ?? []} />
    </div>
  )
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const TYPE_RENDERERS: Record<string, (data: SD) => React.ReactNode> = {
  vocab_fill:      data => <VocabFillAnalysis data={data} />,
  synonym:         data => <SynonymAnalysis data={data} />,
  usage:           data => <UsageAnalysis data={data} />,
  word_formation:  data => <WordFormationAnalysis data={data} />,
  kanji_reading:   data => <KanjiReadingAnalysis data={data} />,
  kanji_writing:   data => <KanjiWritingAnalysis data={data} />,
  grammar_fill:    data => <GrammarFillAnalysis data={data} />,
  sentence_order:  data => <SentenceOrderAnalysis data={data} />,
  passage_fill:    data => <PassageFillAnalysis data={data} />,
  reading_comp:    data => <ReadingCompAnalysis data={data} />,
}

// ─── D3 Relation graph ────────────────────────────────────────────────────────

const RELATION_LABELS: Record<string, string> = {
  synonym: '近义',
  formal_casual: '语体差异',
  derivative: '派生',
  contrast: '对比',
  nuance: '语感差异',
  confusable: '易混淆',
}

const GW = 200, GH = 130
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function getConnectedComponents(atoms: ExamAtom[], relations: ExamRelation[]) {
  const parent = new Map<string, string>()
  atoms.forEach(a => parent.set(a.key, a.key))

  function find(x: string): string {
    const p = parent.get(x)
    if (p === undefined || p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }

  for (const r of relations) {
    if (!parent.has(r.from_key) || !parent.has(r.to_key)) continue
    const px = find(r.from_key), py = find(r.to_key)
    if (px !== py) parent.set(px, py)
  }

  const groups = new Map<string, { atoms: ExamAtom[]; relations: ExamRelation[] }>()
  for (const a of atoms) {
    const root = find(a.key)
    if (!groups.has(root)) groups.set(root, { atoms: [], relations: [] })
    groups.get(root)!.atoms.push(a)
  }
  for (const r of relations) {
    if (!parent.has(r.from_key)) continue
    groups.get(find(r.from_key))?.relations.push(r)
  }

  return [...groups.values()].filter(g => g.relations.length > 0)
}

function MiniGraph({ atoms, relations }: { atoms: ExamAtom[]; relations: ExamRelation[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const nodes = atoms.map(a => ({ id: a.key, atomType: a.type, x: GW / 2, y: GH / 2 }))
    const idx = new Map(nodes.map((n, i) => [n.id, i]))
    const links = relations
      .filter(r => idx.has(r.from_key) && idx.has(r.to_key))
      .map(r => ({ source: idx.get(r.from_key)!, target: idx.get(r.to_key)! }))

    const sim = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(links).distance(65))
      .force('charge', d3.forceManyBody().strength(-130))
      .force('center', d3.forceCenter(GW / 2, GH / 2))
      .force('collision', d3.forceCollide(22))

    const linkSel = svg.append('g')
      .selectAll('line').data(links).enter().append('line')
      .attr('stroke', '#cbd5e1').attr('stroke-width', 1.5)

    const nodeSel = svg.append('g')
      .selectAll('g').data(nodes).enter().append('g')

    nodeSel.append('circle')
      .attr('r', 18)
      .attr('fill', d => d.atomType === 'grammar' ? 'rgba(99,102,241,0.12)' : 'rgba(14,165,233,0.12)')
      .attr('stroke', d => d.atomType === 'grammar' ? '#6366f1' : '#0ea5e9')
      .attr('stroke-width', 1.5)

    nodeSel.append('text')
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('font-size', '9px').attr('pointer-events', 'none')
      .attr('fill', d => d.atomType === 'grammar' ? '#4f46e5' : '#0369a1')
      .text(d => d.id.length > 6 ? d.id.slice(0, 6) + '…' : d.id)

    sim.on('tick', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkSel
        .attr('x1', (d: any) => clamp(d.source.x, 20, GW - 20))
        .attr('y1', (d: any) => clamp(d.source.y, 20, GH - 20))
        .attr('x2', (d: any) => clamp(d.target.x, 20, GW - 20))
        .attr('y2', (d: any) => clamp(d.target.y, 20, GH - 20))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeSel.attr('transform', (d: any) =>
        `translate(${clamp(d.x, 20, GW - 20)},${clamp(d.y, 20, GH - 20)})`
      )
    })

    return () => { sim.stop() }
  }, [atoms, relations])

  return <svg ref={svgRef} width={GW} height={GH} className="shrink-0" />
}

function RelationGraph({
  atoms, relations, onSave, saving, saved,
}: {
  atoms: ExamAtom[]
  relations: ExamRelation[]
  onSave?: () => void
  saving?: boolean
  saved?: { atoms: number; relations: number } | null
}) {
  if (!relations?.length) return null
  const components = getConnectedComponents(atoms, relations)
  if (!components.length) return null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-surface flex items-center justify-between">
        <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wide">知识关联图</p>
        {onSave && (
          saved
            ? <span className="text-[10px] text-success-fg font-medium">✓ 已保存 {saved.atoms} 词 · {saved.relations} 条关联</span>
            : <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-1 text-[10px] font-medium text-accent hover:text-accent-hover disabled:opacity-40 transition-colors"
              >
                {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
                {saving ? '保存中…' : '保存到知识库'}
              </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {components.map((comp, i) => (
          <div key={i} className="flex">
            <div className="shrink-0 border-r border-border bg-bg/40 flex items-center justify-center p-1">
              <MiniGraph atoms={comp.atoms} relations={comp.relations} />
            </div>
            <div className="flex-1 p-3 space-y-3 text-xs min-w-0">
              {comp.relations.map((r, j) => {
                const fromType = atoms.find(a => a.key === r.from_key)?.type
                const toType = atoms.find(a => a.key === r.to_key)?.type
                return (
                  <div key={j} className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`font-medium shrink-0 ${fromType === 'grammar' ? 'text-accent font-mono' : 'text-sky-700'}`}>
                        {r.from_key}
                      </span>
                      <span className="text-fg-muted text-[10px]">→</span>
                      <span className={`font-medium shrink-0 ${toType === 'grammar' ? 'text-accent font-mono' : 'text-sky-700'}`}>
                        {r.to_key}
                      </span>
                      <span className="text-[10px] bg-border/60 px-1.5 py-0.5 rounded-full text-fg-muted shrink-0">
                        {RELATION_LABELS[r.relation_type] ?? r.relation_type}
                      </span>
                    </div>
                    {r.note && <p className="text-fg-muted leading-relaxed">{r.note}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnalysisPanel({ questionId }: { questionId: string }) {
  const [data, setData] = useState<QuestionAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [followupText, setFollowupText] = useState('')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ atoms: number; relations: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    setData(null)
    setSaved(null)
    getQuestionAnalysis(questionId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [questionId])

  async function saveToKB() {
    if (!sd) return
    const relations = (sd.relations ?? []) as ExamRelation[]
    if (!relations.length) return
    setSaving(true)
    try {
      const atomIdMap = new Map<string, string>()
      for (const atom of allAtoms) {
        const props = [
          atom.reading && { kind: 'reading', value: atom.reading, source_type: 'ai' },
          atom.meaning && { kind: 'meaning', value: atom.meaning, source_type: 'ai' },
        ].filter(Boolean) as { kind: string; value: string; source_type: string }[]
        const res = await createAtom({
          type: atom.type === 'grammar' ? 'grammar' : 'vocabulary',
          key: atom.key,
          properties: props.length ? props : undefined,
        })
        const id = res.atom_id ?? res.candidates?.[0]?.atom_id
        if (id) atomIdMap.set(atom.key, id)
      }
      let relCount = 0
      for (const rel of relations) {
        const fromId = atomIdMap.get(rel.from_key)
        const toId = atomIdMap.get(rel.to_key)
        if (!fromId || !toId) continue
        await createRelation(fromId, {
          target_atom_id: toId,
          type: rel.relation_type,
          note: rel.note ? { text: rel.note } : undefined,
        }).catch(() => {})
        relCount++
      }
      setSaved({ atoms: atomIdMap.size, relations: relCount })
    } finally {
      setSaving(false)
    }
  }

  async function sendFollowup() {
    if (!followupText.trim() || !data) return
    setSending(true)
    try {
      const res = await followupAnalysis(questionId, followupText.trim())
      setData(prev => {
        if (!prev?.session_data) return prev
        const followups = [
          ...(prev.session_data.followups as Array<{ prompt: string; response: string }> ?? []),
          { prompt: followupText.trim(), response: res.response },
        ]
        return { ...prev, session_data: { ...prev.session_data, followups } }
      })
      setFollowupText('')
    } finally {
      setSending(false)
    }
  }

  const sd = data?.session_data
  const analysisType = sd?.analysis_type as string | undefined

  // Merge stem_notes atoms + sd.atoms, deduplicate by key
  const stemAtoms: ExamAtom[] = ((sd?.stem_notes ?? []) as Array<{
    type: string; key: string; reading?: string; note: string
  }>).map(n => ({ type: n.type, key: n.key, reading: n.reading, meaning: n.note }))
  const sdAtoms: ExamAtom[] = (sd?.atoms ?? []) as ExamAtom[]
  const allAtoms = [...stemAtoms, ...sdAtoms].filter(
    (a, i, arr) => arr.findIndex(b => b.key === a.key) === i
  )

  return (
    <div className="mt-3 border border-accent/30 rounded-xl overflow-hidden bg-bg">
      <div className="flex items-center justify-between px-3 py-2 bg-accent/5 border-b border-accent/20">
        <span className="text-xs font-semibold text-accent">AI 解析</span>
        {data?.cached && (
          <span className="text-[10px] text-fg-muted bg-border px-1.5 py-0.5 rounded-full">缓存</span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-6 gap-2 text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">生成解析中…</span>
          </div>
        )}

        {!loading && !sd && (
          <p className="text-xs text-fg-muted text-center py-4">暂无解析</p>
        )}

        {sd && (
          <>
            {sd.summary && (
              <p className="text-xs text-fg leading-relaxed bg-surface border border-border rounded-lg px-3 py-2">
                {sd.summary as string}
              </p>
            )}

            {analysisType && TYPE_RENDERERS[analysisType]?.(sd)}

            <AtomsSection atoms={allAtoms} />

            <RelationGraph
              atoms={allAtoms}
              relations={(sd.relations ?? []) as ExamRelation[]}
              onSave={saveToKB}
              saving={saving}
              saved={saved}
            />

            {(sd.followups as Array<{ prompt: string; response: string }>)?.map((f, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs text-fg-muted bg-border/40 rounded px-2 py-1">Q: {f.prompt}</p>
                <p className="text-xs text-fg bg-surface border border-border rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap">
                  {f.response}
                </p>
              </div>
            ))}

            <div className="flex gap-2 pt-1">
              <input
                className="flex-1 text-xs border border-border rounded-lg px-3 py-1.5 bg-surface focus:outline-none focus:border-accent transition-colors"
                placeholder="继续追问…"
                value={followupText}
                onChange={e => setFollowupText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendFollowup()}
              />
              <button
                onClick={sendFollowup}
                disabled={sending || !followupText.trim()}
                className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg disabled:opacity-40 hover:bg-accent-hover transition-colors"
              >
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : '发送'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
