export function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <div className="spark empty" />;
  const w = 220;
  const h = 44;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? "var(--kick)" : "var(--danger)"} strokeWidth="2" />
    </svg>
  );
}
