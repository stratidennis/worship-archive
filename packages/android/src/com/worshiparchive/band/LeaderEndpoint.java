package com.worshiparchive.band;

import java.net.URI;

/** The only remote destination used by the native shell. */
public final class LeaderEndpoint {
    public final String id;
    public final String name;
    public final String host;
    public final int port;

    public LeaderEndpoint(String id, String name, String host, int port) {
        if (id == null || id.isEmpty() || host == null || host.isEmpty()
                || host.matches(".*[\\s/@?#\\\\].*") || port < 1 || port > 65535) {
            throw new IllegalArgumentException("Invalid Leader endpoint");
        }
        this.id = id;
        this.name = name == null || name.isEmpty() ? "Worship Archive" : name;
        this.host = host;
        this.port = port;
    }

    public String origin() {
        return "http://" + (host.contains(":") ? "[" + host + "]" : host) + ":" + port;
    }

    public static LeaderEndpoint manual(String input) {
        String value = input.trim();
        if (!value.contains("://")) value = "http://" + value;
        URI uri = URI.create(value);
        if (!"http".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Use a local HTTP Leader address");
        }
        int port = uri.getPort() == -1 ? 7374 : uri.getPort();
        String host = uri.getHost().replace("[", "").replace("]", "");
        return new LeaderEndpoint("manual:" + host + ":" + port, "Leader", host, port);
    }

    public boolean sameAddress(LeaderEndpoint other) {
        return other != null && host.equals(other.host) && port == other.port && id.equals(other.id);
    }
}
