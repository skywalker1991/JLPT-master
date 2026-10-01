import { useEffect, useRef, useState } from 'react'
import type { GrammarItem, KnowledgePoint, VocabItem } from '../../types'
import { lookupAtoms } from '../../services/api'
import ItemRow from '../analysis/ItemRow'
import { AskContext } from '../analysis/AskPanel'
import { grammarKey, vocabKey } from '../../utils/marks'

const asVocab = (p: KnowledgePoint): VocabItem => ({
  surface: p.key, base: p.key, reading: p.reading, meaning: p.meaning, surface_meaning: null,
  part_of_speech: null, jlpt_level: p.level, register: null, usage: null, nuance: null, example: null,
})
const asGrammar = (p: KnowledgePoint): GrammarItem => ({
  pattern: p.key, meaning: p.meaning, connection: null, jlpt_level: p.level, register: null, usage: null, nuance: null, example: null,
})

/**
 * 本题知识点: the options' words / grammar, then the ones worth keeping from
 * the whole sentence — as the same cards 语料分析 shows. Adding one keeps the
 * sentence with the answer filled in as its example and source. An option
 * that is only a wrong reading or spelling is listed, but there is nothing
 * to keep.
 */
export default function KnowledgeList({ points, sentence, translation }: {
  points: KnowledgePoint[]
  sentence: string | null
  translation: string | null
}) {
  const [known, setKnown] = useState<{ vocab: Record<string, string>; grammar: Record<string, string> }>({ vocab: {}, grammar: {} })
  const composerRef = useRef<HTMLElement>(null)
  const real = points.filter(p => p.exists !== false)

  useEffect(() => {
    const vocab = real.filter(p => p.kind === 'vocab').map(p => p.key)
    const grammar = real.filter(p => p.kind === 'grammar').map(p => p.key)
    if (!vocab.length && !grammar.length) return
    lookupAtoms(vocab, grammar).then(r => setKnown({ vocab: r.vocab, grammar: r.grammar })).catch(() => {})
  }, [points]) // eslint-disable-line react-hooks/exhaustive-deps

  const remember = (kind: 'vocab' | 'grammar', key: string, id: string) =>
    setKnown(k => ({ ...k, [kind]: { ...k[kind], [key]: id } }))

  const row = (p: KnowledgePoint, i: number) => {
    if (p.exists === false) {
      return (
        <li key={`x${i}`} className="flex items-baseline gap-3 px-1 py-1.5 text-sm">
          {p.option && <span className="text-xs text-fg-subtle tabular-nums w-3">{p.option}</span>}
          <span className="font-jp text-fg-muted whitespace-nowrap">{p.key}</span>
          <span className="text-xs text-fg-subtle truncate">{p.meaning}</span>
        </li>
      )
    }
    const row = p.kind === 'vocab'
      ? <ItemRow kind="vocab" item={asVocab(p)} atomId={known.vocab[vocabKey(asVocab(p))]} onAdded={(k, id) => remember('vocab', k, id)} />
      : <ItemRow kind="grammar" item={asGrammar(p)} atomId={known.grammar[grammarKey(asGrammar(p))]} onAdded={(k, id) => remember('grammar', k, id)} />
    return p.option
      ? <div key={`${p.kind}${p.key}${i}`} className="flex items-start gap-2"><span className="pt-3.5 text-xs text-fg-subtle tabular-nums w-3 shrink-0">{p.option}</span><ul className="flex-1 min-w-0">{row}</ul></div>
      : <ul key={`${p.kind}${p.key}${i}`}>{row}</ul>
  }

  const options = points.filter(p => p.from === 'option')
  const fromSentence = points.filter(p => p.from === 'sentence')
  const group = (title: string, list: KnowledgePoint[]) => list.length > 0 && (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-subtle">{title}</h3>
      <div className="flex flex-col gap-2">{list.map(row)}</div>
    </section>
  )

  return (
    <AskContext.Provider value={{
      analysisId: null, sentenceIndex: null, sentenceText: sentence, sentenceTranslation: translation,
      asks: [], addAsk: () => {}, busy: false, attached: [], setAttached: () => {}, composerRef,
    }}>
      <div className="flex flex-col gap-4">
        <span className="font-bold text-fg">本题知识点</span>
        {group('选项', options)}
        {group('完整句子', fromSentence)}
      </div>
    </AskContext.Provider>
  )
}
