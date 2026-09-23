import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import type { RoomDoc } from '../lib/types';

type Player = { id: string; name: string };

const LINE_COLORS = [
  '#e6cc80',
  '#7dd3fc',
  '#86efac',
  '#fca5a5',
  '#c4b5fd',
  '#fdba74',
  '#f9a8d4',
  '#67e8f9',
  '#fde047',
  '#a5b4fc',
];

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/*
 * Each line segment is a cubic with horizontal tangents at both data
 * points (control points at the segment's mid-x). For that curve:
 *   x(t) = x0 + (x1 - x0) * (1.5t(1-t) + t^3)   (monotonic in t)
 *   y(t) = y0 + (y1 - y0) * t^2(3 - 2t)
 * The replay's x moves linearly with progress, so the tip of the line at
 * a given progress is the curve point whose x matches, found by solving
 * the first equation for t. Everything at the tip (the visible end of
 * the line, the dot, the label, the score) is then read from that one
 * point. Previously the line was trimmed with stroke-dasharray, i.e. as
 * a fraction of ARC LENGTH, while the dot moved linearly in x with an
 * eased score. Steep segments are longer, so the dot ran ahead of or
 * behind the tip and sat off the curve. Same fix as the scorekeeper's
 * BarChartRace (2026-09-10); keep the two in lockstep.
 */
function solveCurveT(u: number): number {
  // Invert x-fraction u in [0,1] to t (bisection; g is strictly increasing).
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    const g = 1.5 * mid * (1 - mid) + mid * mid * mid;
    if (g < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const fmt = (n: number) => n.toFixed(2);
function segmentString(x0: number, y0: number, x1: number, y1: number): string {
  const m = (x0 + x1) / 2;
  return ` C ${fmt(m)} ${fmt(y0)}, ${fmt(m)} ${fmt(y1)}, ${fmt(x1)} ${fmt(y1)}`;
}
// De Casteljau split of the segment at t: the partial curve's command
// string and its end point (the tip).
function partialSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
): { cmd: string; x: number; y: number } {
  const m = (x0 + x1) / 2;
  type Pt = [number, number];
  const P: Pt[] = [[x0, y0], [m, y0], [m, y1], [x1, y1]];
  const L = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const A = L(P[0], P[1]);
  const B = L(P[1], P[2]);
  const C = L(P[2], P[3]);
  const AB = L(A, B);
  const BC = L(B, C);
  const tip = L(AB, BC);
  return {
    cmd: ` C ${fmt(A[0])} ${fmt(A[1])}, ${fmt(AB[0])} ${fmt(AB[1])}, ${fmt(tip[0])} ${fmt(tip[1])}`,
    x: tip[0],
    y: tip[1],
  };
}

type Props = {
  room: RoomDoc;
  // Delay before auto-play kicks in. Defaults to 1.2s to match the scorekeeper.
  autoStartDelayMs?: number;
};

type CompletedRound = {
  roundNumber: number;
  scores: Record<string, number>;
};

function pickStep(range: number): number {
  const target = range / 4;
  const candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  for (const c of candidates) if (c >= target) return c;
  return candidates[candidates.length - 1];
}

export function ScoreLineGraph({ room, autoStartDelayMs = 1200 }: Props) {
  // Derive per-round deltas from the game log.
  const completedRounds = useMemo<CompletedRound[]>(() => {
    const out: CompletedRound[] = [];
    for (const entry of room.log) {
      if (entry.t === 'roundScore') {
        out.push({ roundNumber: entry.round, scores: entry.scores });
      }
    }
    return out;
  }, [room.log]);

  const players = useMemo<Player[]>(
    () => room.playerOrder.map((name) => ({ id: name, name })),
    [room.playerOrder],
  );

  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startProgressRef = useRef(0);

  const totalRounds = completedRounds.length;
  // 1.2 s a round, but never longer than 5 s in total: a 15-round game
  // used to replay for 18 s (Jorge, 2026-09-22). Short games keep their
  // pace, long ones just move faster.
  const SECONDS_PER_ROUND = 1.2;
  const REPLAY_MAX_MS = 5000;
  const totalDuration = Math.min(REPLAY_MAX_MS, totalRounds * SECONDS_PER_ROUND * 1000);

  const playerColors = useMemo(() => {
    const colors: Record<string, string> = {};
    players.forEach((p, i) => {
      colors[p.id] = LINE_COLORS[i % LINE_COLORS.length];
    });
    return colors;
  }, [players]);

  // scoreData[0] = starting (0). scoreData[i] = after round i applied.
  const scoreData = useMemo(() => {
    const data: Array<{
      scores: Record<string, number>;
      activePlayers: string[];
    }> = [];
    const totals: Record<string, number> = {};
    for (const p of players) totals[p.id] = 0;

    data.push({
      scores: { ...totals },
      activePlayers: players.map((p) => p.id),
    });

    for (let ri = 0; ri < completedRounds.length; ri++) {
      const round = completedRounds[ri];
      for (const p of players) {
        if (round.scores[p.id] !== undefined) {
          totals[p.id] = (totals[p.id] || 0) + round.scores[p.id];
        }
      }
      data.push({
        scores: { ...totals },
        activePlayers: players.map((p) => p.id),
      });
    }
    return data;
  }, [players, completedRounds]);

  const { minScore, maxScore } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const entry of scoreData) {
      for (const id of entry.activePlayers) {
        const s = entry.scores[id];
        if (s !== undefined) {
          if (s < min) min = s;
          if (s > max) max = s;
        }
      }
    }
    const pad = Math.max(10, Math.ceil((max - min) * 0.08));
    return { minScore: min - pad, maxScore: max + pad };
  }, [scoreData]);

  const getScoreAt = useCallback(
    (playerId: string, t: number): number => {
      if (scoreData.length === 0) return 0;
      if (t <= 0) return scoreData[0].scores[playerId] ?? 0;
      if (t >= scoreData.length - 1)
        return scoreData[scoreData.length - 1].scores[playerId] ?? 0;
      const i = Math.floor(t);
      const frac = t - i;
      const curr = scoreData[i].scores[playerId];
      const next = scoreData[i + 1].scores[playerId];
      if (curr === undefined && next === undefined) return 0;
      if (curr === undefined) return next;
      if (next === undefined) return curr;
      const e = easeInOut(frac);
      return curr + (next - curr) * e;
    },
    [scoreData],
  );

  const isActiveAt = useCallback(
    (playerId: string, t: number): boolean => {
      const i = Math.min(scoreData.length - 1, Math.max(0, Math.floor(t)));
      return scoreData[i]?.activePlayers.includes(playerId) ?? false;
    },
    [scoreData],
  );

  const animate = useCallback(
    // Named function expression so the rAF callback can re-schedule
    // itself without depending on the outer `animate` binding (which
    // the lint sees as a TDZ reference inside its own initializer).
    function tick(timestamp: number) {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const newProgress =
        startProgressRef.current + (elapsed / totalDuration) * totalRounds;
      if (newProgress >= totalRounds) {
        setProgress(totalRounds);
        setIsPlaying(false);
        return;
      }
      setProgress(newProgress);
      animRef.current = requestAnimationFrame(tick);
    },
    [totalDuration, totalRounds],
  );

  useEffect(() => {
    if (isPlaying) {
      startTimeRef.current = null;
      startProgressRef.current = progress;
      animRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, animate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProgress(0);
      setIsPlaying(true);
    }, autoStartDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoStartDelayMs]);

  const currentRoundLabel = Math.min(
    totalRounds,
    Math.max(0, Math.round(progress)),
  );
  const isFinished = progress >= totalRounds;

  function handlePlayPause() {
    if (isFinished) {
      setProgress(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  }

  function handleSkip() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setProgress(totalRounds);
    setIsPlaying(false);
  }

  const svgWidth = 320;
  const svgHeight = 220;
  const leftPad = 0;
  const rightPad = 45;
  const topPad = 24;
  const bottomPad = 18;
  const chartWidth = svgWidth - leftPad - rightPad;
  const chartHeight = svgHeight - topPad - bottomPad;

  const xForRound = (ri: number) =>
    leftPad + (ri / Math.max(1, totalRounds)) * chartWidth;
  const scoreRange = Math.max(1, maxScore - minScore);
  const yForScore = (score: number) =>
    topPad + ((maxScore - score) / scoreRange) * chartHeight;

  const playerLines = useMemo(() => {
    return players.map((p) => {
      const points: Array<{ x: number; y: number; ri: number; score: number }> =
        [];
      for (let ri = 0; ri < scoreData.length; ri++) {
        const entry = scoreData[ri];
        if (!entry.activePlayers.includes(p.id)) continue;
        const score = entry.scores[p.id];
        if (score === undefined) continue;
        points.push({ x: xForRound(ri), y: yForScore(score), ri, score });
      }
      if (points.length < 2) return { id: p.id, points, segs: [] as string[] };
      // One cubic command per segment; the revealed path is a prefix of
      // these plus a split of the segment the tip is on.
      const segs: string[] = [];
      for (let i = 1; i < points.length; i++) {
        segs.push(
          segmentString(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y),
        );
      }
      return { id: p.id, points, segs };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, scoreData, totalRounds, minScore, maxScore]);

  // The tip of every line at the current progress: the revealed path
  // (cut exactly there), the point itself, and the score at that point.
  type Tip = { path: string; x: number; y: number; score: number };
  const tips = useMemo(() => {
    const out: Record<string, Tip> = {};
    for (const line of playerLines) {
      const { points, segs } = line;
      if (points.length < 2) continue;
      const first = points[0];
      const last = points[points.length - 1];
      const head = `M ${fmt(first.x)} ${fmt(first.y)}`;
      if (progress <= first.ri) {
        out[line.id] = { path: head, x: first.x, y: first.y, score: first.score };
        continue;
      }
      if (progress >= last.ri) {
        out[line.id] = {
          path: head + segs.join(''),
          x: last.x,
          y: last.y,
          score: last.score,
        };
        continue;
      }
      let i = 1;
      while (i < points.length - 1 && points[i].ri <= progress) i++;
      const a = points[i - 1];
      const b = points[i];
      const u = (progress - a.ri) / (b.ri - a.ri);
      const t = solveCurveT(u);
      const part = partialSegment(a.x, a.y, b.x, b.y, t);
      out[line.id] = {
        path: head + segs.slice(0, i - 1).join('') + part.cmd,
        x: part.x,
        y: part.y,
        score: a.score + (b.score - a.score) * easeInOut(t),
      };
    }
    return out;
  }, [playerLines, progress]);

  const gridLines = useMemo(() => {
    const step = pickStep(scoreRange);
    const lines: number[] = [];
    const start = Math.ceil(minScore / step) * step;
    for (let v = start; v <= maxScore; v += step) lines.push(v);
    return lines;
  }, [minScore, maxScore, scoreRange]);

  const LABEL_BLOCK_HEIGHT = 22;
  const targetLabelPositions = useMemo(() => {
    const active = players
      .filter((p) => isActiveAt(p.id, progress))
      .map((p) => {
        const tip = tips[p.id];
        const dotY = tip ? tip.y : yForScore(getScoreAt(p.id, progress));
        return { id: p.id, dotY };
      });
    if (active.length === 0) return {} as Record<string, number>;
    active.sort((a, b) => a.dotY - b.dotY);
    const positions: Record<string, number> = {};
    const ordered: string[] = [];
    let prevLabelY = -Infinity;
    for (const p of active) {
      let labelY = p.dotY - 4;
      if (labelY < prevLabelY + LABEL_BLOCK_HEIGHT) {
        labelY = prevLabelY + LABEL_BLOCK_HEIGHT;
      }
      positions[p.id] = labelY;
      ordered.push(p.id);
      prevLabelY = labelY;
    }
    const chartTop = 4;
    const chartBottom = svgHeight - 4;
    const lastLabelBottom = positions[ordered[ordered.length - 1]] + 10;
    if (lastLabelBottom > chartBottom) {
      const overflow = lastLabelBottom - chartBottom;
      for (const id of ordered) positions[id] -= overflow;
    }
    const firstLabelTop = positions[ordered[0]];
    if (firstLabelTop < chartTop) {
      const underflow = chartTop - firstLabelTop;
      for (const id of ordered) positions[id] += underflow;
    }
    return positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, progress, tips, getScoreAt, isActiveAt, minScore, maxScore]);

  const displayedLabelYRef = useRef<Record<string, number>>({});
  const LABEL_SMOOTHING = 0.22;
  const labelPositions: Record<string, number> = {};
  // Label-position smoothing has to happen during render — pulling it
  // into an effect would lag a frame behind the chart, which is what
  // the earlier CSS-transition approach got wrong. The ref is mutated
  // here on purpose; values are committed for the next frame to read.
  for (const p of players) {
    const target = targetLabelPositions[p.id];
    if (target === undefined) {
      delete displayedLabelYRef.current[p.id];
      continue;
    }
    const curr = displayedLabelYRef.current[p.id];
    let next: number;
    if (curr === undefined) {
      next = target;
    } else {
      next = curr + (target - curr) * LABEL_SMOOTHING;
      if (Math.abs(next - target) < 0.3) next = target;
    }
    displayedLabelYRef.current[p.id] = next;
    labelPositions[p.id] = next;
  }

  if (totalRounds === 0) return null;

  return (
    <div className="card-gold p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-gold-200 text-sm font-medium">Game replay</h3>
          <p className="text-navy-200/60 text-xs">
            {currentRoundLabel === 0
              ? `Start of game · ${totalRounds} rounds`
              : `Round ${currentRoundLabel} of ${totalRounds}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePlayPause}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-navy-600/60 text-white active:bg-navy-500/60 text-sm"
          >
            {isFinished ? '↺' : isPlaying ? '⏸' : '▶'}
          </button>
          {!isFinished && (
            <button
              type="button"
              onClick={handleSkip}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-navy-600/60 text-white active:bg-navy-500/60 text-sm"
            >
              ⏭
            </button>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        style={{ height: 'auto', maxHeight: '360px', overflow: 'visible' }}
      >
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={leftPad}
              x2={leftPad + chartWidth}
              y1={yForScore(v)}
              y2={yForScore(v)}
              stroke={v === 0 ? '#e6cc80' : '#8a7a40'}
              strokeOpacity={v === 0 ? 0.35 : 0.15}
              strokeWidth={v === 0 ? 0.8 : 0.5}
              strokeDasharray={v === 0 ? '' : '2 3'}
            />
            <text
              x={leftPad + 2}
              y={yForScore(v) - 2}
              fill="#8a8a8a"
              fontSize="8"
              fontWeight="500"
              opacity="0.7"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Lines, each cut exactly at its tip for the current progress. */}
        {playerLines.map((line) => {
          const tip = tips[line.id];
          if (!tip) return null;
          return (
            <path
              key={`fg-${line.id}`}
              d={tip.path}
              fill="none"
              stroke={playerColors[line.id]}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {players.map((p) => {
          if (!isActiveAt(p.id, progress)) return null;
          const tip = tips[p.id];
          // Single-point lines (a player with one data point) have no
          // curve to sit on: fall back to the interpolated position.
          const rawScore = tip ? tip.score : getScoreAt(p.id, progress);
          const displayScore = Math.round(rawScore);
          const x = tip ? tip.x : xForRound(Math.min(progress, totalRounds));
          const dotY = tip ? tip.y : yForScore(rawScore);
          const labelY = labelPositions[p.id] ?? dotY - 4;
          const labelCenterY = labelY + 5;
          const dotToLabelOffset = Math.abs(labelCenterY - dotY);
          const needsConnector = dotToLabelOffset > 7;

          return (
            <g key={p.id}>
              {needsConnector && (
                <line
                  x1={x + 5}
                  y1={dotY}
                  x2={x + 10}
                  y2={labelCenterY}
                  stroke={playerColors[p.id]}
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
              )}
              <circle
                cx={x}
                cy={dotY}
                r="5"
                fill={playerColors[p.id]}
                stroke="#0e1a38"
                strokeWidth="1.5"
              />
              <text
                x={x + 10}
                y={labelY}
                fill={playerColors[p.id]}
                fontSize="10"
                fontWeight="600"
                dominantBaseline="auto"
              >
                {p.name}
              </text>
              <text
                x={x + 10}
                y={labelY + 10}
                fill="#b0b8c8"
                fontSize="9"
                fontWeight="500"
                dominantBaseline="auto"
              >
                {displayScore}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
