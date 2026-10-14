package com.worshiparchive.band;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Dependency-free tests for the connection layer; also run by the APK build job. */
public final class NativeCoreTest {
    private static int checks;
    private static void check(boolean success, String label) {
        if (!success) throw new AssertionError(label);
        checks++;
        System.out.println("PASS " + label);
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
        throw new IOException("Too large");
    }

    private static String request(LocalBandServer server, String method, String path, String extra, String body) throws IOException {
        URL origin = new URL(server.origin());
        try (Socket socket = new Socket(origin.getHost(), origin.getPort())) {
            socket.setSoTimeout(3000);
            String payload = method + " " + path + " HTTP/1.1\r\nHost: " + origin.getAuthority()
                    + "\r\nConnection: close\r\n" + extra;
            if (body != null) payload += "Content-Length: " + body.getBytes(StandardCharsets.UTF_8).length + "\r\n";
            socket.getOutputStream().write((payload + "\r\n" + (body == null ? "" : body)).getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream result = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = socket.getInputStream().read(buffer)) != -1) result.write(buffer, 0, count);
            return new String(result.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public static void main(String[] args) throws Exception {
        check(LeaderEndpoint.manual("192.168.0.114").port == 7374, "manual address defaults to the Leader port");
        check(LeaderEndpoint.manual("http://192.168.0.114:7375/band").port == 7375, "a copied Band link accepts its actual port");
        check(LeaderEndpoint.manual("[::1]:7374").origin().equals("http://[::1]:7374"), "IPv6 address is bracketed correctly");
        for (String invalid : new String[] { "https://example.com", "file:///data/user", "http://user:password@host", "http://host:70000", "http://host/path#fragment", "http://host name" }) {
            boolean rejected = false;
            try { LeaderEndpoint.manual(invalid); } catch (RuntimeException expected) { rejected = true; }
            check(rejected, "rejects unsafe/invalid manual address: " + invalid);
        }
        ExecutorService worker = Executors.newCachedThreadPool();
        try (ServerSocket fakeLeader = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
             LocalBandServer server = new LocalBandServer(0, path -> {
                 if ("index.html".equals(path)) return new ByteArrayInputStream("<title>Bundled Band</title>".getBytes(StandardCharsets.UTF_8));
                 if ("assets/test.js".equals(path)) return new ByteArrayInputStream("window.band = true".getBytes(StandardCharsets.UTF_8));
                 throw new FileNotFoundException(path);
             })) {
            check(request(server, "GET", "/band", "", null).contains("<title>Bundled Band</title>"), "bundled Band screen loads without a Leader");
            check(request(server, "GET", "/assets/test.js", "", null).contains("Content-Type: text/javascript"), "JavaScript assets have the correct MIME type");
            check(request(server, "GET", "/api/session", "", null).startsWith("HTTP/1.1 503"), "API reports waiting when no Leader is available");
            check(request(server, "GET", "/stage", "", null).startsWith("HTTP/1.1 404"), "Android shell does not serve a Stage product");
            check(request(server, "GET", "/%2e%2e/private", "", null).startsWith("HTTP/1.1 403"), "encoded traversal cannot read native files");
            check(request(server, "GET", "/band", "Origin: https://untrusted.example\r\n", null).startsWith("HTTP/1.1 403"), "other web origins cannot use the native proxy");
            String stableOrigin = server.origin();
            LeaderEndpoint endpoint = new LeaderEndpoint("test-leader", "Test Leader", "127.0.0.1", fakeLeader.getLocalPort());
            server.setLeader(endpoint);
            Future<String> get = worker.submit(() -> {
                try (Socket socket = fakeLeader.accept()) {
                    String header = readHeader(socket.getInputStream());
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{\"active\":true}\n".getBytes(StandardCharsets.UTF_8));
                    return header;
                }
            });
            String response = request(server, "GET", "/api/session?test=1", "", null);
            check(response.contains("{\"active\":true}"), "Leader API response reaches the bundled renderer");
            check(get.get(3, TimeUnit.SECONDS).startsWith("GET /api/session?test=1 "), "API query strings reach the Leader unchanged");
            Future<String> post = worker.submit(() -> {
                try (Socket socket = fakeLeader.accept()) {
                    String header = readHeader(socket.getInputStream());
                    int length = 0;
                    for (String line : header.split("\r\n")) if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                    byte[] body = new byte[length];
                    new DataInputStream(socket.getInputStream()).readFully(body);
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".getBytes(StandardCharsets.UTF_8));
                    return new String(body, StandardCharsets.UTF_8);
                }
            });
            request(server, "POST", "/api/powerpoints/find", "Content-Type: application/json\r\n", "{\"songIds\":[\"test\"]}");
            check(post.get(3, TimeUnit.SECONDS).equals("{\"songIds\":[\"test\"]}"), "Band request bodies are proxied without alteration");
            check(request(server, "DELETE", "/api/songs/test", "", null).startsWith("HTTP/1.1 405"), "the Band shell does not forward deletion requests");
            Future<Boolean> ws = worker.submit(() -> {
                try (Socket socket = fakeLeader.accept()) {
                    socket.setSoTimeout(3000);
                    readHeader(socket.getInputStream());
                    socket.getOutputStream().write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                    byte[] frame = new byte[4];
                    new DataInputStream(socket.getInputStream()).readFully(frame);
                    socket.getOutputStream().write(frame);
                    return frame[0] == (byte) 0x81 && frame[3] == 'i';
                }
            });
            URL local = new URL(server.origin());
            try (Socket client = new Socket(local.getHost(), local.getPort())) {
                client.setSoTimeout(3000);
                client.getOutputStream().write(("GET /ws HTTP/1.1\r\nHost: " + local.getAuthority() + "\r\nOrigin: " + server.origin() + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: test\r\nSec-WebSocket-Version: 13\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                check(readHeader(client.getInputStream()).startsWith("HTTP/1.1 101"), "live-session WebSocket upgrade passes through");
                client.getOutputStream().write(new byte[] { (byte) 0x81, 2, 'h', 'i' });
                byte[] frame = new byte[4];
                new DataInputStream(client.getInputStream()).readFully(frame);
                check(frame[2] == 'h' && frame[3] == 'i' && ws.get(3, TimeUnit.SECONDS), "WebSocket traffic passes in both directions");
            }
            server.setLeader(null);
            check(server.origin().equals(stableOrigin), "local origin stays stable when a Leader disconnects");
            check(request(server, "GET", "/band", "", null).contains("Bundled Band"), "Band UI remains available after Leader disconnection");
            check(request(server, "GET", "/api/session", "", null).startsWith("HTTP/1.1 503"), "disconnected API can retry rather than hang");
        } finally { worker.shutdownNow(); }
        System.out.println("Native Android connection tests passed: " + checks);
    }
}
