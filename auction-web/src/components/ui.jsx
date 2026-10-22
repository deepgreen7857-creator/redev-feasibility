import { VERDICT } from '../lib/analyze.js';

const TONES = {
  now: 'bg-now/10 text-now border-now/30', wait: 'bg-wait/10 text-wait border-wait/30', hard: 'bg-hard/10 text-hard border-hard/30',
  cash: 'bg-cash/10 text-cash border-cash/30', muted: 'bg-ink/5 text-ink/60 border-ink/10', brand: 'bg-brand2 text-brand border-brand/20',
};

export function Badge({ tone = 'muted', children, className = '' }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.muted} ${className}`}>{children}</span>;
}

export function VerdictBadge({ verdict }) {
  const v = VERDICT[verdict] || VERDICT.unknown;
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/50">{hint}</span>}
    </label>
  );
}

export function Row({ k, v, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="text-ink/60">{k}</span>
      <span className={`num text-right ${strong ? 'font-bold' : ''}`}>{v}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink/50">{children}</div>;
}

// 오정민 님 사이트 공통 마크 — JBS LAB
export function JbsMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#0F5E4D" />
      <path d="M10 26.5c1.4 1.6 3 2.4 4.8 2.4 3 0 4.7-1.9 4.7-5.2V11h-3.6v12.5c0 1.4-.6 2.1-1.6 2.1-.8 0-1.5-.4-2.2-1.2L10 26.5Z" fill="#fff" />
      <path d="M22 11h5.6c3.3 0 5.4 1.5 5.4 4.2 0 1.6-.9 2.8-2.2 3.3 1.8.4 2.9 1.8 2.9 3.7 0 3-2.3 4.6-5.8 4.6H22V11Zm3.5 6.3h1.8c1.3 0 2-.6 2-1.6s-.7-1.5-2-1.5h-1.8v3.1Zm0 6.6h2.2c1.4 0 2.2-.6 2.2-1.8 0-1.1-.8-1.7-2.2-1.7h-2.2v3.5Z" fill="#9FE0C9" />
    </svg>
  );
}
