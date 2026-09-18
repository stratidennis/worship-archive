import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { AppHeader } from '../components/AppHeader.js';
import { Page, Scroll } from '../components/Page.js';
import { Segment, Segmented } from '../components/ui.js';
import { Wordmark } from '../components/Logo.js';

/**
 * How everyone else gets in.
 *
 * Three mechanisms, because each fails differently and a failure during a service is
 * expensive:
 *
 *  1. **QR code** — the one people actually use. No typing, and it cannot fail
 *     silently; if the camera reads it, the address is right.
 *  2. **The machine's `.local` name** — macOS and Windows advertise it themselves, so
 *     it usually just works. Some networks drop multicast, and then it silently does not.
 *  3. **The raw IP** — ugly and always correct. Every address is listed rather than
 *     guessed, because a laptop on both WiFi and Ethernet has two and only one of them
 *     is the network the band is on.
 */
export function JoinPage() {
  const { t } = useT();
  const [host, setHost] = useState<{
    addresses: string[];
    port: number;
    hostname: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [path, setPath] = useState('/band');

  useEffect(() => {
    api
      .host()
      .then(setHost)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  // The address in the browser's own bar is the one that demonstrably works from here;
  // prefer it, and fall back to what the host reports.
  const url = useMemo(() => {
    const fromBrowser =
      location.host && !location.host.startsWith('localhost')
        ? `${location.protocol}//${location.host}`
        : host
          ? `http://${host.addresses[0] ?? host.hostname}:${host.port}`
          : null;
    return fromBrowser ? `${fromBrowser}${path}` : null;
  }, [host, path]);

  useEffect(() => {
    if (!url) return;
    void QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  return (
    <Page>
      <AppHeader back />
      <Scroll>
        <div className="mx-auto max-w-2xl px-4 py-8">
          {/* The one screen someone sees before they have any idea what this is: they
              are standing in a room being handed a QR code. */}
          <Wordmark className="mb-5 h-8" />
          <h1 className="text-2xl font-bold">{t('join.title')}</h1>
          <p className="mt-1 text-sm text-(--color-muted)">{t('join.subtitle')}</p>

          <Segmented label={t('join.title')} className="mt-5">
            {(
              [
                ['/band', t('app.band')],
                ['/stage', t('app.stage')],
                ['/archive', t('app.library')],
              ] as const
            ).map(([value, label]) => (
              <Segment
                key={value}
                active={path === value}
                aria-pressed={path === value}
                onClick={() => setPath(value)}
              >
                {label}
              </Segment>
            ))}
          </Segmented>

          {qr && (
            <div className="mt-5 flex flex-col items-center gap-3">
              {/* White plate: a QR on a dark background is unreadable to many cameras. */}
              <img
                src={qr}
                alt={t('join.qrAlt', { url: url ?? '' })}
                className="rounded-lg bg-white p-3"
                width={280}
                height={280}
              />
              <code className="text-sm">{url}</code>
            </div>
          )}

          {host && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
                {t('join.orType')}
              </h2>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  <code className="rounded bg-(--color-line) px-1.5 py-0.5">
                    http://{host.hostname}:{host.port}
                    {path}
                  </code>{' '}
                  <span className="text-(--color-muted)">— {t('join.usuallyWorks')}</span>
                </li>
                {host.addresses.map((address) => (
                  <li key={address}>
                    <code className="rounded bg-(--color-line) px-1.5 py-0.5">
                      http://{address}:{host.port}
                      {path}
                    </code>{' '}
                    <span className="text-(--color-muted)">— {t('join.alwaysWorks')}</span>
                  </li>
                ))}
              </ul>
              {host.addresses.length > 1 && (
                <p className="mt-2 text-xs text-(--color-muted)">
                  {t('join.multipleNetworks')}
                </p>
              )}
              {host.addresses.length === 0 && (
                <p className="mt-2 text-xs text-(--color-muted)">{t('join.noNetwork')}</p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-6 text-sm text-(--color-muted)">
              {t('join.readError', { error })}
            </p>
          )}
        </div>
      </Scroll>
    </Page>
  );
}
