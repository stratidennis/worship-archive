package com.worshiparchive.band;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Minimal RFC6455 session host matching the desktop Leader protocol. */
final class LeaderSessionHub implements Closeable {
    private final Map<String, Client> clients = new LinkedHashMap<>();
    private final File stateFile;
    private final String leaderId;
    private JSONObject state;
    private volatile boolean closed;

    LeaderSessionHub(File stateFile, String leaderId) {
        this.stateFile = stateFile; this.leaderId = leaderId; state = initial(); restore();
        try { state.put("active", false).put("sessionEpoch", JSONObject.NULL).put("leaderId", leaderId); } catch (JSONException ignored) { }
    }

    private JSONObject initial() {
        try {
            JSONObject display = new JSONObject().put("theme", JSONObject.NULL).put("language", JSONObject.NULL).put("minFontPx", JSONObject.NULL).put("maxFontPx", JSONObject.NULL).put("lineHeight", JSONObject.NULL).put("chordColor", JSONObject.NULL).put("showChords", JSONObject.NULL).put("cueStyle", JSONObject.NULL).put("showBlockTitles", JSONObject.NULL);
            return new JSONObject().put("active", false).put("leaderId", leaderId).put("sessionEpoch", JSONObject.NULL).put("leaderRevision", 0)
                    .put("setId", JSONObject.NULL).put("itemIndex", 0).put("output", "live").put("stage", display)
                    .put("stageBy", new JSONObject()).put("stageByDevice", new JSONObject()).put("host", JSONObject.NULL)
                    .put("tempo", JSONObject.NULL).put("beatsPerBar", 4).put("beatEpoch", JSONObject.NULL).put("transpose", 0)
                    .put("performanceKey", JSONObject.NULL).put("capo", 0).put("rev", 0);
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    private void restore() {
        if (!stateFile.isFile()) return;
        try { JSONObject saved = new JSONObject(new String(java.nio.file.Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8)); for (Iterator<String> i = state.keys(); i.hasNext();) { String key = i.next(); if (saved.has(key)) state.put(key, saved.get(key)); } state.put("rev", state.optInt("rev") + 1); }
        catch (Exception ignored) { state = initial(); }
    }
    private synchronized void persist() { try { java.nio.file.Files.write(stateFile.toPath(), state.toString().getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) { } }
    synchronized JSONObject state() { try { return new JSONObject(state.toString()); } catch (JSONException error) { return initial(); } }
    synchronized JSONArray devices() { JSONArray out = new JSONArray(); for (Client client : clients.values()) if (client.identified) out.put(client.device); return out; }

    synchronized JSONObject patch(JSONObject patch, boolean leader) throws JSONException {
        boolean performance = false; boolean activates = patch.optBoolean("active", false) && !state.optBoolean("active");
        for (Iterator<String> keys = patch.keys(); keys.hasNext();) {
            String key = keys.next();
            if ("rev".equals(key) || "leaderId".equals(key) || "sessionEpoch".equals(key) || "leaderRevision".equals(key)) continue;
            if (leader && ("setId".equals(key) || "itemIndex".equals(key) || "performanceKey".equals(key) || "transpose".equals(key) || "capo".equals(key))) performance = true;
            state.put(key, patch.get(key));
        }
        if (leader) { if (activates) state.put("sessionEpoch", UUID.randomUUID().toString()); if (activates || performance) state.put("leaderRevision", state.optInt("leaderRevision") + 1); }
        state.put("rev", state.optInt("rev") + 1); persist(); broadcast(new JSONObject().put("t", "session").put("state", state)); return state();
    }
    synchronized void reloadLibrary() { try { broadcast(new JSONObject().put("t", "reload").put("reason", "library")); } catch (JSONException ignored) { } }
    synchronized void heartbeat(){for(Client client:new ArrayList<>(clients.values())){if(!client.alive){drop(client);continue;}client.alive=false;try{client.writeFrame(9,new byte[0]);}catch(IOException error){drop(client);}}}

    void accept(Socket socket, Map<String, String> headers, boolean canLead) throws Exception {
        String key = headers.get("sec-websocket-key"); if (key == null) throw new IOException("Missing WebSocket key");
        String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.ISO_8859_1)));
        OutputStream output = socket.getOutputStream(); output.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1)); output.flush();
        Client client = new Client(socket, canLead); synchronized (this) { clients.put(client.id, client); }
        client.send(new JSONObject().put("t", "session").put("state", state())); broadcastDevices();
        try { client.readLoop(); } finally { drop(client); }
    }
    private synchronized void drop(Client client) {
        if (clients.remove(client.id) == null) return; client.close(); broadcastDevices();
        boolean leader = false; for (Client one : clients.values()) if (one.identified && "leader".equals(one.device.optString("role"))) leader = true;
        if (!leader && state.optBoolean("active")) try { patch(new JSONObject().put("active", false), false); } catch (JSONException ignored) { }
    }
    private synchronized void broadcastDevices() { try { broadcast(new JSONObject().put("t", "devices").put("devices", devices())); } catch (JSONException ignored) { } }
    private synchronized void broadcast(JSONObject message) { for (Client client : new ArrayList<>(clients.values())) try { client.send(message); } catch (Exception error) { client.close(); } }

    private final class Client {
        final String id = UUID.randomUUID().toString(); final Socket socket; final boolean canLead; final InputStream input; final OutputStream output;
        JSONObject device; boolean identified; boolean alive=true;
        Client(Socket socket, boolean canLead) throws Exception {
            this.socket = socket; this.canLead = canLead; input = socket.getInputStream(); output = socket.getOutputStream();
            device = new JSONObject().put("id", id).put("deviceId", JSONObject.NULL).put("name", "").put("role", "band").put("protocolVersion", Protocol.VERSION).put("since", Instant.now().toString());
        }
        void readLoop() throws Exception {
            socket.setSoTimeout(0);
            while (!closed && !socket.isClosed()) {
                Frame frame = Frame.read(input); if (frame == null || frame.opcode == 8) return;
                if (frame.opcode == 9) { writeFrame(10, frame.data); continue; }
                if (frame.opcode == 10) { alive=true; continue; }
                if (frame.opcode != 1) continue;
                JSONObject message; try { message = new JSONObject(new String(frame.data, StandardCharsets.UTF_8)); } catch (JSONException error) { continue; }
                String type = message.optString("t");
                if ("hello".equals(type)) {
                    int protocol = message.optInt("protocolVersion", -1);
                    if (protocol != Protocol.VERSION) { send(new JSONObject().put("t", "incompatible").put("serverProtocol", Protocol.VERSION).put("clientProtocol", protocol)); return; }
                    String role = message.optString("role", "band"); if ("leader".equals(role) && !canLead) return;
                    String persistent = message.optString("deviceId", "");
                    synchronized (LeaderSessionHub.this) {
                        if (!persistent.isEmpty()) for (Client other : new ArrayList<>(clients.values())) if (other != this && persistent.equals(other.device.optString("deviceId"))) drop(other);
                        device.put("deviceId", persistent.isEmpty() ? JSONObject.NULL : persistent).put("name", message.optString("name")).put("role", role).put("protocolVersion", protocol); identified = true; broadcastDevices();
                    }
                } else if ("patch".equals(type) && identified && "leader".equals(device.optString("role"))) patch(message.getJSONObject("patch"), true);
                else if ("ping".equals(type)) send(new JSONObject().put("t", "pong").put("clientTime", message.optLong("clientTime")).put("serverTime", System.currentTimeMillis()));
            }
        }
        synchronized void send(JSONObject message) throws IOException { writeFrame(1, message.toString().getBytes(StandardCharsets.UTF_8)); }
        private synchronized void writeFrame(int opcode, byte[] data) throws IOException {
            output.write(0x80 | opcode); int length = data.length;
            if (length < 126) output.write(length); else if (length <= 65535) { output.write(126); output.write((length >>> 8) & 255); output.write(length & 255); }
            else { output.write(127); long wide=length;for (int shift = 56; shift >= 0; shift -= 8) output.write((int)((wide >>> shift) & 255)); }
            output.write(data); output.flush();
        }
        void close() { try { socket.close(); } catch (IOException ignored) { } }
    }
    private static final class Frame {
        final int opcode; final byte[] data; Frame(int opcode, byte[] data) { this.opcode = opcode; this.data = data; }
        static Frame read(InputStream input) throws IOException {
            int first = input.read(); if (first < 0) return null; int second = input.read(); if (second < 0) return null;
            int opcode = first & 15; boolean masked = (second & 128) != 0; long length = second & 127;
            if (length == 126) length = (input.read() << 8) | input.read(); else if (length == 127) { length = 0; for (int i = 0; i < 8; i++) length = (length << 8) | input.read(); }
            if (length < 0 || length > 8 * 1024 * 1024) throw new IOException("WebSocket frame too large");
            byte[] mask = masked ? exact(input, 4) : null; byte[] data = exact(input, (int) length);
            if (mask != null) for (int i = 0; i < data.length; i++) data[i] ^= mask[i % 4]; return new Frame(opcode, data);
        }
        private static byte[] exact(InputStream input, int length) throws IOException { byte[] out = new byte[length]; int at = 0; while (at < length) { int count = input.read(out, at, length - at); if (count < 0) throw new EOFException(); at += count; } return out; }
    }
    @Override public synchronized void close() { closed = true; for (Client client : clients.values()) client.close(); clients.clear(); }
}
