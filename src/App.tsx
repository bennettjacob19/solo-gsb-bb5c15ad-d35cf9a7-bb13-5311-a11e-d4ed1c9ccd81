import { useMemo, useState } from 'react';
import { EXAMPLE_JSON } from './example';
import type { Frac } from './fraction';
import {
  ALLOWED_DENOMINATORS,
  MAX_TUPLET_DEPTH,
  analyze,
  restName,
  suggestRests,
  validateScore,
  type LeafType,
  type MeasureReport,
  type MeasureStatus,
  type NotationFix,
  type NoteEvent,
  type OutlineComparison,
  type OutlineDiff,
  type RestEvent,
  type RestSuggestion,
  type RhythmEvent,
  type ScoreInput,
  type SegmentState,
} from './rhythm';

type Side = 'score' | 'reference';

/** 预览选中标识：小节序号（从 1 开始）+ 预览目标（休止符建议的一侧 / 按参考修正记谱） */
type Selection =
  | { measureIndex: number; kind: 'rest'; side: Side }
  | { measureIndex: number; kind: 'fix' };

type ParseResult = { ok: true; value: unknown } | { ok: false; message: string };

function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 时刻/时值展示：最简分数，必要时附带分数 */
function fmtFrac(f: Frac): string {
  const s = f.toString();
  const mixed = f.toMixed();
  return s === mixed ? s : `${s}（${mixed}）`;
}

/**
 * 按树路径（如 measures[3].events[1].events[2]）在某小节事件树内定位叶事件。
 * 首个下标为小节序号，事件下标从第二个开始；路径非法或目标不是叶事件时返回 null。
 */
function getLeaf(events: RhythmEvent[], path: string): NoteEvent | RestEvent | null {
  const indices = path.match(/\[(\d+)\]/g)?.map((s) => Number(s.slice(1, -1)));
  if (!indices || indices.length === 0) return null;
  let list = events;
  for (let k = 1; k < indices.length - 1; k++) {
    const node: RhythmEvent | undefined = list[indices[k]];
    if (!node || node.type !== 'tuplet') return null;
    list = node.events;
  }
  const leaf = list[indices[indices.length - 1]];
  return leaf && leaf.type !== 'tuplet' ? leaf : null;
}

function StatusBadge({ status, diff }: { status: MeasureStatus; diff: Frac }) {
  return (
    <span className={`badge badge-${status}`}>
      {status === 'ok' && '✓ 时值正确'}
      {status === 'short' && `不足 ${diff.abs().toString()}`}
      {status === 'over' && `超出 ${diff.abs().toString()}`}
    </span>
  );
}

/** 单侧时值明细（应有 / 实际 / 差值 / 越界定位） */
function MeasureFacts({ report }: { report: MeasureReport }) {
  const { expected, actual, diff, status, overflowPath } = report;
  return (
    <div className="measure-body">
      <div>
        <span className="label">应有时值</span>
        <span className="value">{expected.toString()}</span>
        {expected.toString() !== expected.toMixed() && (
          <span className="mixed">（{expected.toMixed()}）</span>
        )}
      </div>
      <div>
        <span className="label">实际时值</span>
        <span className="value">{actual.toString()}</span>
        {actual.toString() !== actual.toMixed() && (
          <span className="mixed">（{actual.toMixed()}）</span>
        )}
      </div>
      <div>
        <span className="label">差值</span>
        <span className="value">
          {diff.sign() === 0 ? '0' : `${diff.sign() > 0 ? '+' : '-'}${diff.abs().toString()}`}
        </span>
        <span className="mixed">（以全音符为 1）</span>
      </div>
      {status === 'over' && overflowPath && (
        <div className="overflow-path">
          首个越界叶事件：<code>{overflowPath}</code>
        </div>
      )}
    </div>
  );
}

function MeasureCard({
  report,
  suggestion,
  selected,
  onTogglePreview,
  onApply,
}: {
  report: MeasureReport;
  suggestion: RestSuggestion | null;
  selected: boolean;
  onTogglePreview: () => void;
  onApply: () => void;
}) {
  const { index, status, diff } = report;
  return (
    <div className={`measure measure-${status}`}>
      <div className="measure-head">
        <span className="measure-title">第 {index} 小节</span>
        <StatusBadge status={status} diff={diff} />
      </div>
      <MeasureFacts report={report} />
      {suggestion && (
        <RestSuggestionView
          suggestion={suggestion}
          selected={selected}
          onTogglePreview={onTogglePreview}
          onApply={onApply}
        />
      )}
    </div>
  );
}

/** 不足小节的休止符补全建议：预览追加事件并应用 */
function RestSuggestionView({
  suggestion,
  selected,
  onTogglePreview,
  onApply,
}: {
  suggestion: RestSuggestion;
  selected: boolean;
  onTogglePreview: () => void;
  onApply: () => void;
}) {
  if (suggestion.kind === 'impossible') {
    return (
      <div className="rest-suggestion impossible">
        <div className="rest-head">休止符补全建议</div>
        <div className="rest-body">
          缺口 <code>{suggestion.gap.toString()}</code>{' '}
          {suggestion.gap.toString() !== suggestion.gap.toMixed() && (
            <span className="mixed">（{suggestion.gap.toMixed()}）</span>
          )}{' '}
          无法用允许的休止符（分母 {ALLOWED_DENOMINATORS.join('、')}，普通或单附点）精确组成，不可补足，不提供近似方案。
        </div>
      </div>
    );
  }

  const { gap, eventCount, parts, events } = suggestion;
  return (
    <div className="rest-suggestion">
      <div className="rest-head">
        休止符补全建议
        <button
          className={selected ? 'rest-toggle active' : 'rest-toggle'}
          onClick={onTogglePreview}
        >
          {selected ? '取消预览' : '预览建议'}
        </button>
      </div>
      <div className="rest-body">
        缺口 <code>{gap.toString()}</code>
        {gap.toString() !== gap.toMixed() && <span className="mixed">（{gap.toMixed()}）</span>}
        ，在允许休止符中精确补足缺口、且事件数最少（{eventCount} 个事件）的追加方案：
      </div>
      <ul className="rest-parts">
        {parts.map((p) => (
          <li key={`${p.denominator}-${p.dot ? 1 : 0}`}>
            {restName(p.denominator, p.dot)} × {p.count}
            <span className="mixed">
              （每个 {p.duration.toString()}
              {p.duration.toString() !== p.duration.toMixed() && `，即 ${p.duration.toMixed()}`}
              ）
            </span>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="rest-preview">
          <div className="rest-preview-title">
            预览：以下休止符将按此顺序追加到该小节 events 末尾
          </div>
          <pre>{JSON.stringify(events, null, 2)}</pre>
          <div className="rest-actions">
            <button className="apply-btn" onClick={onApply}>
              应用建议
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StateTag({ state }: { state: SegmentState }) {
  return (
    <span className={`state state-${state}`}>{state === 'sounding' ? '发声' : '静音'}</span>
  );
}

/** 叶事件类型标签：音符 note / 休止符 rest */
function TypeChip({ type }: { type: LeafType }) {
  return (
    <span className={`state ${type === 'note' ? 'state-sounding' : 'state-silent'}`}>
      {type === 'note' ? '音符 note' : '休止符 rest'}
    </span>
  );
}

function DiffDetail({ diff }: { diff: OutlineDiff }) {
  return (
    <div className="diff-detail">
      <div className="diff-title">最早差异区间</div>
      <div className="diff-row">
        <span className="label">区间</span>
        <span className="value">
          [{fmtFrac(diff.start)}, {fmtFrac(diff.end)})
        </span>
        <span className="mixed">（以全音符为 1，从小节起点计）</span>
      </div>
      <div className="diff-row">
        <span className="label">记谱</span>
        <StateTag state={diff.scoreState} />
        <code>{diff.scorePath}</code>
      </div>
      <div className="diff-row">
        <span className="label">参考</span>
        <StateTag state={diff.referenceState} />
        <code>{diff.referencePath}</code>
      </div>
    </div>
  );
}

/** 按参考修正记谱：列出全部拟修改叶路径与前后类型；不可修正时显示原因，不给部分方案 */
function NotationFixView({
  fix,
  scoreEvents,
  selected,
  onTogglePreview,
  onApply,
}: {
  fix: NotationFix;
  /** 该小节记谱侧原始事件树（用于预览定位拟修改叶） */
  scoreEvents: RhythmEvent[];
  selected: boolean;
  onTogglePreview: () => void;
  onApply: () => void;
}) {
  if (fix.kind === 'blocked') {
    return (
      <div className="notation-fix blocked">
        <div className="fix-head">按参考修正记谱</div>
        <div className="fix-body">
          以下记谱叶事件内部参考状态发生变化，无法仅通过切换 note/rest 类型修正，不提供部分方案：
        </div>
        <ul className="fix-blockers">
          {fix.blockers.map((b) => (
            <li key={b.path}>
              <div className="fix-blocker-head">
                <code>{b.path}</code>
                <span className="mixed">
                  区间 [{fmtFrac(b.start)}, {fmtFrac(b.end)}) · 记谱
                </span>
                <StateTag state={b.scoreState} />
              </div>
              <ul className="fix-ref-runs">
                {b.referenceSegments.map((r, i) => (
                  <li key={i}>
                    [{fmtFrac(r.start)}, {fmtFrac(r.end)}) 参考 <StateTag state={r.state} />
                    <span className="mixed">（{r.paths.join('、')}）</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (fix.changes.length === 0) return null;

  return (
    <div className="notation-fix">
      <div className="fix-head">
        按参考修正记谱
        <button
          className={selected ? 'rest-toggle active' : 'rest-toggle'}
          onClick={onTogglePreview}
        >
          {selected ? '取消预览' : '预览修改'}
        </button>
      </div>
      <div className="fix-body">
        两侧时值均正确，以下 {fix.changes.length}{' '}
        个记谱叶事件与参考状态不一致，且每个叶覆盖的参考状态恒定，可仅切换
        type（分母、附点与连音结构保持不变）：
      </div>
      <ul className="fix-changes">
        {fix.changes.map((c) => (
          <li key={c.path}>
            <code>{c.path}</code>
            <TypeChip type={c.from} />
            <span className="fix-arrow">→</span>
            <TypeChip type={c.to} />
            <span className="mixed">
              区间 [{fmtFrac(c.start)}, {fmtFrac(c.end)})
            </span>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="rest-preview">
          <div className="rest-preview-title">
            预览：以下叶事件的 type 将按此切换，其余字段、referenceMeasures 与其他小节不变
          </div>
          <pre>
            {JSON.stringify(
              fix.changes.map((c) => {
                const leaf = getLeaf(scoreEvents, c.path);
                return {
                  path: c.path,
                  修改前: leaf,
                  修改后: leaf ? { ...leaf, type: c.to } : null,
                };
              }),
              null,
              2,
            )}
          </pre>
          <div className="rest-actions">
            <button className="apply-btn" onClick={onApply}>
              应用修正
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 对照卡片：两侧时值结果 + 演奏轮廓对照结论 */
function CompareCard({
  score,
  reference,
  comparison,
  fix,
  scoreEvents,
  scoreSuggestion,
  referenceSuggestion,
  selectedSide,
  fixSelected,
  onTogglePreview,
  onApply,
  onToggleFixPreview,
  onApplyFix,
}: {
  score: MeasureReport;
  reference: MeasureReport;
  comparison: OutlineComparison | null;
  fix: NotationFix | null;
  scoreEvents: RhythmEvent[];
  scoreSuggestion: RestSuggestion | null;
  referenceSuggestion: RestSuggestion | null;
  selectedSide: Side | null;
  fixSelected: boolean;
  onTogglePreview: (side: Side) => void;
  onApply: (side: Side) => void;
  onToggleFixPreview: () => void;
  onApplyFix: () => void;
}) {
  // 未对照时取两侧较差状态着色（over 优先于 short）
  const worst: MeasureStatus =
    score.status === 'over' || reference.status === 'over'
      ? 'over'
      : score.status === 'short' || reference.status === 'short'
        ? 'short'
        : 'ok';
  const cardStatus =
    comparison === null ? worst : comparison.kind === 'match' ? 'ok' : 'over';

  return (
    <div className={`measure measure-${cardStatus}`}>
      <div className="measure-head">
        <span className="measure-title">第 {score.index} 小节</span>
        {comparison === null ? (
          <span className={`badge badge-${worst}`}>未对照 · 存在时值问题</span>
        ) : comparison.kind === 'match' ? (
          <span className="badge badge-ok">✓ 演奏轮廓一致</span>
        ) : (
          <span className="badge badge-over">✗ 演奏轮廓不同</span>
        )}
      </div>
      <div className="compare-sides">
        <div className="side">
          <div className="side-head">
            <span className="side-label">记谱</span>
            <StatusBadge status={score.status} diff={score.diff} />
          </div>
          <MeasureFacts report={score} />
          {scoreSuggestion && (
            <RestSuggestionView
              suggestion={scoreSuggestion}
              selected={selectedSide === 'score'}
              onTogglePreview={() => onTogglePreview('score')}
              onApply={() => onApply('score')}
            />
          )}
        </div>
        <div className="side">
          <div className="side-head">
            <span className="side-label">参考演奏</span>
            <StatusBadge status={reference.status} diff={reference.diff} />
          </div>
          <MeasureFacts report={reference} />
          {referenceSuggestion && (
            <RestSuggestionView
              suggestion={referenceSuggestion}
              selected={selectedSide === 'reference'}
              onTogglePreview={() => onTogglePreview('reference')}
              onApply={() => onApply('reference')}
            />
          )}
        </div>
      </div>
      {comparison === null ? (
        <div className="compare-note">对应小节存在时值问题，修正后再进行演奏轮廓对照。</div>
      ) : (
        comparison.kind === 'diff' && (
          <>
            <DiffDetail diff={comparison.diff} />
            {fix && (
              <NotationFixView
                fix={fix}
                scoreEvents={scoreEvents}
                selected={fixSelected}
                onTogglePreview={onToggleFixPreview}
                onApply={onApplyFix}
              />
            )}
          </>
        )
      )}
    </div>
  );
}

export default function App() {
  const [text, setText] = useState(EXAMPLE_JSON);
  /** 当前选中预览的建议（同一时刻至多一个） */
  const [selection, setSelection] = useState<Selection | null>(null);

  const parsed = useMemo(() => parseJson(text), [text]);
  const errors = useMemo(() => (parsed.ok ? validateScore(parsed.value) : []), [parsed]);
  const report = useMemo(
    () => (parsed.ok && errors.length === 0 ? analyze(parsed.value as ScoreInput) : null),
    [parsed, errors],
  );

  const ts = parsed.ok && errors.length === 0 ? (parsed.value as ScoreInput).timeSignature : null;

  /** 逐小节休止符补全建议；仅不足小节有值（不能精确补足时为 impossible） */
  const buildSuggestions = (measures: { status: MeasureStatus; diff: Frac }[] | null) =>
    measures
      ? measures.map((m) =>
          m.status === 'short' ? suggestRests(m.diff.abs()) : null,
        )
      : null;

  const scoreSuggestions = buildSuggestions(report?.measures ?? null);
  const referenceSuggestions = buildSuggestions(report?.reference ?? null);

  const isSelected = (measureIndex: number, side: Side) =>
    selection?.kind === 'rest' &&
    selection.measureIndex === measureIndex &&
    selection.side === side;

  const togglePreview = (measureIndex: number, side: Side) => {
    setSelection((cur) =>
      cur && cur.kind === 'rest' && cur.measureIndex === measureIndex && cur.side === side
        ? null
        : { measureIndex, kind: 'rest', side },
    );
  };

  const toggleFixPreview = (measureIndex: number) => {
    setSelection((cur) =>
      cur && cur.kind === 'fix' && cur.measureIndex === measureIndex
        ? null
        : { measureIndex, kind: 'fix' },
    );
  };

  /** 将某个建议的休止符事件追加到对应小节 events 末尾，更新输入 JSON 后重新校对 */
  const applySuggestion = (measureIndex: number, side: Side) => {
    if (!parsed.ok || !report) return;
    const measures =
      side === 'score'
        ? (parsed.value as ScoreInput).measures
        : (parsed.value as ScoreInput).referenceMeasures;
    if (!measures) return;
    const suggestion =
      side === 'score'
        ? scoreSuggestions?.[measureIndex - 1]
        : referenceSuggestions?.[measureIndex - 1];
    if (!suggestion || suggestion.kind !== 'plan') return;

    // 结构化克隆保证原有事件与另一侧内容完全不变
    const next: ScoreInput = structuredClone(parsed.value as ScoreInput);
    const target = (side === 'score' ? next.measures : next.referenceMeasures!)[measureIndex - 1];
    target.events.push(...(suggestion.events as RestEvent[]));

    setText(JSON.stringify(next, null, 2));
    setSelection(null);
  };

  /**
   * 应用按参考修正记谱方案：仅切换该小节 measures 中拟修改叶事件的 type，
   * 分母、附点、连音结构、referenceMeasures 与其他小节保持不变，更新输入 JSON 后自动重新校对。
   */
  const applyFix = (measureIndex: number) => {
    if (!parsed.ok || !report || !report.notationFixes) return;
    const fix = report.notationFixes[measureIndex - 1];
    if (!fix || fix.kind !== 'plan' || fix.changes.length === 0) return;

    // 结构化克隆保证其余事件、referenceMeasures 与其他小节完全不变
    const next: ScoreInput = structuredClone(parsed.value as ScoreInput);
    const target = next.measures[measureIndex - 1];
    for (const change of fix.changes) {
      const leaf = getLeaf(target.events, change.path);
      if (!leaf) return;
      if (change.to === 'note') (leaf as NoteEvent).type = 'note';
      else (leaf as RestEvent).type = 'rest';
    }

    setText(JSON.stringify(next, null, 2));
    setSelection(null);
  };

  return (
    <div className="page">
      <header>
        <h1>节奏小节校对</h1>
        <p className="subtitle">
          粘贴含拍号与逐小节事件树的 JSON，按精确分数核算每个小节的应有 /
          实际时值；可提供参考演奏，逐小节对照发声轮廓并按参考修正记谱
        </p>
      </header>

      <main>
        <section className="panel editor-panel">
          <div className="panel-head">
            <h2>输入 JSON</h2>
            <div className="actions">
              <button onClick={() => setText(EXAMPLE_JSON)}>载入示例</button>
              <button
                onClick={() => {
                  if (parsed.ok) setText(JSON.stringify(parsed.value, null, 2));
                }}
                disabled={!parsed.ok}
              >
                格式化
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="在此粘贴 JSON…"
          />
        </section>

        <section className="panel result-panel">
          <div className="panel-head">
            <h2>校对结果</h2>
            {ts && report && (
              <span className="ts">
                拍号 {ts.numerator}/{ts.denominator} · 共 {report.measures.length} 小节
                {report.reference !== null && ' · 含参考演奏对照'}
              </span>
            )}
          </div>

          {!parsed.ok && (
            <div className="alert alert-error">
              <strong>JSON 解析失败</strong>
              <pre>{parsed.message}</pre>
            </div>
          )}

          {parsed.ok && errors.length > 0 && (
            <div className="alert alert-error">
              <strong>发现 {errors.length} 处非法输入</strong>
              <ul className="error-list">
                {errors.map((err, i) => (
                  <li key={i}>
                    <code>{err.path}</code>
                    <span>{err.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed.ok && errors.length === 0 && report && (
            <div className="measures">
              {report.reference === null
                ? report.measures.map((r) => (
                    <MeasureCard
                      key={r.index}
                      report={r}
                      suggestion={scoreSuggestions![r.index - 1]}
                      selected={isSelected(r.index, 'score')}
                      onTogglePreview={() => togglePreview(r.index, 'score')}
                      onApply={() => applySuggestion(r.index, 'score')}
                    />
                  ))
                : report.measures.map((r, i) => (
                    <CompareCard
                      key={r.index}
                      score={r}
                      reference={report.reference![i]}
                      comparison={report.comparisons![i]}
                      fix={report.notationFixes![i]}
                      scoreEvents={(parsed.value as ScoreInput).measures[i].events}
                      scoreSuggestion={scoreSuggestions![i]}
                      referenceSuggestion={referenceSuggestions![i]}
                      selectedSide={
                        selection?.kind === 'rest' && selection.measureIndex === r.index
                          ? selection.side
                          : null
                      }
                      fixSelected={
                        selection?.kind === 'fix' && selection.measureIndex === r.index
                      }
                      onTogglePreview={(side) => togglePreview(r.index, side)}
                      onApply={(side) => applySuggestion(r.index, side)}
                      onToggleFixPreview={() => toggleFixPreview(r.index)}
                      onApplyFix={() => applyFix(r.index)}
                    />
                  ))}
            </div>
          )}
        </section>
      </main>

      <section className="panel docs">
        <h2>格式说明</h2>
        <div className="docs-grid">
          <div>
            <h3>顶层结构</h3>
            <pre>{`{
  "timeSignature": {
    "numerator": 4,      // 拍号分子，正整数
    "denominator": 4     // 拍号分母，限 ${ALLOWED_DENOMINATORS.join('/')}
  },
  "measures": [
    { "events": [ /* 事件… */ ] }
  ],
  // 可选：参考演奏，小节数须与 measures 相同
  "referenceMeasures": [
    { "events": [ /* 事件… */ ] }
  ]
}`}</pre>
            <h3>时值规则</h3>
            <ul>
              <li>
                时值以全音符为 1；<code>denominator</code> 表示全音符的几分之一，限{' '}
                {ALLOWED_DENOMINATORS.join('、')}。
              </li>
              <li>
                <code>dot: true</code> 表示带一个附点，时值 ×3/2；可省略（无附点）。
              </li>
              <li>
                连音组内各事件时值之和 × <code>inTimeOf</code>/<code>actual</code>
                （占用数/实际数），最多 {MAX_TUPLET_DEPTH} 层嵌套。
              </li>
              <li>
                拍号分子、连音的 <code>actual</code> 与 <code>inTimeOf</code> 必须为正整数。
              </li>
              <li>小节应有时值 = 拍号分子 / 拍号分母。</li>
            </ul>
          </div>
          <div>
            <h3>三种事件</h3>
            <pre>{`// 音符（附点可省略）
{ "type": "note", "denominator": 4, "dot": true }

// 休止符
{ "type": "rest", "denominator": 8 }

// 连音组（可嵌套，最多 ${MAX_TUPLET_DEPTH} 层）
{
  "type": "tuplet",
  "actual": 3,     // 实际数，正整数
  "inTimeOf": 2,   // 占用数，正整数
  "events": [ /* 子事件… */ ]
}`}</pre>
            <h3>结果解读</h3>
            <ul>
              <li>逐小节给出应有时值、实际时值与差值（不足 / 超出量）。</li>
              <li>
                超出时定位首个越界叶事件的树路径，如 <code>measures[1].events[2]</code>。
              </li>
              <li>
                不足时按精确分数计算缺口，给出休止符补全建议：仅用允许的普通 / 单附点休止符，
                精确组成缺口，且事件数最少（相同时较长时值优先、降序排列）；可单个预览后应用，
                休止符会追加到该小节 <code>events</code> 末尾并重新校对。
              </li>
              <li>缺口无法用允许休止符精确组成时，显示缺口原值与「不可补足」提示，不做近似。</li>
              <li>非法输入会逐条指出树路径与原因。</li>
            </ul>
            <h3>参考演奏对照</h3>
            <ul>
              <li>
                提供 <code>referenceMeasures</code> 后逐小节对照：两侧分别核算时值，
                任一侧不足或超出时仅显示时值问题，不做对照。
              </li>
              <li>
                两侧时值均正确时，将嵌套连音按沿途倍率展开为精确分数时间段，
                音符视为发声、休止符视为静音。
              </li>
              <li>
                合并相邻同状态片段后比较整小节发声区间，等价的事件拆分
                （如 1/8+1/8 与 1/4）视为一致。
              </li>
              <li>
                轮廓不同则给出最早差异区间的起止时刻、两侧状态（发声 / 静音）
                及两侧原事件树路径；相同则标记「演奏轮廓一致」。
              </li>
              <li>
                轮廓不同的小节给出「按参考修正记谱」：逐叶按精确分数时间区间对齐参考状态，
                仅当每个不一致记谱叶覆盖的参考状态恒定时，生成切换其 type（note/rest）的方案
                ——分母、附点与连音结构不变；列出全部拟修改叶路径与前后类型，
                可预览后应用，仅更新该小节 <code>measures</code> 的对应叶事件并自动重新校对。
              </li>
              <li>
                参考状态在某个记谱叶事件内部变化时，显示该叶路径、区间与参考状态变化明细，
                不提供部分方案；无参考或任一侧时值异常时不提供修正。
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
