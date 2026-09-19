import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api, type HostInfo } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Scroll } from '../components/Scroll.js';
import { useHeader } from '../components/header-slots.js';
import { Button, Field, Input, Segment, Segmented } from '../components/ui.js';
import { IconCheck, IconCopy } from '../components/icons.js';
import { copyText } from '../lib/clipboard.js';
import { Wordmark } from '../components/Logo.js';
import { desktop, type DesktopState } from '../lib/desktop.js';

type CheckStatus = 'testing' | 'reachable' | 'unreachable';

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
  const native = useMemo(() => desktop(), []);
  const [nativeState, setNativeState] = useState<DesktopState | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
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
  /**
   * What to call this screen, for the rooms that have two.
   *
   * Optional, and most installations will leave it. It earns its place when there is a
   * screen at the back and a monitor by the drums: the name is what tells them apart in
   * the leader's connected list, and it is what lets one of them be given a text size
   * or a theme of its own in Settings without touching the other.
   */
  const [stageName, setStageName] = useState('');
  const [checks, setChecks] = useState<Record<string, CheckStatus>>({});

  const query = useMemo(() => {
    if (path !== '/stage') return '';
    const params = new URLSearchParams();
    if (!stageChords) params.set('chords', '0');
    if (stageName.trim()) params.set('name', stageName.trim().slice(0, 60));
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
  }, [path, stageChords, stageName]);

  useHeader({ back: true });

  useEffect(() => {
    let cancelled = false;
    const read = (): void => {
      api
        .host()
        .then((value) => {
          if (cancelled) return;
          setHost(value);
          setError(null);
        })
        .catch((e: unknown) => !cancelled && setError(String(e)));
    };
    read();
    const timer = setInterval(read, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void native?.state().then(setNativeState);
  }, [native]);

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
    // Keep the QR numeric even when this page was itself opened through a `.local`
    // name. It is the fallback that survives networks which suppress multicast DNS.
    const first =
      host?.addresses[0] ??
      (location.hostname && !/^(localhost|127\.|\[?::1)/.test(location.hostname)
        ? location.hostname
        : host?.hostname);
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
    const rows: { url: string; hint: string; kind: 'friendly' | 'system' | 'ip' }[] = [];
    const seen = new Set<string>();
    const add = (hostname: string, hint: string, kind: 'friendly' | 'system' | 'ip'): void => {
      const full = `${address(hostname)}${path}${query}`;
      if (seen.has(full)) return;
      seen.add(full);
      rows.push({ url: full, hint, kind });
    };
    if (host.friendlyHostname) {
      add(host.friendlyHostname, t('join.friendlyHint'), 'friendly');
    }
    const systemLocal = host.hostname.endsWith('.local')
      ? host.hostname
      : `${host.hostname}.local`;
    add(systemLocal, t('join.usuallyWorks'), 'system');
    for (const ip of host.addresses) add(ip, t('join.alwaysWorks'), 'ip');
    return rows;
  }, [host, address, path, query, t]);

  const testConnections = useCallback(async (): Promise<void> => {
    const origins = [...new Set(links.map((link) => new URL(link.url).origin))];
    setChecks(Object.fromEntries(origins.map((value) => [value, 'testing'])));
    await Promise.all(
      origins.map(async (origin) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          const response = await fetch(`${origin}/api/network/ping?t=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          setChecks((current) => ({
            ...current,
            [origin]: response.ok ? 'reachable' : 'unreachable',
          }));
        } catch {
          setChecks((current) => ({ ...current, [origin]: 'unreachable' }));
        } finally {
          clearTimeout(timer);
        }
      }),
    );
  }, [links]);

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
          <>
            <Segmented label={t('song.chords')} className="ml-2 mt-5">
              <Segment active={stageChords} onClick={() => setStageChords(true)}>
                {t('join.stageWithChords')}
              </Segment>
              <Segment active={!stageChords} onClick={() => setStageChords(false)}>
                {t('join.stageWordsOnly')}
              </Segment>
            </Segmented>

            <Field
              label={t('join.screenName')}
              hint={t('join.screenNameHint')}
              className="mt-5 max-w-sm"
            >
              <Input
                value={stageName}
                onChange={(event) => setStageName(event.target.value)}
                placeholder={t('app.stage')}
                maxLength={60}
              />
            </Field>
          </>
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
            {url && (
              <div className="flex max-w-full flex-wrap items-center justify-center gap-2 text-sm">
                <code className="max-w-full break-all rounded bg-(--color-line) px-2 py-1">
                  {url}
                </code>
                <CopyLink url={url} />
              </div>
            )}
            <p className="max-w-md text-center text-xs text-(--color-muted)">
              {t('join.qrReliable')}
            </p>
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
                  <LinkCheck status={checks[new URL(link.url).origin]} />
                  {link.kind === 'friendly' && (
                    <span className="rounded-full bg-(--color-chord)/15 px-2 py-0.5 text-xs text-(--color-chord)">
                      {t('join.friendly')}
                    </span>
                  )}
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

        {host && (
          <section className="mt-8 rounded-xl border border-(--color-line) bg-(--color-surface) p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-base font-bold">{t('join.diagnostics')}</h2>
              <Button size="sm" onClick={() => void testConnections()}>
                {t('join.testConnections')}
              </Button>
            </div>

            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-(--color-muted)">{t('join.server')}</dt>
              <dd>
                <DiagnosticDot good /> {t('join.serverRunning', { port: origin.port })}
              </dd>
              <dt className="text-(--color-muted)">{t('join.discovery')}</dt>
              <dd>
                <DiagnosticDot good={host.mdns === 'published'} />{' '}
                {host.mdns === 'published'
                  ? t('join.discoveryReady', {
                      hostname: host.friendlyHostname ?? 'worship-archive.local',
                    })
                  : host.mdns === 'starting'
                    ? t('join.discoveryStarting')
                    : t('join.discoveryUnavailable')}
              </dd>
              <dt className="text-(--color-muted)">{t('join.networks')}</dt>
              <dd>
                {host.interfaces.length > 0
                  ? host.interfaces
                      .map((entry) => `${entry.name}: ${entry.address}`)
                      .join(' · ')
                  : t('join.noNetwork')}
              </dd>
            </dl>

            <p className="mt-4 text-xs text-(--color-muted)">{t('join.testHint')}</p>

            <div className="mt-5 border-t border-(--color-line) pt-4">
              <h3 className="text-sm font-semibold">{t('join.permissionTitle')}</h3>
              <p className="mt-1 text-sm text-(--color-muted)">
                {nativeState?.platform === 'win32'
                  ? t('join.permissionWindows')
                  : nativeState?.platform === 'darwin'
                    ? t('join.permissionMac')
                    : t('join.permissionGeneric')}
              </p>
              {native && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => void native.openNetworkSettings()}
                >
                  {t('join.openNetworkSettings')}
                </Button>
              )}
            </div>
          </section>
        )}

        {error && (
          <p className="mt-6 text-sm text-(--color-muted)">{t('join.readError', { error })}</p>
        )}
      </div>
    </Scroll>
  );
}

function DiagnosticDot({ good }: { good: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: good ? 'var(--color-ok)' : 'var(--color-cue)' }}
    />
  );
}

function LinkCheck({ status }: { status: CheckStatus | undefined }) {
  const { t } = useT();
  if (!status) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        status === 'reachable'
          ? 'bg-green-500/15 text-green-500'
          : status === 'testing'
            ? 'bg-(--color-line) text-(--color-muted)'
            : 'bg-red-500/15 text-red-500'
      }`}
    >
      {status === 'reachable'
        ? t('join.reachable')
        : status === 'testing'
          ? t('join.testing')
          : t('join.unreachable')}
    </span>
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
