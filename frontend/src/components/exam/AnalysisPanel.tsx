import { useState, useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import { getItemAnalysis, getProblemAnalysis, createAtom, createRelation } from '../../services/api'
import type { QuestionAnalysisResponse, VocabItem, GrammarItem } from '../../types'
import VocabChip from '../analysis/VocabChip'
import GrammarKBCard from '../analysis/GrammarCard'
import AnalysisCard from '../analysis/AnalysisCard'

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
  const words = atoms.filter(a => a.type === 'vocabulary' || a.type === 'word')
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
  const grammar = data.grammar as Array<{ pattern: string; meaning: string; example?: string }> | undefined
  const vocabulary = data.vocabulary as Array<{ word: string; reading: string; meaning: string; part_of_speech: string }> | undefined
  return (
    <div className="space-y-3">
      {!!(data.correct_sequence || data.correct_order) && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5 space-y-1.5">
          {!!data.correct_sequence && (
            <p className="text-xs text-fg-muted font-mono">顺序：{data.correct_sequence as string}</p>
          )}
          {!!data.correct_order && (
            <p className="text-sm font-semibold text-fg leading-relaxed">{data.correct_order as string}</p>
          )}
          {!!data.translation && (
            <p className="text-xs text-fg-muted">{data.translation as string}</p>
          )}
        </div>
      )}
      {vocabulary && vocabulary.length > 0 && (
        <div className="space-y-1.5">
          <p className="section-label">词汇</p>
          <div className="flex flex-wrap gap-2">
            {vocabulary.map((v, i) => (
              <VocabChip key={i} item={{
                surface: v.word, base: v.word, reading: v.reading,
                meaning: v.meaning, part_of_speech: v.part_of_speech,
                jlpt_level: null, register: null, usage: null, nuance: null, example: null,
              }} />
            ))}
          </div>
        </div>
      )}
      {grammar && grammar.length > 0 && (
        <div className="space-y-1.5">
          <p className="section-label">语法</p>
          <div className="space-y-2">
            {grammar.map((g, i) => (
              <GrammarKBCard key={i} item={{
                pattern: g.pattern, meaning: g.meaning, example: g.example ?? null,
                connection: null, jlpt_level: null, register: null, usage: null, nuance: null,
              }} />
            ))}
          </div>
        </div>
      )}
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
      {!!data.context_reason && (
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
      {!!data.key_sentence && (
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

function ListeningAnalysis({ data }: { data: SD }) {
  const opts = data.options_analysis as Array<{
    option: string; is_correct: boolean; explanation: string
  }>
  const sentences = data.sentences as Array<{
    index: number; text: string; translation: string
    vocab?: VocabItem[]; grammar?: GrammarItem[]
  }> | undefined

  return (
    <div className="space-y-4">
      <OptionTabs options={opts?.map(o => ({
        option: o.option, is_correct: o.is_correct, explanation: o.explanation,
      })) ?? []} />

      {sentences && sentences.length > 0 && (
        <div className="space-y-3 pt-1">
          <p className="section-label">语料解析</p>
          {sentences.map(s => (
            <div key={s.index} className="border border-border rounded-xl overflow-hidden">
              <div className="bg-bg-subtle px-3 py-2">
                <p className="text-sm font-medium text-fg leading-relaxed">{s.text}</p>
                <p className="text-xs text-fg-muted mt-0.5">{s.translation}</p>
              </div>
              {((s.vocab?.length ?? 0) > 0 || (s.grammar?.length ?? 0) > 0) && (
                <div className="px-3 py-2.5 space-y-3">
                  {(s.vocab?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <p className="section-label">词汇</p>
                      <div className="flex flex-wrap gap-2">
                        {s.vocab!.map((v, i) => <VocabChip key={`${v.surface}-${i}`} item={v} />)}
                      </div>
                    </div>
                  )}
                  {(s.grammar?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <p className="section-label">语法</p>
                      <div className="space-y-2">
                        {s.grammar!.map((g, i) => <GrammarKBCard key={`${g.pattern}-${i}`} item={g} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Problem-level passage_fill renderer ─────────────────────────────────────

function PassageFillProblemAnalysis({ data }: { data: SD }) {
  const items = data.items as Array<{
    num: number
    options_analysis: Array<{ option: string; is_correct: boolean; explanation: string }>
  }> | undefined
  const sentences = data.sentences as Array<{
    text: string; translation: string
    vocab?: Array<{ surface: string; base: string; reading: string; meaning: string; part_of_speech: string; jlpt_level?: string; example?: string }>
    grammar?: Array<{ pattern: string; meaning: string; connection?: string; example?: string }>
  }> | undefined

  return (
    <div className="space-y-4">
      {items && items.map(item => (
        <div key={item.num} className="space-y-1.5">
          <p className="text-xs font-semibold text-fg-muted">第 {item.num} 空</p>
          <OptionTabs options={item.options_analysis.map(o => ({
            option: o.option,
            is_correct: o.is_correct,
            explanation: o.explanation,
          }))} />
        </div>
      ))}

      {sentences && sentences.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <p className="section-label shrink-0">语料解析</p>
            <div className="flex-1 h-px bg-border" />
          </div>
          {sentences.map((s, idx) => (
            <div key={idx} className="border border-border rounded-xl overflow-hidden">
              <div className="bg-bg-subtle px-3 py-2">
                <p className="text-sm font-medium text-fg leading-relaxed">{s.text}</p>
                <p className="text-xs text-fg-muted mt-0.5">{s.translation}</p>
              </div>
              <div className="px-3 py-2.5">
                <AnalysisCard
                  preprocessed={null}
                  analysis={{
                    index: idx,
                    text: s.text,
                    translation: s.translation,
                    vocab: (s.vocab ?? []).map(v => ({
                      surface: v.surface, base: v.base, reading: v.reading ?? null,
                      meaning: v.meaning, part_of_speech: v.part_of_speech ?? null,
                      jlpt_level: v.jlpt_level ?? null, register: null,
                      usage: null, nuance: null, example: v.example ?? null,
                    })),
                    grammar: (s.grammar ?? []).map(g => ({
                      pattern: g.pattern, meaning: g.meaning,
                      connection: g.connection ?? null, example: g.example ?? null,
                      jlpt_level: null, register: null, usage: null, nuance: null,
                    })),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

// ─── Problem-level reading_comp renderer ─────────────────────────────────────

type SentenceRow = {
  text: string; translation: string
  vocab?: Array<{ surface: string; base: string; reading: string; meaning: string; part_of_speech: string; jlpt_level?: string; example?: string }>
  grammar?: Array<{ pattern: string; meaning: string; connection?: string; example?: string }>
}

function ReadingCompProblemAnalysis({ data }: { data: SD; itemId?: string }) {
  const sentences = data.sentences as SentenceRow[] | undefined
  const questions = data.questions as Array<{
    num: number
    stem_translation: string
    options: Array<{ option: string; text: string; translation: string; is_correct: boolean }>
  }> | undefined

  return (
    <div className="space-y-4">
      {questions && questions.map(q => (
        <div key={q.num} className="space-y-1.5">
          <p className="text-xs font-semibold text-fg-muted">第 {q.num} 题</p>
          {q.stem_translation && (
            <p className="text-xs text-fg-muted leading-relaxed">{q.stem_translation}</p>
          )}
          <div className="space-y-1">
            {q.options?.map(o => (
              <div key={o.option} className={`flex gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                o.is_correct ? 'bg-green-50 border border-green-200' : 'bg-bg-subtle'
              }`}>
                <span className={`font-semibold shrink-0 ${o.is_correct ? 'text-green-700' : 'text-fg-muted'}`}>
                  {o.option}.
                </span>
                <div className="space-y-0.5">
                  <p className={o.is_correct ? 'text-green-800 font-medium' : 'text-fg'}>{o.text}</p>
                  <p className="text-fg-muted">{o.translation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {sentences && sentences.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <p className="section-label shrink-0">语料解析</p>
            <div className="flex-1 h-px bg-border" />
          </div>
          {sentences.map((s, idx) => (
            <div key={idx} className="border border-border rounded-xl overflow-hidden">
              <div className="bg-bg-subtle px-3 py-2">
                <p className="text-sm font-medium text-fg leading-relaxed">{s.text}</p>
                <p className="text-xs text-fg-muted mt-0.5">{s.translation}</p>
              </div>
              <div className="px-3 py-2.5">
                <AnalysisCard
                  preprocessed={null}
                  analysis={{
                    index: idx,
                    text: s.text,
                    translation: s.translation,
                    vocab: (s.vocab ?? []).map(v => ({
                      surface: v.surface, base: v.base, reading: v.reading ?? null,
                      meaning: v.meaning, part_of_speech: v.part_of_speech ?? null,
                      jlpt_level: v.jlpt_level ?? null, register: null,
                      usage: null, nuance: null, example: v.example ?? null,
                    })),
                    grammar: (s.grammar ?? []).map(g => ({
                      pattern: g.pattern, meaning: g.meaning,
                      connection: g.connection ?? null, example: g.example ?? null,
                      jlpt_level: null, register: null, usage: null, nuance: null,
                    })),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  listening:       data => <ListeningAnalysis data={data} />,
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

type ProblemAnalysisResponse = { problem_id: string; session_data: Record<string, unknown>; cached: boolean }

export default function AnalysisPanel({ itemId, problem }: {
  itemId?: string
  problem?: { id: string; type: string }
}) {
  const isProblemLevel = problem?.type === 'passage_fill' || problem?.type === 'reading_comp'

  const [data, setData] = useState<QuestionAnalysisResponse | null>(null)
  const [problemData, setProblemData] = useState<ProblemAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ atoms: number; relations: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    setData(null)
    setProblemData(null)
    setSaved(null)
    if (isProblemLevel && problem) {
      getProblemAnalysis(problem.id)
        .then(setProblemData)
        .catch(() => setProblemData(null))
        .finally(() => setLoading(false))
    } else if (itemId) {
      getItemAnalysis(itemId)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [itemId, problem?.id, isProblemLevel])

  async function saveToKB() {
    if (!sd) return
    const relations = (sd.relations ?? []) as ExamRelation[]
    if (!relations.length) return
    setSaving(true)
    try {
      const atomIdMap = new Map<string, string>()
      for (const atom of allAtoms) {
        const props = [
          atom.reading        && { kind: 'reading',        value: atom.reading,        source_type: 'ai' },
          atom.meaning        && { kind: 'meaning',        value: atom.meaning,        source_type: 'ai' },
          atom.part_of_speech && { kind: 'part_of_speech', value: atom.part_of_speech, source_type: 'ai' },
          atom.jlpt_level     && { kind: 'jlpt_level',     value: atom.jlpt_level,     source_type: 'ai' },
          atom.register       && { kind: 'register',       value: atom.register,       source_type: 'ai' },
          atom.connection     && { kind: 'connection',     value: atom.connection,     source_type: 'ai' },
          atom.usage          && { kind: 'usage',          value: atom.usage,          source_type: 'ai' },
          atom.nuance         && { kind: 'nuance',         value: atom.nuance,         source_type: 'ai' },
          atom.example        && { kind: 'example',        value: atom.example,        source_type: 'ai' },
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


  const sd = data?.session_data
  const analysisType = sd?.analysis_type as string | undefined

  // For problem-level analysis
  const psd = problemData?.session_data
  const isProblemAnalysis = isProblemLevel && !!psd && (Array.isArray(psd?.items) || Array.isArray(psd?.questions))

  // Merge stem_notes atoms + sd.atoms, deduplicate by key
  const stemAtoms: ExamAtom[] = ((sd?.stem_notes ?? []) as Array<{
    type: string; key: string; reading?: string; note: string
  }>).map(n => ({ type: n.type, key: n.key, reading: n.reading, meaning: n.note }))
  const sdAtoms: ExamAtom[] = (sd?.atoms ?? []) as ExamAtom[]
  const allAtoms = [...stemAtoms, ...sdAtoms].filter(
    (a, i, arr) => arr.findIndex(b => b.key === a.key) === i
  )

  const isCached = isProblemLevel ? problemData?.cached : data?.cached
  const hasData = isProblemLevel ? !!psd : !!sd

  return (
    <div className="mt-3 border border-accent/30 rounded-xl overflow-hidden bg-bg">
      <div className="flex items-center justify-between px-3 py-2 bg-accent/5 border-b border-accent/20">
        <span className="text-xs font-semibold text-accent">AI 解析</span>
        {isCached && (
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

        {!loading && !hasData && (
          <p className="text-xs text-fg-muted text-center py-4">暂无解析</p>
        )}

        {/* Problem-level analysis */}
        {!loading && isProblemAnalysis && psd && problem?.type === 'passage_fill' && (
          <PassageFillProblemAnalysis data={psd} />
        )}
        {!loading && isProblemAnalysis && psd && problem?.type === 'reading_comp' && (
          <ReadingCompProblemAnalysis data={psd} itemId={itemId} />
        )}

        {/* Item-level analysis */}
        {!loading && !isProblemLevel && sd && (
          <>
            {sd.summary && (
              <p className="text-xs text-fg leading-relaxed bg-surface border border-border rounded-lg px-3 py-2">
                {sd.summary as string}
              </p>
            )}

            {analysisType && TYPE_RENDERERS[analysisType]?.(sd)}

            {analysisType !== 'listening' && <AtomsSection atoms={allAtoms} />}

            {analysisType !== 'listening' && (
              <RelationGraph
                atoms={allAtoms}
                relations={(sd.relations ?? []) as ExamRelation[]}
                onSave={saveToKB}
                saving={saving}
                saved={saved}
              />
            )}

          </>
        )}
      </div>
    </div>
  )
}
