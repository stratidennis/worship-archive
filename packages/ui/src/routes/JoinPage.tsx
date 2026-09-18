import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { useHeader } from '../components/header-slots.js';
import { Button, Segment, Segmented } from '../components/ui.js';
import { IconCheck, IconCopy } from '../components/icons.js';
import { copyText } from '../lib/clipboard.js';
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
  /**
   * Chords on the stage display, or only the words.
   *
   * `/stage` has always read `?chords=0`; it was simply not offered anywhere, so you had
   * to know. A screen facing the congregation usually wants words alone, and one facing
   * the drummer usually wants chords — the same URL, set up once, at the moment the
   * screen is being pointed at something.
   */
  const [stageChords, setStageChords] = useState(true);
  const query = path === '/stage' && !stageChords ? '?chords=0' : '';

  useHeader({ back: true });

  useEffect(() => {
    api
      .host()
      .then(setHost)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  /*
    Which port to hand out: the one you are reading this on.

    Not the one the host reports. In a packaged app they are the same number, but in
    development they are not — Vite serves the interface and proxies the API to the
    server on another port, and that other port serves no interface at all. Handing it
    out sent someone to `:7374/band` and a JSON error, because the address was for a
    process that only answers `/api`.

    Whatever port this page arrived on is, by definition, a port that serves the app.
    The *hostname* is the part the browser cannot supply — `localhost` means nothing on
    a phone — so that still comes from the host.
  */
  const origin = useMemo(
    () => ({
      protocol: location.protocol,
      port: location.port || (location.protocol === 'https:' ? '443' : '80'),
    }),
    [],
  );

  const address = useCallback(
    (hostname: string) => `${origin.protocol}//${hostname}:${origin.port}`,
    [origin],
  );

  const url = useMemo(() => {
    if (location.hostname && !/^(localhost|127\.|\[?::1)/.test(location.hostname)) {
      return `${location.protocol}//${location.host}${path}${query}`;
    }
    // Opened on the host itself: keep this port, but use an address a phone can route to.
    const first = host?.addresses[0] ?? host?.hostname;
    return first ? `${address(first)}${path}${query}` : null;
  }, [host, address, path, query]);

  useEffect(() => {
    if (!url) return;
    void QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  /*
    Every address, once.

    The `.local` name and the raw IPs are usually different routes to the same machine
    but occasionally not, so all of them are worth printing — the same *string* twice is
    not. The QR's own address used to be captioned under the code and then listed again
    below it, which on a one-address network meant the page offered you the same link
    twice and looked like it was offering a choice.
  */
  const links = useMemo(() => {
    if (!host) return [];
    const rows: { url: string; hint: string }[] = [];
    const seen = new Set<string>();
    const add = (hostname: string, hint: string): void => {
      const full = `${address(hostname)}${path}${query}`;
      if (seen.has(full)) return;
      seen.add(full);
      rows.push({ url: full, hint });
    };
    add(host.hostname, t('join.usuallyWorks'));
    for (const ip of host.addresses) add(ip, t('join.alwaysWorks'));
    return rows;
  }, [host, address, path, query, t]);

  return (
    <Scroll>
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* The one screen someone sees before they have any idea what this is: they
              are standing in a room being handed a QR code. */}
        <Wordmark className="mb-6 h-12 text-(--color-chord) sm:h-16" label={t('app.name')} />
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

        {path === '/stage' && (
          <Segmented label={t('song.chords')} className="ml-2 mt-5">
            <Segment active={stageChords} onClick={() => setStageChords(true)}>
              {t('join.stageWithChords')}
            </Segment>
            <Segment active={!stageChords} onClick={() => setStageChords(false)}>
              {t('join.stageWordsOnly')}
            </Segment>
          </Segmented>
        )}

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
          </div>
        )}

        {host && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
              {t('join.orType')}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {links.map((link) => (
                <li
                  key={link.url}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <code className="rounded bg-(--color-line) px-1.5 py-1">{link.url}</code>
                  <CopyLink url={link.url} />
                  <span className="text-(--color-muted)">— {link.hint}</span>
                  {link.url === url && (
                    <span className="rounded-full bg-(--color-chord)/15 px-2 py-0.5 text-xs text-(--color-chord)">
                      {t('join.qrTag')}
                    </span>
                  )}
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

/**
 * Copy one address.
 *
 * The tick is the whole point: a copy button that looks identical before and after is
 * indistinguishable from a copy button that did not work, and this one is pressed in a
 * room where the next thing that happens is someone typing the address by hand instead.
 */
function CopyLink({ url }: { url: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={copied ? t('join.copied') : t('join.copy')}
      title={copied ? t('join.copied') : t('join.copy')}
      onClick={() => void copyText(url).then(setCopied)}
      className={copied ? 'text-(--color-ok)' : 'text-(--color-muted)'}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      <span className="sr-only sm:not-sr-only">
        {copied ? t('join.copied') : t('app.copy')}
      </span>
    </Button>
  );
}
