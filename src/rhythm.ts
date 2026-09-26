import { Frac } from './fraction';

export const ALLOWED_DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;
export const MAX_TUPLET_DEPTH = 3;

/* ---------- 输入 JSON 的类型 ---------- */

export interface NoteEvent {
  type: 'note';
  denominator: number;
  dot?: boolean;
}

export interface RestEvent {
  type: 'rest';
  denominator: number;
  dot?: boolean;
}

export interface TupletEvent {
  type: 'tuplet';
  /** 实际数：连音组内实际包含的音符个数基准 */
  actual: number;
  /** 占用数：这些音符占用多少个同类型正常音符的时值 */
  inTimeOf: number;
  events: RhythmEvent[];
}

export type RhythmEvent = NoteEvent | RestEvent | TupletEvent;

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface MeasureInput {
  events: RhythmEvent[];
}

export interface ScoreInput {
  timeSignature: TimeSignature;
  measures: MeasureInput[];
  /** 可选：参考演奏，小节数须与 measures 相同，事件结构同 measures */
  referenceMeasures?: MeasureInput[];
}

/* ---------- 校验 ---------- */

export interface AnalysisError {
  /** 树路径，如 timeSignature.numerator 或 measures[0].events[2].events[1].denominator */
  path: string;
  message: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isAllowedDenominator(v: unknown): v is number {
  return typeof v === 'number' && (ALLOWED_DENOMINATORS as readonly number[]).includes(v);
}

const DENOMINATOR_HINT = `必须是 ${ALLOWED_DENOMINATORS.join('、')} 之一（全音符的几分之一）`;

/**
 * 校验整份输入。所有错误均携带树路径。
 * depth 表示当前事件所在的连音嵌套层数（连音组之外为 0）。
 */
export function validateScore(input: unknown): AnalysisError[] {
  const errors: AnalysisError[] = [];

  if (!isRecord(input)) {
    errors.push({ path: '$', message: '根节点必须是 JSON 对象' });
    return errors;
  }

  const ts = input.timeSignature;
  if (!isRecord(ts)) {
    errors.push({ path: 'timeSignature', message: '必须是对象 { "numerator": 分子, "denominator": 分母 }' });
  } else {
    if (!isPositiveInteger(ts.numerator)) {
      errors.push({ path: 'timeSignature.numerator', message: '拍号分子必须是正整数' });
    }
    if (!isAllowedDenominator(ts.denominator)) {
      errors.push({ path: 'timeSignature.denominator', message: `拍号分母${DENOMINATOR_HINT}` });
    }
  }

  const measures = input.measures;
  if (!Array.isArray(measures) || measures.length === 0) {
    errors.push({ path: 'measures', message: '必须是非空数组，每个元素为一个小节' });
  } else {
    validateMeasureList(measures, 'measures', errors);
  }

  const reference = input.referenceMeasures;
  if (reference !== undefined) {
    if (!Array.isArray(reference) || reference.length === 0) {
      errors.push({
        path: 'referenceMeasures',
        message: '必须是非空数组，每个元素为一个小节；不需要对照时请整体省略该字段',
      });
    } else {
      validateMeasureList(reference, 'referenceMeasures', errors);
      if (Array.isArray(measures) && reference.length !== measures.length) {
        errors.push({
          path: 'referenceMeasures',
          message: `小节数须与 measures 相同（referenceMeasures 为 ${reference.length} 个，measures 为 ${measures.length} 个）`,
        });
      }
    }
  }

  return errors;
}

function validateMeasureList(list: unknown[], basePath: string, errors: AnalysisError[]): void {
  list.forEach((m, mi) => {
    const mPath = `${basePath}[${mi}]`;
    if (!isRecord(m) || !Array.isArray(m.events)) {
      errors.push({ path: mPath, message: '每个小节必须是含 events 数组的对象' });
      return;
    }
    if (m.events.length === 0) {
      errors.push({ path: `${mPath}.events`, message: '小节至少包含一个事件' });
    }
    m.events.forEach((e, ei) => validateEvent(e, `${mPath}.events[${ei}]`, 0, errors));
  });
}

function validateEvent(node: unknown, path: string, depth: number, errors: AnalysisError[]): void {
  if (!isRecord(node)) {
    errors.push({ path, message: '事件必须是对象' });
    return;
  }

  switch (node.type) {
    case 'note':
    case 'rest': {
      const label = node.type === 'note' ? '音符' : '休止符';
      if (!isAllowedDenominator(node.denominator)) {
        errors.push({ path: `${path}.denominator`, message: `${label}分母${DENOMINATOR_HINT}` });
      }
      if (node.dot !== undefined && typeof node.dot !== 'boolean') {
        errors.push({ path: `${path}.dot`, message: '附点标记 dot 必须是布尔值（可省略，省略表示无附点）' });
      }
      break;
    }
    case 'tuplet': {
      const nextDepth = depth + 1;
      if (nextDepth > MAX_TUPLET_DEPTH) {
        errors.push({ path, message: `连音组嵌套最多允许 ${MAX_TUPLET_DEPTH} 层` });
      }
      if (!isPositiveInteger(node.actual)) {
        errors.push({ path: `${path}.actual`, message: '连音实际数 actual 必须是正整数' });
      }
      if (!isPositiveInteger(node.inTimeOf)) {
        errors.push({ path: `${path}.inTimeOf`, message: '连音占用数 inTimeOf 必须是正整数' });
      }
      if (!Array.isArray(node.events) || node.events.length === 0) {
        errors.push({ path: `${path}.events`, message: '连音组必须包含非空 events 数组' });
      } else {
        node.events.forEach((e, i) => validateEvent(e, `${path}.events[${i}]`, nextDepth, errors));
      }
      break;
    }
    default:
      errors.push({
        path: `${path}.type`,
        message: `未知事件类型 ${JSON.stringify(node.type)}，应为 "note" / "rest" / "tuplet"`,
      });
  }
}

/* ---------- 时值计算 ---------- */

export type MeasureStatus = 'ok' | 'short' | 'over';

export interface MeasureReport {
  /** 小节序号（从 1 开始，用于展示） */
  index: number;
  /** 应有时值（拍号分子/分母，以全音符为 1） */
  expected: Frac;
  /** 实际时值 */
  actual: Frac;
  /** 实际 - 应有 */
  diff: Frac;
  status: MeasureStatus;
  /** 超出时，首个越界叶事件的树路径；否则为 null */
  overflowPath: string | null;
}

/** 叶事件（音符/休止符）时值：1/denominator，附点 ×3/2 */
function leafDuration(node: NoteEvent | RestEvent): Frac {
  const base = Frac.of(1, node.denominator);
  return node.dot ? base.mul(Frac.of(3, 2)) : base;
}

/** 事件时值：连音组 = 组内时值之和 × 占用数/实际数（递归） */
function eventDuration(node: RhythmEvent): Frac {
  if (node.type === 'tuplet') {
    const inner = node.events.reduce<Frac>((acc, e) => acc.add(eventDuration(e)), Frac.zero());
    return inner.mul(Frac.of(node.inTimeOf, node.actual));
  }
  return leafDuration(node);
}

/**
 * 按演奏顺序扫描事件，累计时值（连音组内按累计缩放系数折算），
 * 返回首个使累计时值超过 expected 的叶事件树路径。
 */
function findFirstOverflow(
  events: RhythmEvent[],
  expected: Frac,
  acc: Frac,
  scale: Frac,
  basePath: string,
): { overflowPath: string | null; acc: Frac } {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const path = `${basePath}[${i}]`;
    if (e.type === 'tuplet') {
      const innerScale = scale.mul(Frac.of(e.inTimeOf, e.actual));
      const r = findFirstOverflow(e.events, expected, acc, innerScale, `${path}.events`);
      acc = r.acc;
      if (r.overflowPath !== null) return { overflowPath: r.overflowPath, acc };
    } else {
      acc = acc.add(leafDuration(e).mul(scale));
      if (acc.cmp(expected) > 0) return { overflowPath: path, acc };
    }
  }
  return { overflowPath: null, acc };
}

function analyzeMeasures(
  measures: MeasureInput[],
  expected: Frac,
  basePath: string,
): MeasureReport[] {
  return measures.map((m, mi) => {
    const actual = m.events.reduce<Frac>((acc, e) => acc.add(eventDuration(e)), Frac.zero());
    const diff = actual.sub(expected);
    const sign = diff.sign();
    const status: MeasureStatus = sign === 0 ? 'ok' : sign < 0 ? 'short' : 'over';

    let overflowPath: string | null = null;
    if (status === 'over') {
      overflowPath = findFirstOverflow(
        m.events,
        expected,
        Frac.zero(),
        Frac.of(1),
        `${basePath}[${mi}].events`,
      ).overflowPath;
    }

    return { index: mi + 1, expected, actual, diff, status, overflowPath };
  });
}

/* ---------- 演奏轮廓对照 ---------- */

/** 展开后的时间段：音符为发声、休止符为静音 */
export interface Segment {
  /** 段起点（以全音符为 1，从小节起点计） */
  start: Frac;
  /** 段终点（不含） */
  end: Frac;
  /** true = 发声（音符），false = 静音（休止符） */
  sounding: boolean;
  /** 产生该段的叶事件树路径 */
  path: string;
}

/**
 * 将一个小节的事件树按演奏顺序展开为精确分数时间段。
 * 嵌套连音按沿途倍率（inTimeOf/actual 的乘积）缩放叶事件时值。
 * 调用前须保证 validateScore 无错误。
 */
export function expandMeasure(events: RhythmEvent[], basePath: string): Segment[] {
  const segments: Segment[] = [];

  const walk = (list: RhythmEvent[], start: Frac, scale: Frac, path: string): Frac => {
    let acc = start;
    list.forEach((e, i) => {
      const p = `${path}[${i}]`;
      if (e.type === 'tuplet') {
        acc = walk(e.events, acc, scale.mul(Frac.of(e.inTimeOf, e.actual)), `${p}.events`);
      } else {
        const end = acc.add(leafDuration(e).mul(scale));
        segments.push({ start: acc, end, sounding: e.type === 'note', path: p });
        acc = end;
      }
    });
    return acc;
  };

  walk(events, Frac.zero(), Frac.of(1), basePath);
  return segments;
}

/** 合并相邻（首尾相接）且状态相同的片段，忽略等价的事件拆分 */
function mergeSegments(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && last.sounding === s.sounding && last.end.cmp(s.start) === 0) {
      merged[merged.length - 1] = { ...last, end: s.end };
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** 覆盖时刻 t 的原始（未合并）叶事件树路径 */
function pathAt(segments: Segment[], t: Frac): string {
  for (const s of segments) {
    if (s.start.cmp(t) <= 0 && t.cmp(s.end) < 0) return s.path;
  }
  // 片段连续覆盖整小节，理论上不会到达；兜底取最后一段
  return segments.length > 0 ? segments[segments.length - 1].path : '';
}

export type SegmentState = 'sounding' | 'silent';

export interface OutlineDiff {
  /** 最早差异区间起点（含） */
  start: Frac;
  /** 最早差异区间终点（不含） */
  end: Frac;
  scoreState: SegmentState;
  referenceState: SegmentState;
  /** 差异区间起点处，记谱侧的原事件树路径 */
  scorePath: string;
  /** 差异区间起点处，参考侧的原事件树路径 */
  referencePath: string;
}

export type OutlineComparison = { kind: 'match' } | { kind: 'diff'; diff: OutlineDiff };

/**
 * 比较两侧（均已展开的小节）演奏轮廓。
 * 双指针扫描合并后的片段：逐段取较近的终点切出状态恒定区间，
 * 首个状态不一致的区间即最早差异。
 * 调用前提：两侧小节时值均等于拍号（覆盖同一总时长）。
 */
export function compareOutlines(score: Segment[], reference: Segment[]): OutlineComparison {
  const a = mergeSegments(score);
  const b = mergeSegments(reference);

  let i = 0;
  let j = 0;
  let pos = Frac.zero();
  while (i < a.length && j < b.length) {
    const sa = a[i];
    const sb = b[j];
    const next = sa.end.cmp(sb.end) <= 0 ? sa.end : sb.end;
    if (sa.sounding !== sb.sounding) {
      return {
        kind: 'diff',
        diff: {
          start: pos,
          end: next,
          scoreState: sa.sounding ? 'sounding' : 'silent',
          referenceState: sb.sounding ? 'sounding' : 'silent',
          scorePath: pathAt(score, pos),
          referencePath: pathAt(reference, pos),
        },
      };
    }
    if (sa.end.cmp(next) === 0) i++;
    if (sb.end.cmp(next) === 0) j++;
    pos = next;
  }
  return { kind: 'match' };
}

/* ---------- 按参考修正记谱（仅切换叶事件 note/rest 类型） ---------- */

/** 记谱叶事件的类型（音符 / 休止符） */
export type LeafType = 'note' | 'rest';

/** 一处拟修改：将某记谱叶事件的 type 在 note/rest 间切换 */
export interface NotationFixChange {
  /** 叶事件树路径，如 measures[3].events[1].events[2] */
  path: string;
  /** 修改前类型 */
  from: LeafType;
  /** 修改后类型 */
  to: LeafType;
  /** 该叶事件覆盖的时间区间（以全音符为 1，从小节起点计） */
  start: Frac;
  end: Frac;
}

/** 无法仅改类型修正的记谱叶事件：参考状态在其内部发生变化 */
export interface NotationFixBlocker {
  /** 记谱叶事件树路径 */
  path: string;
  /** 该叶事件覆盖的时间区间 */
  start: Frac;
  end: Frac;
  /** 记谱侧状态（发声 / 静音） */
  scoreState: SegmentState;
  /** 区间内参考侧的状态变化片段（按时间顺序，相邻同状态已合并） */
  referenceSegments: { start: Frac; end: Frac; state: SegmentState; paths: string[] }[];
}

export type NotationFix =
  | {
      kind: 'plan';
      /** 全部拟修改叶（覆盖所有不一致叶事件），按时间顺序 */
      changes: NotationFixChange[];
    }
  | {
      kind: 'blocked';
      /** 参考状态在其内部变化的记谱叶事件；存在时不提供任何修改方案 */
      blockers: NotationFixBlocker[];
    };

/** 将区间内按时间排列的参考状态片段合并相邻同状态项（同时收集对应的参考叶路径） */
function mergeStateRuns(
  hits: { start: Frac; end: Frac; sounding: boolean; path: string }[],
): { start: Frac; end: Frac; state: SegmentState; paths: string[] }[] {
  const runs: { start: Frac; end: Frac; state: SegmentState; paths: string[] }[] = [];
  for (const h of hits) {
    const state: SegmentState = h.sounding ? 'sounding' : 'silent';
    const last = runs[runs.length - 1];
    if (last && last.state === state) {
      last.end = h.end;
      if (!last.paths.includes(h.path)) last.paths.push(h.path);
    } else {
      runs.push({ start: h.start, end: h.end, state, paths: [h.path] });
    }
  }
  return runs;
}

/**
 * 为「两侧时值均正确但发声轮廓不同」的小节计算按参考修正记谱的方案。
 * 前提：两侧片段由 expandMeasure 展开且总时值相同（覆盖同一时间范围）。
 *
 * 以精确分数将两侧叶事件按时间区间对齐，逐叶检查记谱侧叶事件覆盖的参考状态：
 * - 恒定时：若与记谱状态不一致，生成将该叶 type 在 note/rest 间切换的修改；
 * - 在其内部变化时：该叶无法仅改类型修正，记入 blockers。
 * 存在 blocker 时返回 blocked（不给部分方案）；否则返回覆盖全部不一致叶的 plan。
 */
export function planNotationFix(scoreSegments: Segment[], referenceSegments: Segment[]): NotationFix {
  const changes: NotationFixChange[] = [];
  const blockers: NotationFixBlocker[] = [];

  for (const leaf of scoreSegments) {
    // 与该记谱叶时间区间相交的参考片段（精确分数求交）
    const hits: { start: Frac; end: Frac; sounding: boolean; path: string }[] = [];
    for (const ref of referenceSegments) {
      if (ref.end.cmp(leaf.start) <= 0 || ref.start.cmp(leaf.end) >= 0) continue;
      hits.push({
        start: ref.start.cmp(leaf.start) > 0 ? ref.start : leaf.start,
        end: ref.end.cmp(leaf.end) < 0 ? ref.end : leaf.end,
        sounding: ref.sounding,
        path: ref.path,
      });
    }
    if (hits.length === 0) continue; // 两侧覆盖同一总时长，理论上不会发生

    const runs = mergeStateRuns(hits);
    if (runs.length > 1) {
      blockers.push({
        path: leaf.path,
        start: leaf.start,
        end: leaf.end,
        scoreState: leaf.sounding ? 'sounding' : 'silent',
        referenceSegments: runs,
      });
    } else if (runs[0].state !== (leaf.sounding ? 'sounding' : 'silent')) {
      changes.push({
        path: leaf.path,
        from: leaf.sounding ? 'note' : 'rest',
        to: leaf.sounding ? 'rest' : 'note',
        start: leaf.start,
        end: leaf.end,
      });
    }
  }

  return blockers.length > 0 ? { kind: 'blocked', blockers } : { kind: 'plan', changes };
}

/* ---------- 不足小节休止符补全建议 ---------- */

const REST_NAME: Record<number, string> = {
  1: '全音符',
  2: '二分音符',
  4: '四分音符',
  8: '八分音符',
  16: '十六分音符',
  32: '三十二分音符',
};

/** 休止符中文名，如「附点四分音符休止符」 */
export function restName(denominator: number, dot: boolean): string {
  return `${dot ? '附点' : ''}${REST_NAME[denominator]}休止符`;
}

interface RestCoin {
  /** 时值：以 1/64 全音符为单位（允许的休止符时值在该单位下均为整数） */
  value: number;
  denominator: number;
  dot: boolean;
}

/** 允许使用的休止符（普通、单附点，分母限 ALLOWED_DENOMINATORS），按时值降序 */
const REST_COINS: RestCoin[] = ALLOWED_DENOMINATORS.map((d) => ({
  plain: { value: 64 / d, denominator: d, dot: false },
  dotted: { value: 96 / d, denominator: d, dot: true },
}))
  .flatMap((p) => [p.dotted, p.plain])
  .sort((a, b) => b.value - a.value);

export interface RestPlanPart {
  denominator: number;
  dot: boolean;
  /** 该种休止符的单个时值（以全音符为 1） */
  duration: Frac;
  /** 使用数量 */
  count: number;
}

export type RestSuggestion =
  | {
      kind: 'plan';
      /** 缺口原值（应有时值 - 实际时值） */
      gap: Frac;
      /** 追加事件总数 */
      eventCount: number;
      /** 按时值降序的分组方案 */
      parts: RestPlanPart[];
      /** 按时值降序展开的休止符事件，可直接追加到 events 末尾 */
      events: RestEvent[];
    }
  | {
      kind: 'impossible';
      /** 缺口原值（无法精确组成时原样展示，不做近似） */
      gap: Frac;
    };

/**
 * 在降序硬币序列中搜索目标值的精确组成：
 * 先保证事件（硬币）总数最少；事件数相同时取较大时值优先
 * （即从最大硬币起计数向量字典序最大）的方案。
 * DFS 按时值从大到小、每种数量从多到少枚举，配合下界剪枝；
 * 等长方案后出现者字典序必更小，直接剪去。无解返回 null。
 */
function solveRestCoins(target: bigint, coins: number[]): number[] | null {
  const n = coins.length;
  const counts = new Array<number>(n).fill(0);
  let best: number[] | null = null;
  let bestCount = Number.POSITIVE_INFINITY;

  const dfs = (idx: number, rem: bigint, used: number): void => {
    if (rem === 0n) {
      if (used < bestCount) {
        bestCount = used;
        best = counts.slice();
      }
      return;
    }
    if (idx === n) return;

    const coin = BigInt(coins[idx]);
    const maxK = Number(rem / coin);
    for (let k = maxK; k >= 0; k--) {
      const nr = rem - BigInt(k) * coin;
      if (nr > 0n && nr < 2n) continue; // 剩余 1（1/64）无法被任何允许休止符组成
      // 剩余部分即使全用当前（剩余序列中最大的）硬币也需要的数量
      const lowerBound = used + k + (nr === 0n ? 0 : Number((nr + coin - 1n) / coin));
      if (lowerBound >= bestCount) continue;
      counts[idx] = k;
      dfs(idx + 1, nr, used + k);
    }
    counts[idx] = 0;
  };

  dfs(0, target, 0);
  return best;
}

/**
 * 为不足小节的缺口生成休止符补全建议。
 * 缺口按精确分数计算；只有能用允许休止符（分母 1/2/4/8/16/32，普通或单附点）
 * 精确组成时才给方案，否则返回 impossible（不给近似方案）。
 */
export function suggestRests(gap: Frac): RestSuggestion {
  // 所有允许休止符时值都是 1/64 的整数倍：缺口必须是 1/64 的整数倍且 ≥ 1/32
  const units = gap.mul(Frac.of(64));
  if (units.den !== 1n || units.num < 2n) return { kind: 'impossible', gap };

  const counts = solveRestCoins(units.num, REST_COINS.map((c) => c.value));
  if (counts === null) return { kind: 'impossible', gap };

  const parts: RestPlanPart[] = [];
  const events: RestEvent[] = [];
  counts.forEach((count, i) => {
    if (count === 0) return;
    const coin = REST_COINS[i];
    const duration = Frac.of(1, coin.denominator).mul(coin.dot ? Frac.of(3, 2) : Frac.of(1));
    parts.push({ denominator: coin.denominator, dot: coin.dot, duration, count });
    for (let j = 0; j < count; j++) {
      events.push(coin.dot ? { type: 'rest', denominator: coin.denominator, dot: true } : { type: 'rest', denominator: coin.denominator });
    }
  });

  return {
    kind: 'plan',
    gap,
    eventCount: events.length,
    parts,
    events,
  };
}

/* ---------- 整谱分析 ---------- */

export interface ScoreReport {
  /** 记谱（measures）逐小节时值报告 */
  measures: MeasureReport[];
  /** 参考演奏（referenceMeasures）逐小节时值报告；未提供参考时为 null */
  reference: MeasureReport[] | null;
  /**
   * 逐小节演奏轮廓对照；未提供参考时为 null。
   * 任一侧时值非 ok 的小节为 null（仅显示时值问题，不做对照）。
   */
  comparisons: (OutlineComparison | null)[] | null;
  /**
   * 逐小节按参考修正记谱的方案；未提供参考时为 null。
   * 任一侧时值非 ok 的小节为 null（时值异常时不提供修正）。
   */
  notationFixes: (NotationFix | null)[] | null;
}

/** 逐小节分析（含可选的参考演奏对照与按参考修正记谱方案）。调用前须保证 validateScore 无错误。 */
export function analyze(score: ScoreInput): ScoreReport {
  const expected = Frac.of(score.timeSignature.numerator, score.timeSignature.denominator);

  const measures = analyzeMeasures(score.measures, expected, 'measures');

  const refMeasures = score.referenceMeasures;
  const reference = refMeasures ? analyzeMeasures(refMeasures, expected, 'referenceMeasures') : null;

  let comparisons: (OutlineComparison | null)[] | null = null;
  let notationFixes: (NotationFix | null)[] | null = null;
  if (reference && refMeasures) {
    comparisons = [];
    notationFixes = [];
    measures.forEach((m, i) => {
      if (m.status !== 'ok' || reference[i].status !== 'ok') {
        comparisons!.push(null);
        notationFixes!.push(null);
        return;
      }
      const scoreSegments = expandMeasure(score.measures[i].events, `measures[${i}].events`);
      const referenceSegments = expandMeasure(
        refMeasures[i].events,
        `referenceMeasures[${i}].events`,
      );
      comparisons!.push(compareOutlines(scoreSegments, referenceSegments));
      notationFixes!.push(planNotationFix(scoreSegments, referenceSegments));
    });
  }

  return { measures, reference, comparisons, notationFixes };
}
