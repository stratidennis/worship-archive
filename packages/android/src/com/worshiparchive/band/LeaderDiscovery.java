package com.worshiparchive.band;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import org.json.JSONObject;
import java.io.Closeable;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Uses the same mDNS identity and UDP fallback as the desktop Band client. */
public final class LeaderDiscovery implements Closeable {
    public interface Listener { void changed(List<LeaderEndpoint> endpoints); }
    private final NsdManager nsd;
    private final Listener listener;
    private final Map<String, Seen> leaders = new ConcurrentHashMap<>();
    private final Map<String, String> serviceIds = new ConcurrentHashMap<>();
    private final ScheduledExecutorService workers = Executors.newScheduledThreadPool(2);
    private final WifiManager.MulticastLock multicast;
    private final Queue<NsdServiceInfo> pending = new ArrayDeque<>();
    private boolean resolving;
    private volatile boolean closed;
    private volatile DatagramSocket socket;
    private NsdManager.DiscoveryListener browser;

    private static final class Seen {
        final LeaderEndpoint endpoint;
        final long time;
        Seen(LeaderEndpoint endpoint) { this.endpoint = endpoint; this.time = System.currentTimeMillis(); }
    }

    public LeaderDiscovery(Context context, Listener listener) {
        this.listener = listener;
        nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        multicast = wifi == null ? null : wifi.createMulticastLock("worship-band-discovery");
        if (multicast != null) multicast.setReferenceCounted(false);
    }

    public void start() {
        try { if (multicast != null) multicast.acquire(); } catch (RuntimeException ignored) { }
        browse();
        workers.scheduleWithFixedDelay(this::broadcast, 0, 4, TimeUnit.SECONDS);
        workers.scheduleWithFixedDelay(() -> {
            if (closed) return;
            stopBrowsing();
            browse();
        }, 30, 30, TimeUnit.SECONDS);
    }

    private synchronized void browse() {
        if (closed || nsd == null || browser != null) return;
        browser = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) { }
            @Override public void onDiscoveryStopped(String type) { }
            @Override public void onStartDiscoveryFailed(String type, int error) {
                if (!closed) stopBrowsing();
            }
            @Override public void onStopDiscoveryFailed(String type, int error) { }
            @Override public void onServiceFound(NsdServiceInfo info) {
                synchronized (LeaderDiscovery.this) {
                    if (closed) return;
                    pending.add(info);
                    resolveNext();
                }
            }
            @Override public void onServiceLost(NsdServiceInfo info) {
                String id = serviceIds.remove(info.getServiceName());
                // UDP independently refreshes the endpoint; do not discard a fresh
                // broadcast response just because mDNS was temporarily lost.
                Seen seen = id == null ? null : leaders.get(id);
                if (seen != null && System.currentTimeMillis() - seen.time > 12000) {
                    leaders.remove(id);
                    notifyListener();
                }
            }
        };
        try { nsd.discoverServices("_http._tcp.", NsdManager.PROTOCOL_DNS_SD, browser); }
        catch (RuntimeException error) { browser = null; }
    }

    private synchronized void resolveNext() {
        if (closed || resolving || pending.isEmpty()) return;
        NsdServiceInfo info = pending.remove();
        resolving = true;
        try {
            nsd.resolveService(info, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo service, int error) { resolved(); }
                @Override public void onServiceResolved(NsdServiceInfo service) {
                    try {
                        Map<String, byte[]> txt = service.getAttributes();
                        if ("worship-archive".equals(text(txt.get("app"))) && "leader".equals(text(txt.get("role")))
                                && Integer.toString(Protocol.VERSION).equals(text(txt.get("protocol"))) && service.getHost() != null) {
                            String id = text(txt.get("leaderId"));
                            LeaderEndpoint endpoint = new LeaderEndpoint(id, service.getServiceName(), service.getHost().getHostAddress(), service.getPort());
                            serviceIds.put(service.getServiceName(), id);
                            remember(endpoint);
                        }
                    } catch (RuntimeException ignored) { }
                    finally { resolved(); }
                }
            });
        } catch (RuntimeException error) { resolved(); }
    }

    private synchronized void resolved() { resolving = false; resolveNext(); }

    private static String text(byte[] value) { return value == null ? "" : new String(value, StandardCharsets.UTF_8); }

    private void broadcast() {
        if (closed) return;
        try (DatagramSocket current = new DatagramSocket()) {
            socket = current;
            current.setBroadcast(true);
            current.setSoTimeout(700);
            byte[] request = ("worship-archive-discover:" + Protocol.VERSION).getBytes(StandardCharsets.UTF_8);
            Set<InetAddress> destinations = new HashSet<>();
            destinations.add(InetAddress.getByName("255.255.255.255"));
            Enumeration<NetworkInterface> networks = NetworkInterface.getNetworkInterfaces();
            while (networks != null && networks.hasMoreElements()) {
                for (InterfaceAddress address : networks.nextElement().getInterfaceAddresses()) {
                    if (address.getBroadcast() != null) destinations.add(address.getBroadcast());
                }
            }
            for (InetAddress destination : destinations) {
                try { current.send(new DatagramPacket(request, request.length, destination, Protocol.DISCOVERY_PORT)); }
                catch (Exception ignored) { }
            }
            long until = System.currentTimeMillis() + 1500;
            while (!closed && System.currentTimeMillis() < until) {
                DatagramPacket reply = new DatagramPacket(new byte[8192], 8192);
                try { current.receive(reply); }
                catch (SocketTimeoutException error) { continue; }
                try {
                    JSONObject value = new JSONObject(new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8));
                    if (!"worship-archive".equals(value.optString("app")) || !"leader".equals(value.optString("role"))
                            || value.optDouble("protocol", -1) != Protocol.VERSION) continue;
                    double port = value.getDouble("port");
                    if (port != Math.rint(port)) continue;
                    remember(new LeaderEndpoint(value.getString("leaderId"), value.optString("name"), reply.getAddress().getHostAddress(), value.getInt("port")));
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) {
            // A Wi-Fi change can invalidate a socket; the next tick starts fresh.
        } finally {
            socket = null;
            long expiry = System.currentTimeMillis() - 45000;
            for (Map.Entry<String, Seen> entry : leaders.entrySet()) {
                if (entry.getValue().time < expiry) leaders.remove(entry.getKey(), entry.getValue());
            }
            notifyListener();
        }
    }

    private void remember(LeaderEndpoint endpoint) {
        if (closed) return;
        leaders.put(endpoint.id, new Seen(endpoint));
        notifyListener();
    }

    private void notifyListener() {
        if (closed) return;
        List<LeaderEndpoint> result = new ArrayList<>();
        for (Seen seen : leaders.values()) result.add(seen.endpoint);
        Collections.sort(result, (a, b) -> a.name.compareToIgnoreCase(b.name));
        listener.changed(result);
    }

    private synchronized void stopBrowsing() {
        NsdManager.DiscoveryListener current = browser;
        browser = null;
        if (current != null && nsd != null) try { nsd.stopServiceDiscovery(current); } catch (RuntimeException ignored) { }
    }

    @Override public synchronized void close() {
        closed = true;
        stopBrowsing();
        pending.clear();
        if (socket != null) socket.close();
        workers.shutdownNow();
        try { if (multicast != null && multicast.isHeld()) multicast.release(); } catch (RuntimeException ignored) { }
    }
}
