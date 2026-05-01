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
  const SECONDS_PER_ROUND = 1.2;
  const totalDuration = totalRounds * SECONDS_PER_ROUND * 1000;

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
    (timestamp: number) => {
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
      animRef.current = requestAnimationFrame(animate);
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
      if (points.length < 2) return { id: p.id, path: '', points };
      let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpx = (prev.x + curr.x) / 2;
        d += ` C ${cpx.toFixed(2)} ${prev.y.toFixed(2)}, ${cpx.toFixed(2)} ${curr.y.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
      }
      return { id: p.id, path: d, points };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, scoreData, totalRounds, minScore, maxScore]);

  const pathLengths = useRef<Record<string, number>>({});

  const getPathReveal = (playerId: string): number => {
    const line = playerLines.find((l) => l.id === playerId);
    if (!line || line.points.length < 2) return 0;
    const first = line.points[0].ri;
    const last = line.points[line.points.length - 1].ri;
    const range = last - first;
    if (range === 0) return 1;
    return Math.min(1, Math.max(0, (progress - first) / range));
  };

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
      .map((p) => ({ id: p.id, dotY: yForScore(getScoreAt(p.id, progress)) }));
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
  }, [players, progress, getScoreAt, isActiveAt, minScore, maxScore]);

  const displayedLabelYRef = useRef<Record<string, number>>({});
  const LABEL_SMOOTHING = 0.22;
  const labelPositions: Record<string, number> = {};
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
        style={{ height: 'auto', maxHeight: '360px' }}
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

        {playerLines.map((line) => {
          const reveal = getPathReveal(line.id);
          return (
            <path
              key={`fg-${line.id}`}
              d={line.path}
              fill="none"
              stroke={playerColors[line.id]}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              ref={(el) => {
                if (el && !pathLengths.current[line.id]) {
                  pathLengths.current[line.id] = el.getTotalLength();
                }
              }}
              strokeDasharray={pathLengths.current[line.id] || 1000}
              strokeDashoffset={
                (pathLengths.current[line.id] || 1000) * (1 - reveal)
              }
              style={{ opacity: reveal > 0 ? 1 : 0 }}
            />
          );
        })}

        {players.map((p) => {
          if (!isActiveAt(p.id, progress)) return null;
          const rawScore = getScoreAt(p.id, progress);
          const displayScore = Math.round(rawScore);
          const x = xForRound(Math.min(progress, totalRounds));
          const dotY = yForScore(rawScore);
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
