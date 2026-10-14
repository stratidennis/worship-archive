package com.worshiparchive.band;

import org.json.*;
import java.util.*;
import java.util.regex.*;

/** Small dependency-free reader/writer for the exact ChordPro model shared with desktop. */
final class ChordPro {
    private static final Pattern DIRECTIVE = Pattern.compile("^\\s*\\{\\s*([a-zA-Z_][\\w]*)\\s*(?::\\s*([\\s\\S]*?))?\\s*\\}\\s*$");
    private static final Set<String> TYPES = new HashSet<>(Arrays.asList("Verse", "Chorus", "PreChorus", "Bridge", "Ending", "Tag", "Intro", "Instrumental", "Solo", "Note"));
    private static final Set<String> SINGERS = new HashSet<>(Arrays.asList("Leader", "All", "Women", "Men", "Choir", "Children", "Adults", "Congregation"));
    private static final Map<String, String> ALIASES = new HashMap<>();
    static {
        ALIASES.put("t", "title"); ALIASES.put("a", "artist"); ALIASES.put("c", "comment");
        ALIASES.put("ci", "comment_italic"); ALIASES.put("cb", "comment_box");
        ALIASES.put("soc", "start_of_chorus"); ALIASES.put("eoc", "end_of_chorus");
        ALIASES.put("sov", "start_of_verse"); ALIASES.put("eov", "end_of_verse");
        ALIASES.put("sob", "start_of_bridge"); ALIASES.put("eob", "end_of_bridge");
        ALIASES.put("k", "key");
    }

    private ChordPro() { }

    private static void nullable(JSONObject object, String key, Object value) throws JSONException {
        object.put(key, value == null ? JSONObject.NULL : value);
    }
    private static String nullableString(String value) { return value == null || value.isEmpty() ? null : value; }
    private static Double number(String value) {
        if (value == null) return null;
        try { double n = Double.parseDouble(value.trim()); return Double.isFinite(n) ? n : null; }
        catch (RuntimeException error) { return null; }
    }
    private static String singer(String value) {
        if (value == null) return null;
        for (String one : SINGERS) if (one.equalsIgnoreCase(value.trim())) return one;
        return null;
    }
    private static JSONArray csv(String value) {
        JSONArray out = new JSONArray();
        if (value != null) for (String part : value.split(",")) if (!part.trim().isEmpty()) out.put(part.trim());
        return out;
    }
    private static JSONArray words(String value) {
        JSONArray out = new JSONArray();
        if (value != null && !value.trim().isEmpty()) for (String part : value.trim().split("\\s+")) out.put(part);
        return out;
    }
    private static JSONArray anchors(String value) throws JSONException {
        JSONArray out = new JSONArray();
        if (value == null) return out;
        for (String part : value.trim().split("\\s+")) {
            int colon = part.indexOf(':');
            if (colon < 1 || colon == part.length() - 1) continue;
            try { out.put(new JSONObject().put("at", Integer.parseInt(part.substring(0, colon))).put("raw", part.substring(colon + 1))); }
            catch (NumberFormatException ignored) { }
        }
        return out;
    }

    private static JSONObject line(String raw, JSONObject pending) throws JSONException {
        StringBuilder text = new StringBuilder();
        JSONArray chords = new JSONArray();
        for (int i = 0; i < raw.length();) {
            char ch = raw.charAt(i);
            if (ch == '\\' && i + 1 < raw.length()) { text.append(raw.charAt(i + 1)); i += 2; continue; }
            if (ch == '[') {
                int close = raw.indexOf(']', i + 1);
                if (close >= 0) {
                    chords.put(new JSONObject().put("at", text.length()).put("raw", raw.substring(i + 1, close)));
                    i = close + 1; continue;
                }
            }
            text.append(ch); i++;
        }
        JSONObject result = new JSONObject();
        result.put("text", text.toString()); result.put("chords", chords);
        result.put("bass", pending.optJSONArray("bass") == null ? new JSONArray() : pending.getJSONArray("bass"));
        nullable(result, "singers", pending.optString("singers", null));
        nullable(result, "indent", pending.has("indent") && !pending.isNull("indent") ? pending.get("indent") : null);
        nullable(result, "color", pending.optString("color", null));
        return result;
    }

    private static JSONObject block(String id, String type, JSONObject pending) throws JSONException {
        JSONObject out = new JSONObject();
        out.put("id", id); out.put("type", type);
        nullable(out, "label", pending.optString("label", null));
        nullable(out, "singers", pending.optString("singers", null));
        nullable(out, "repeat", pending.has("repeat") && !pending.isNull("repeat") ? pending.get("repeat") : null);
        out.put("linkToPrevious", pending.optBoolean("linkToPrevious", false));
        out.put("bandOnly", pending.optBoolean("bandOnly", false));
        out.put("lines", new JSONArray());
        return out;
    }

    static JSONObject parse(String source) throws JSONException {
        String now = new Date().toInstant().toString();
        JSONObject song = new JSONObject();
        song.put("id", ""); nullable(song, "legacyUuid", null); song.put("title", "");
        nullable(song, "writtenKey", null); nullable(song, "performanceKey", null);
        nullable(song, "tempo", null); nullable(song, "timeSignature", null);
        song.put("authors", new JSONArray()); nullable(song, "copyright", null); nullable(song, "ccli", null);
        song.put("tags", new JSONArray()); song.put("collectionIds", new JSONArray()); song.put("blocks", new JSONArray());
        nullable(song, "arrangement", null); nullable(song, "lang", null);
        song.put("createdAt", now); song.put("updatedAt", now); song.put("rev", 0);

        Map<String, Integer> counters = new HashMap<>();
        JSONObject pendingBlock = new JSONObject();
        JSONObject pendingLine = new JSONObject();
        JSONObject current = null;
        boolean environment = false;

        for (String raw : source.split("\\r\\n|\\r|\\n", -1)) {
            Matcher matcher = DIRECTIVE.matcher(raw);
            if (!matcher.matches()) {
                if (raw.trim().isEmpty() && !environment) { current = close(song, current); continue; }
                if (raw.trim().startsWith("#")) continue;
                if (current == null) {
                    String id = nextId(counters, "Verse");
                    current = block(id, "Verse", pendingBlock); pendingBlock = new JSONObject();
                }
                current.getJSONArray("lines").put(line(raw, pendingLine)); pendingLine = new JSONObject();
                continue;
            }
            String original = matcher.group(1).toLowerCase(Locale.ROOT);
            String name = ALIASES.containsKey(original) ? ALIASES.get(original) : original;
            String value = matcher.group(2);
            if ("title".equals(name)) song.put("title", value == null ? "" : value);
            else if ("artist".equals(name) || "composer".equals(name) || "lyricist".equals(name)) { if (value != null) song.getJSONArray("authors").put(value); }
            else if ("key".equals(name)) nullable(song, "writtenKey", nullableString(value));
            else if ("tempo".equals(name)) nullable(song, "tempo", number(value));
            else if ("time".equals(name)) nullable(song, "timeSignature", nullableString(value));
            else if ("copyright".equals(name)) nullable(song, "copyright", nullableString(value));
            else if ("ccli".equals(name)) nullable(song, "ccli", nullableString(value));
            else if ("lang".equals(name)) nullable(song, "lang", nullableString(value));
            else if ("x_id".equals(name)) song.put("id", value == null ? "" : value);
            else if ("x_legacy_uuid".equals(name)) nullable(song, "legacyUuid", nullableString(value));
            else if ("x_performance_key".equals(name)) nullable(song, "performanceKey", nullableString(value));
            else if ("x_tags".equals(name)) song.put("tags", csv(value));
            else if ("x_collections".equals(name)) song.put("collectionIds", csv(value));
            else if ("x_arrangement".equals(name)) { JSONArray values = words(value); nullable(song, "arrangement", values.length() == 0 ? null : values); }
            else if ("x_created".equals(name) && value != null) song.put("createdAt", value);
            else if ("x_updated".equals(name) && value != null) song.put("updatedAt", value);
            else if ("x_rev".equals(name)) song.put("rev", number(value) == null ? 0 : number(value));
            else if ("x_type".equals(name) && value != null && TYPES.contains(value.trim())) pendingBlock.put("type", value.trim());
            else if ("x_block_id".equals(name)) nullable(pendingBlock, "id", nullableString(value));
            else if ("x_label".equals(name)) nullable(pendingBlock, "label", nullableString(value));
            else if ("x_repeat".equals(name)) nullable(pendingBlock, "repeat", number(value));
            else if ("x_link_prev".equals(name)) pendingBlock.put("linkToPrevious", true);
            else if ("x_band_only".equals(name)) pendingBlock.put("bandOnly", true);
            else if ("x_block_singers".equals(name)) nullable(pendingBlock, "singers", singer(value));
            else if ("x_singers".equals(name)) nullable(pendingLine, "singers", singer(value));
            else if ("x_indent".equals(name)) nullable(pendingLine, "indent", number(value));
            else if ("x_color".equals(name)) nullable(pendingLine, "color", nullableString(value));
            else if ("x_bass".equals(name)) pendingLine.put("bass", anchors(value));
            else if (name.startsWith("start_of_")) {
                current = close(song, current);
                String env = name.substring("start_of_".length());
                String type = "chorus".equals(env) ? "Chorus" : "bridge".equals(env) ? "Bridge" : "Verse";
                if (pendingBlock.has("type")) type = pendingBlock.getString("type");
                String id = pendingBlock.optString("id", value == null || value.trim().isEmpty() ? nextId(counters, type) : value.trim());
                current = block(id, type, pendingBlock); pendingBlock = new JSONObject(); environment = true;
            } else if (name.startsWith("end_of_")) { current = close(song, current); environment = false; }
            else if ("comment".equals(name) || "comment_italic".equals(name) || "comment_box".equals(name)) {
                current = close(song, current);
                JSONObject note = block(nextId(counters, "Note"), "Note", new JSONObject());
                note.getJSONArray("lines").put(line(value == null ? "" : value, new JSONObject())); song.getJSONArray("blocks").put(note);
            }
        }
        close(song, current);
        if (song.getString("id").isEmpty()) song.put("id", UUID.randomUUID().toString());
        return song;
    }

    private static JSONObject close(JSONObject song, JSONObject current) throws JSONException {
        if (current != null) {
            JSONArray lines = current.getJSONArray("lines");
            boolean content = false;
            for (int i = 0; i < lines.length(); i++) {
                JSONObject line = lines.getJSONObject(i);
                if (!line.optString("text").isEmpty() || line.getJSONArray("chords").length() > 0) { content = true; break; }
            }
            if (content) song.getJSONArray("blocks").put(current);
        }
        return null;
    }

    private static String nextId(Map<String, Integer> counters, String type) {
        String prefix = "Verse".equals(type) ? "V" : "Chorus".equals(type) ? "C" : "PreChorus".equals(type) ? "P" : "Bridge".equals(type) ? "B" : "Ending".equals(type) ? "E" : "Tag".equals(type) ? "T" : "Intro".equals(type) ? "I" : "Instrumental".equals(type) ? "N" : "Solo".equals(type) ? "S" : "M";
        int next = counters.containsKey(prefix) ? counters.get(prefix) + 1 : 1; counters.put(prefix, next); return prefix + next;
    }

    private static String value(JSONObject object, String key) { return object.isNull(key) ? null : object.optString(key, null); }
    private static String directive(String name, Object value) {
        if (value == null || value == JSONObject.NULL || String.valueOf(value).isEmpty()) return null;
        return "{" + name + ": " + value + "}";
    }
    private static void add(List<String> lines, String line) { if (line != null) lines.add(line); }
    private static String join(JSONArray values, String separator) throws JSONException {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.length(); i++) { if (i > 0) out.append(separator); out.append(values.getString(i)); }
        return out.toString();
    }
    private static String lyric(JSONObject line) throws JSONException {
        String text = line.getString("text"); JSONArray chords = line.getJSONArray("chords");
        List<JSONObject> sorted = new ArrayList<>(); for (int i = 0; i < chords.length(); i++) sorted.add(chords.getJSONObject(i));
        Collections.sort(sorted, (a, b) -> Integer.compare(a.optInt("at"), b.optInt("at")));
        StringBuilder out = new StringBuilder(); int cursor = 0;
        for (JSONObject chord : sorted) {
            int at = Math.max(0, Math.min(chord.optInt("at"), text.length()));
            out.append(escape(text.substring(cursor, at))).append('[').append(chord.optString("raw")).append(']'); cursor = at;
        }
        return out.append(escape(text.substring(cursor))).toString();
    }
    private static String escape(String value) { return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("{", "\\{").replace("}", "\\}"); }

    static String serialize(JSONObject song) throws JSONException {
        List<String> out = new ArrayList<>();
        add(out, directive("title", song.optString("title")));
        JSONArray authors = song.optJSONArray("authors"); if (authors != null) for (int i = 0; i < authors.length(); i++) add(out, directive("artist", authors.getString(i)));
        add(out, directive("key", value(song, "writtenKey"))); add(out, directive("tempo", song.isNull("tempo") ? null : song.get("tempo")));
        add(out, directive("time", value(song, "timeSignature"))); add(out, directive("copyright", value(song, "copyright")));
        add(out, directive("ccli", value(song, "ccli"))); add(out, directive("lang", value(song, "lang")));
        add(out, directive("x_id", song.getString("id"))); add(out, directive("x_legacy_uuid", value(song, "legacyUuid")));
        add(out, directive("x_performance_key", value(song, "performanceKey")));
        JSONArray tags = song.optJSONArray("tags"); add(out, directive("x_tags", tags == null || tags.length() == 0 ? null : join(tags, ", ")));
        JSONArray collections = song.optJSONArray("collectionIds"); add(out, directive("x_collections", collections == null || collections.length() == 0 ? null : join(collections, ", ")));
        JSONArray arrangement = song.optJSONArray("arrangement"); add(out, directive("x_arrangement", arrangement == null || arrangement.length() == 0 ? null : join(arrangement, " ")));
        add(out, directive("x_created", song.optString("createdAt"))); add(out, directive("x_updated", song.optString("updatedAt"))); add(out, directive("x_rev", song.opt("rev")));
        JSONArray blocks = song.optJSONArray("blocks");
        if (blocks != null) for (int i = 0; i < blocks.length(); i++) {
            JSONObject block = blocks.getJSONObject(i); out.add(""); String type = block.getString("type");
            String env = "Chorus".equals(type) ? "chorus" : "Bridge".equals(type) ? "bridge" : "verse";
            if (!("Verse".equals(type) || "Chorus".equals(type) || "Bridge".equals(type))) add(out, directive("x_type", type));
            add(out, directive("x_label", value(block, "label"))); add(out, directive("x_block_singers", value(block, "singers")));
            add(out, directive("x_repeat", block.isNull("repeat") ? null : block.get("repeat")));
            if (block.optBoolean("linkToPrevious")) out.add("{x_link_prev}"); if (block.optBoolean("bandOnly")) out.add("{x_band_only}");
            out.add("{start_of_" + env + ": " + block.getString("id") + "}");
            JSONArray lines = block.getJSONArray("lines");
            for (int j = 0; j < lines.length(); j++) {
                JSONObject line = lines.getJSONObject(j); add(out, directive("x_singers", value(line, "singers")));
                add(out, directive("x_indent", line.isNull("indent") ? null : line.get("indent"))); add(out, directive("x_color", value(line, "color")));
                JSONArray bass = line.optJSONArray("bass");
                if (bass != null && bass.length() > 0) { StringBuilder b = new StringBuilder(); for (int k = 0; k < bass.length(); k++) { JSONObject anchor = bass.getJSONObject(k); if (k > 0) b.append(' '); b.append(anchor.getInt("at")).append(':').append(anchor.getString("raw")); } add(out, directive("x_bass", b)); }
                out.add(lyric(line));
            }
            out.add("{end_of_" + env + "}");
        }
        out.add(""); return String.join("\n", out);
    }
}
