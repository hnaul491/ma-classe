import type { Locale } from '@/lib/i18n/messages';
import type { getT } from '@/lib/i18n/server';
import { FREE_LIMITS, type Usage, type UsageItem } from './estimate';

type T = Awaited<ReturnType<typeof getT>>;

const FILL: Record<UsageItem['level'], string> = { ok: 'bg-good', warn: 'bg-hl', over: 'bg-pen' };

function amounts(item: UsageItem, locale: Locale): string {
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  switch (item.key) {
    case 'minutes':
      return `${int.format(item.used)} / ${int.format(FREE_LIMITS.participantMinutes)} min`;
    case 'data':
      return `${one.format(item.used / 1e9)} / ${int.format(FREE_LIMITS.downstreamBytes / 1e9)} GB`;
    case 'storage':
      return `${int.format(item.used / 1024 ** 2)} MB / 1 GB`;
  }
}

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
            return (
              <div key={item.key} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{label}</span>
                  <span className="text-sm tabular-nums text-muted">{amounts(item, locale)}</span>
                </div>
                <div
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.round(item.ratio * 100))}
                  aria-label={label}
                  className="h-2.5 overflow-hidden rounded-full bg-surface-2"
                >
                  <div className={`h-full rounded-full ${FILL[item.level]}`} style={{ width: `${pct}%` }} />
                </div>
                {item.level !== 'ok' && (
                  <p className={`text-sm font-medium ${item.level === 'over' ? 'text-pen' : 'text-ink'}`}>
                    {t(item.level === 'over' ? 'usage.over' : 'usage.warn')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
