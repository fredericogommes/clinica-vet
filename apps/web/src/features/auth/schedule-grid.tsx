/**
 * Grade de aprazamento estilizada (24 horas × medicações), referência visual à prescrição
 * da internação. É decorativa: os horários marcados são fixos e não representam dados.
 */
const rows = [[0, 6, 12, 18], [2, 10, 18], [8, 20], [0, 4, 8, 12, 16, 20], [7, 19], [9]];

export function ScheduleGrid() {
  const cell = 14;
  const gap = 4;
  const width = 24 * (cell + gap);
  const height = rows.length * (cell + gap);
  return (
    <svg
      viewBox={`-12 0 ${width + 12} ${height + 18}`}
      className="w-full max-w-[440px]"
      aria-hidden
      focusable="false"
    >
      {rows.map((marks, r) =>
        Array.from({ length: 24 }, (_, h) => {
          const marked = marks.includes(h);
          return (
            <rect
              key={`${r}-${h}`}
              x={h * (cell + gap)}
              y={r * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              fill={marked ? (r === 3 ? '#c98a1b' : '#d9e7e0') : 'rgba(217,231,224,0.08)'}
            />
          );
        }),
      )}
      {[0, 6, 12, 18].map((h) => (
        <text
          key={h}
          x={h * (cell + gap) + cell / 2}
          y={height + 14}
          textAnchor="middle"
          fontFamily="IBM Plex Mono, monospace"
          fontSize="10"
          fill="rgba(217,231,224,0.55)"
        >
          {String(h).padStart(2, '0')}h
        </text>
      ))}
    </svg>
  );
}
