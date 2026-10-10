import type { Locale } from '@/lib/i18n/messages';
import type { getT } from '@/lib/i18n/server';
import type { Usage, UsageItem } from './estimate';
import { usageAmounts } from './format';

type T = Awaited<ReturnType<typeof getT>>;

const FILL: Record<UsageItem['level'], string> = { ok: 'bg-good', warn: 'bg-warn', over: 'bg-pen' };

export function UsageMeter({ usage, t, locale }: { usage: Usage | null; t: T; locale: Locale }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{t('usage.title')}</h2>
      {usage === null ? (
        <p className="text-muted">{t('usage.unavailable')}</p>
      ) : (
        <div className="card flex flex-col gap-5 p-5">
          <p className="text-sm text-muted">{t('usage.note')}</p>
          {usage.items.map((item) => {
            const label = t(`usage.${item.key}`);
            const pct = Math.min(100, item.ratio * 100);
            const amounts = usageAmounts(item, locale);
            const levelText = item.level === 'ok' ? null : t(item.level === 'over' ? 'usage.over' : 'usage.warn');
            return (
              <div key={item.key} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{label}</span>
                  <span className="text-sm tabular-nums text-muted">{amounts}</span>
                </div>
                <div
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.round(item.ratio * 100))}
                  aria-valuetext={levelText ? `${amounts}, ${levelText}` : amounts}
                  aria-label={label}
                  className="h-2.5 overflow-hidden rounded-full bg-surface-2"
                >
                  <div className={`h-full rounded-full ${FILL[item.level]}`} style={{ width: `${pct}%` }} />
                </div>
                {levelText && (
                  <p className={`text-sm font-medium ${item.level === 'over' ? 'text-pen' : 'text-ink'}`}>{levelText}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
