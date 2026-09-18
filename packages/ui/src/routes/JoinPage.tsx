import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { useHeader } from '../components/header-slots.js';
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

  useHeader({ back: true });

  useEffect(() => {
    api
      .host()
      .then(setHost)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  /*
    Which port to hand out.

    The host reports the port it listens on, and in a packaged app that is the only one
    there is. In development it is not: Vite serves the interface on another port and
    proxies the API through, so the host's own number points at a different — and older
    — copy of the app. Whatever is in this browser's address bar is the one that
    demonstrably works, so it wins whenever it is not localhost, and every address on
    this page is built from the same choice. They used to disagree: the QR said one
    port and the list underneath it said another.
  */
  const origin = useMemo(() => {
    const here = location.host && !location.host.startsWith('localhost') ? location : null;
    if (here)
      return {
        protocol: here.protocol,
        port: here.port || (here.protocol === 'https:' ? '443' : '80'),
      };
    return host ? { protocol: 'http:', port: String(host.port) } : null;
  }, [host]);

  const address = useCallback(
    (hostname: string) => `${origin?.protocol ?? 'http:'}//${hostname}:${origin?.port ?? ''}`,
    [origin],
  );

  const url = useMemo(() => {
    if (location.host && !location.host.startsWith('localhost')) {
      return `${location.protocol}//${location.host}${path}`;
    }
    const first = host?.addresses[0] ?? host?.hostname;
    return first && origin ? `${address(first)}${path}` : null;
  }, [host, origin, address, path]);

  useEffect(() => {
    if (!url) return;
    void QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  return (
    <Scroll>
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* The one screen someone sees before they have any idea what this is: they
              are standing in a room being handed a QR code. */}
        <Wordmark className="mb-5 h-8 text-(--color-chord)" label={t('app.name')} />
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
                  {address(host.hostname)}
                  {path}
                </code>{' '}
                <span className="text-(--color-muted)">— {t('join.usuallyWorks')}</span>
              </li>
              {host.addresses.map((ip) => (
                <li key={ip}>
                  <code className="rounded bg-(--color-line) px-1.5 py-0.5">
                    {address(ip)}
                    {path}
                  </code>{' '}
                  <span className="text-(--color-muted)">— {t('join.alwaysWorks')}</span>
                </li>
              ))}
            </ul>
            {host.addresses.length > 1 && (
              <p className="mt-2 text-xs text-(--color-muted)">{t('join.multipleNetworks')}</p>
            )}
            {host.addresses.length === 0 && (
              <p className="mt-2 text-xs text-(--color-muted)">{t('join.noNetwork')}</p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-6 text-sm text-(--color-muted)">{t('join.readError', { error })}</p>
        )}
      </div>
    </Scroll>
  );
}
