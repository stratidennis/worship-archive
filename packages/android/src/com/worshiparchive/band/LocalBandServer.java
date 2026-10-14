package com.worshiparchive.band;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * A loopback-only origin for the packaged Band renderer. Its cache and display
 * preferences survive Leader IP changes, just like the installed desktop clients.
 * No library database, Node runtime, or third-party server dependency is packaged.
 */
public final class LocalBandServer implements Closeable {
    public interface Assets { InputStream open(String path) throws IOException; }
    private final Assets assets;
    private final ServerSocket listener;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Set<Socket> connections = Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
    private final Set<Socket> tunnels = Collections.newSetFromMap(new ConcurrentHashMap<Socket, Boolean>());
    private volatile LeaderEndpoint leader;
    private volatile boolean closed;

    public LocalBandServer(int port, Assets assets) throws IOException {
        this.assets = assets;
        listener = new ServerSocket();
        listener.setReuseAddress(true);
        listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
        workers.execute(() -> {
            while (!closed) {
                try {
                    Socket socket = listener.accept();
                    connections.add(socket);
                    workers.execute(() -> serve(socket));
                } catch (IOException | RejectedExecutionException error) {
                    if (!closed) close();
                }
            }
        });
    }

    public String origin() { return "http://127.0.0.1:" + listener.getLocalPort(); }

    public synchronized void setLeader(LeaderEndpoint next) {
        if (leader == null ? next == null : leader.sameAddress(next)) return;
        leader = next;
        // The existing browser reconnect loop then obtains the new Leader's session.
        // Do not interrupt local HTML/assets while the first Leader is discovered.
        for (Socket socket : tunnels) closeSocket(socket);
    }

    private void serve(Socket socket) {
        try {
            socket.setSoTimeout(10000);
            InputStream input = socket.getInputStream();
            String header = readHeader(input);
            String[] lines = header.split("\r\n");
            String[] request = lines[0].split(" ");
            if (request.length != 3 || !request[1].startsWith("/") || request[1].startsWith("//")) {
                respond(socket, 400, "Bad request"); return;
            }
            Map<String, String> headers = new LinkedHashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0) headers.put(lines[i].substring(0, colon).toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
            }
            String host = headers.get("host");
            String origin = headers.get("origin");
            if (!origin().substring(7).equals(host) || (origin != null && !origin().equals(origin))) {
                respond(socket, 403, "Only the local Band screen can use this server"); return;
            }
            String path = URI.create(request[1]).getPath();
            if ("/ws".equals(path)) {
                if (!"GET".equals(request[0]) || !"websocket".equalsIgnoreCase(headers.get("upgrade"))) {
                    respond(socket, 400, "WebSocket upgrade required"); return;
                }
                tunnel(socket, input, request[1], headers);
            } else if (path.startsWith("/api/")) {
                proxy(socket, input, request[0], request[1], headers);
            } else if ("GET".equals(request[0])) {
                serveAsset(socket, path);
            } else respond(socket, 405, "Method not allowed");
        } catch (Exception error) {
            try { respond(socket, 502, "Leader unavailable; retrying automatically"); } catch (IOException ignored) { }
        } finally {
            connections.remove(socket);
            closeSocket(socket);
        }
    }

    private void serveAsset(Socket socket, String path) throws IOException {
        if (path.contains("..") || path.contains("\\") || path.indexOf('\0') >= 0) { respond(socket, 403, "Invalid asset path"); return; }
        String resource = "/band".equals(path) || "/".equals(path) ? "index.html" : path.substring(1);
        if (!resource.contains(".") || resource.startsWith("/")) { respond(socket, 404, "Band screen only"); return; }
        try (InputStream file = assets.open(resource)) {
            writeHeader(socket, 200, mime(resource), -1);
            copy(file, socket.getOutputStream());
        } catch (FileNotFoundException error) { respond(socket, 404, "Asset not found"); }
    }

    private void proxy(Socket socket, InputStream input, String method, String path, Map<String, String> headers) throws IOException {
        LeaderEndpoint endpoint = leader;
        if (endpoint == null) { respond(socket, 503, "Waiting for a Leader"); return; }
        if (!"GET".equals(method) && !"POST".equals(method)) { respond(socket, 405, "Band requests only"); return; }
        HttpURLConnection remote = (HttpURLConnection) new URL(endpoint.origin() + path).openConnection();
        remote.setInstanceFollowRedirects(false);
        remote.setConnectTimeout(3000);
        remote.setReadTimeout(10000);
        remote.setRequestMethod(method);
        remote.setRequestProperty("Accept", "application/json");
        try {
            if ("POST".equals(method)) {
                String raw = headers.get("content-length");
                int length = raw == null ? 0 : Integer.parseInt(raw);
                if (length < 0 || length > 2000000 || headers.containsKey("transfer-encoding")) { respond(socket, 413, "Request too large"); return; }
                remote.setDoOutput(true);
                remote.setFixedLengthStreamingMode(length);
                remote.setRequestProperty("Content-Type", headers.containsKey("content-type") ? headers.get("content-type") : "application/json");
                try (OutputStream out = remote.getOutputStream()) { copyLength(input, out, length); }
            }
            int status = remote.getResponseCode();
            writeHeader(socket, status, remote.getContentType() == null ? "application/json" : remote.getContentType(), -1);
            InputStream body = status >= 400 ? remote.getErrorStream() : remote.getInputStream();
            if (body != null) try (InputStream stream = body) { copy(stream, socket.getOutputStream()); }
        } finally { remote.disconnect(); }
    }

    private void tunnel(Socket client, InputStream input, String path, Map<String, String> headers) throws IOException {
        final LeaderEndpoint endpoint;
        final Socket remote;
        synchronized (this) {
            endpoint = leader;
            if (endpoint == null) { respond(client, 503, "Waiting for a Leader"); return; }
            remote = new Socket();
            connections.add(remote);
            tunnels.add(client);
            tunnels.add(remote);
        }
        try {
            remote.connect(new InetSocketAddress(endpoint.host, endpoint.port), 3000);
            remote.setSoTimeout(10000);
            StringBuilder request = new StringBuilder("GET " + path + " HTTP/1.1\r\nHost: " + endpoint.origin().substring(7) + "\r\n");
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (!"host".equals(entry.getKey()) && !"origin".equals(entry.getKey())) request.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
            }
            request.append("\r\n");
            remote.getOutputStream().write(request.toString().getBytes(StandardCharsets.ISO_8859_1));
            String reply = readHeader(remote.getInputStream());
            client.getOutputStream().write(reply.getBytes(StandardCharsets.ISO_8859_1));
            client.getOutputStream().flush();
            if (!reply.startsWith("HTTP/1.1 101 ") && !reply.startsWith("HTTP/1.0 101 ")) return;
            remote.setSoTimeout(0);
            client.setSoTimeout(0);
            workers.execute(() -> {
                try { copy(input, remote.getOutputStream()); } catch (IOException ignored) { }
                finally { closeSocket(remote); closeSocket(client); }
            });
            copy(remote.getInputStream(), client.getOutputStream());
        } finally {
            tunnels.remove(client);
            tunnels.remove(remote);
            connections.remove(remote);
            closeSocket(remote);
        }
    }

    private static String readHeader(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int tail = 0;
        while (bytes.size() < 32768) {
            int next = input.read();
            if (next < 0) throw new EOFException();
            bytes.write(next);
            tail = (tail << 8) | next;
            if (tail == 0x0d0a0d0a) return new String(bytes.toByteArray(), StandardCharsets.ISO_8859_1);
        }
        throw new IOException("Header too large");
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16384];
        int count;
        while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); output.flush(); }
    }

    private static void copyLength(InputStream input, OutputStream output, int remaining) throws IOException {
        byte[] buffer = new byte[16384];
        while (remaining > 0) {
            int count = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (count < 0) throw new EOFException();
            output.write(buffer, 0, count);
            remaining -= count;
        }
    }

    private static void writeHeader(Socket socket, int status, String type, int length) throws IOException {
        if (type.contains("\r") || type.contains("\n")) type = "application/octet-stream";
        String header = "HTTP/1.1 " + status + " Response\r\nContent-Type: " + type + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n";
        if (length >= 0) header += "Content-Length: " + length + "\r\n";
        socket.getOutputStream().write((header + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void respond(Socket socket, int status, String message) throws IOException {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        writeHeader(socket, status, "text/plain; charset=utf-8", bytes.length);
        socket.getOutputStream().write(bytes);
    }

    private static String mime(String path) {
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private static void closeSocket(Socket socket) { try { socket.close(); } catch (IOException ignored) { } }

    @Override public void close() {
        closed = true;
        try { listener.close(); } catch (IOException ignored) { }
        for (Socket socket : connections) closeSocket(socket);
        workers.shutdownNow();
    }
}
