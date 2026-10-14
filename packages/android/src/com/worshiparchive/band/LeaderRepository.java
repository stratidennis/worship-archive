package com.worshiparchive.band;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;

/** Filesystem-backed Android Leader library. ChordPro and set JSON remain cloud-portable. */
final class LeaderRepository {
    static final String MAIN = "Main";
    private final File root;
    private final File songs;
    private final File sets;
    private final File revisions;

    LeaderRepository(File root) throws IOException {
        this.root = root; songs = new File(root, "Songs"); sets = new File(root, "Sets"); revisions = new File(root, "Revisions");
        mkdir(songs); mkdir(sets); mkdir(revisions);
    }
    File root() { return root; }
    private static void mkdir(File file) throws IOException { if (!file.isDirectory() && !file.mkdirs()) throw new IOException("Could not create " + file); }
    private static String read(File file) throws IOException { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); }
    private static void write(File file, String value) throws IOException {
        mkdir(file.getParentFile()); File temporary = new File(file.getParentFile(), "." + file.getName() + ".tmp");
        Files.write(temporary.toPath(), value.getBytes(StandardCharsets.UTF_8));
        try { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
        catch (AtomicMoveNotSupportedException error) { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    }
    private static List<File> files(File directory, String extension) {
        List<File> out = new ArrayList<>(); File[] entries = directory.listFiles(); if (entries == null) return out;
        for (File entry : entries) { if (entry.getName().startsWith(".")) continue; if (entry.isDirectory()) out.addAll(files(entry, extension)); else if (entry.getName().toLowerCase(Locale.ROOT).endsWith(extension)) out.add(entry); }
        return out;
    }
    private static String relative(File parent, File child) { return parent.toPath().relativize(child.toPath()).toString().replace(File.separatorChar, '/'); }
    private static String location(File file, File songs) { String path = relative(songs, file); int slash = path.indexOf('/'); return slash < 0 ? MAIN : path.substring(0, slash); }
    private static JSONObject clone(JSONObject value) throws JSONException { return new JSONObject(value.toString()); }

    synchronized List<SongFile> songFiles() throws IOException, JSONException {
        List<SongFile> out = new ArrayList<>();
        for (File file : files(songs, ".chopro")) out.add(new SongFile(file, ChordPro.parse(read(file)), location(file, songs)));
        Collections.sort(out, (a, b) -> a.song.optString("title").compareToIgnoreCase(b.song.optString("title")));
        return out;
    }
    synchronized JSONArray allSongs() throws Exception { JSONArray out = new JSONArray(); for (SongFile file : songFiles()) out.put(file.song); return out; }
    synchronized SongFile song(String id) throws Exception { for (SongFile file : songFiles()) if (id.equals(file.song.optString("id"))) return file; return null; }
    synchronized JSONArray locations() {
        List<String> names = new ArrayList<>(); names.add(MAIN); File[] entries = songs.listFiles();
        if (entries != null) for (File entry : entries) if (entry.isDirectory() && !entry.getName().startsWith(".")) names.add(entry.getName());
        Collections.sort(names.subList(1, names.size()), String.CASE_INSENSITIVE_ORDER); return new JSONArray(names);
    }
    synchronized String createLocation(String name) throws IOException {
        String value = name == null ? "" : name.trim(); if (value.isEmpty() || MAIN.equalsIgnoreCase(value)) return MAIN;
        if (value.length() > 100 || value.matches(".*[<>:\"/\\\\|?*].*") || value.endsWith(".") || value.endsWith(" ")) throw new IOException("Invalid folder name");
        JSONArray existingLocations = locations();
        for (int i = 0; i < existingLocations.length(); i++) {
            String existing = existingLocations.optString(i);
            if (value.equalsIgnoreCase(existing)) return existing;
        }
        mkdir(new File(songs, value)); return value;
    }
    synchronized JSONObject saveSong(JSONObject incoming, String location) throws Exception {
        JSONObject song = clone(incoming); String id = song.getString("id"); SongFile previous = song(id); String now = Instant.now().toString();
        if (previous != null) {
            File folder = new File(revisions, id); mkdir(folder);
            write(new File(folder, previous.song.optInt("rev", 0) + ".json"), previous.song.toString(2));
        }
        song.put("rev", previous == null ? 1 : previous.song.optInt("rev", 0) + 1);
        song.put("createdAt", previous == null ? song.optString("createdAt", now) : previous.song.optString("createdAt", now)); song.put("updatedAt", now);
        String selected = createLocation(location == null ? (previous == null ? MAIN : previous.location) : location);
        File directory = MAIN.equals(selected) ? songs : new File(songs, selected); mkdir(directory);
        String oldName = previous == null ? slug(song.optString("title"), id) + ".chopro" : previous.file.getName();
        File target = new File(directory, oldName);
        if (previous == null && target.exists()) target = new File(directory, slug(song.optString("title"), id) + "-" + id.substring(0, Math.min(8, id.length())) + ".chopro");
        write(target, ChordPro.serialize(song));
        if (previous != null && !previous.file.equals(target)) Files.deleteIfExists(previous.file.toPath());
        return song;
    }
    synchronized boolean deleteSong(String id) throws Exception { SongFile found = song(id); return found != null && Files.deleteIfExists(found.file.toPath()); }

    synchronized JSONArray revisions(String id) throws Exception {
        List<JSONObject> values=new ArrayList<>();File folder=new File(revisions,id);File[] entries=folder.listFiles((directory,name)->name.toLowerCase(Locale.ROOT).endsWith(".json"));
        if(entries!=null)for(File entry:entries){try{JSONObject song=new JSONObject(read(entry));values.add(new JSONObject().put("rev",song.optInt("rev",0)).put("title",song.optString("title")).put("savedAt",Instant.ofEpochMilli(entry.lastModified()).toString()));}catch(Exception ignored){}}
        values.sort((a,b)->Integer.compare(b.optInt("rev"),a.optInt("rev")));JSONArray out=new JSONArray();for(int i=0;i<Math.min(50,values.size());i++)out.put(values.get(i));return out;
    }
    synchronized JSONObject revision(String id,int rev) throws Exception {
        File folder=new File(revisions,id);File[] entries=folder.listFiles((directory,name)->name.toLowerCase(Locale.ROOT).endsWith(".json"));if(entries==null)return null;
        for(File entry:entries)try{JSONObject song=new JSONObject(read(entry));if(song.optInt("rev",-1)==rev)return song;}catch(Exception ignored){}return null;
    }
    synchronized JSONObject revert(String id,int rev) throws Exception {
        JSONObject old=revision(id,rev);if(old==null)return null;SongFile current=song(id);String location=current==null?MAIN:current.location;old.put("id",id);return saveSong(old,location);
    }

    synchronized JSONArray allSets() throws Exception { JSONArray out = new JSONArray(); for (SetFile file : setFiles()) out.put(file.set); return out; }
    synchronized List<SetFile> setFiles() throws Exception {
        List<SetFile> out = new ArrayList<>(); for (File file : files(sets, ".json")) out.add(new SetFile(file, new JSONObject(read(file))));
        Collections.sort(out, (a, b) -> b.set.optString("date", b.set.optString("updatedAt")).compareTo(a.set.optString("date", a.set.optString("updatedAt")))); return out;
    }
    synchronized SetFile set(String id) throws Exception { for (SetFile file : setFiles()) if (id.equals(file.set.optString("id"))) return file; return null; }
    synchronized JSONObject saveSet(JSONObject incoming) throws Exception {
        JSONObject set = clone(incoming); String id = set.getString("id"); SetFile previous = set(id); String now = Instant.now().toString();
        set.put("rev", previous == null ? 1 : previous.set.optInt("rev", 0) + 1); set.put("createdAt", previous == null ? set.optString("createdAt", now) : previous.set.optString("createdAt", now)); set.put("updatedAt", now);
        String base = set.isNull("date") || set.optString("date").isEmpty() ? slug(set.optString("title"), id) : set.optString("date");
        File target = previous == null ? new File(sets, base + "-" + id.substring(0, Math.min(8, id.length())) + ".json") : previous.file;
        write(target, set.toString(2)); return set;
    }
    synchronized boolean deleteSet(String id) throws Exception { SetFile found = set(id); return found != null && Files.deleteIfExists(found.file.toPath()); }

    synchronized JSONObject restore(JSONObject request) throws Exception {
        JSONObject backup=request.optJSONObject("backup");if(backup==null)backup=request;
        if(!"worship-archive-backup".equals(backup.optString("format"))||backup.optJSONArray("songs")==null||backup.optJSONArray("sets")==null)throw new IOException("not a Worship Archive backup file");
        boolean replace="replace".equals(request.optString("mode"));JSONArray skipped=new JSONArray();Set<String> keepSongs=new HashSet<>(),keepSets=new HashSet<>();
        int songCount=restoreFiles(songs,backup.getJSONArray("songs"),".chopro",keepSongs,skipped);int setCount=restoreFiles(sets,backup.getJSONArray("sets"),".json",keepSets,skipped);int removed=0;
        if(replace){for(File file:files(songs,".chopro"))if(!keepSongs.contains(relative(songs,file))&&Files.deleteIfExists(file.toPath()))removed++;for(File file:files(sets,".json"))if(!keepSets.contains(relative(sets,file))&&Files.deleteIfExists(file.toPath()))removed++;}
        return new JSONObject().put("songs",songCount).put("sets",setCount).put("removed",removed).put("skipped",skipped);
    }
    private static int restoreFiles(File root,JSONArray entries,String extension,Set<String> keep,JSONArray skipped)throws Exception{
        int written=0;String rootPath=root.getCanonicalPath()+File.separator;
        for(int i=0;i<entries.length();i++){JSONObject entry=entries.optJSONObject(i);String path=entry==null?"":entry.optString("path");String text=entry==null?null:entry.optString("text",null);
            try{File target=new File(root,path);String canonical=target.getCanonicalPath();if(path.isEmpty()||!canonical.startsWith(rootPath)||!path.toLowerCase(Locale.ROOT).endsWith(extension))throw new IOException("invalid library path");if(text==null)throw new IOException("no text");write(target,text);keep.add(relative(root,target));written++;}
            catch(Exception error){skipped.put(new JSONObject().put("path",path).put("error",error.getMessage()==null?error.toString():error.getMessage()));}}
        return written;
    }

    synchronized String fingerprint() throws Exception {
        List<String> lines = new ArrayList<>(); for (SongFile file : songFiles()) lines.add("s:" + file.song.getString("id") + ":" + file.song.optString("updatedAt"));
        for (SetFile file : setFiles()) lines.add("p:" + file.set.getString("id") + ":" + file.set.optString("updatedAt")); Collections.sort(lines);
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] bytes = digest.digest(String.join("\n", lines).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(); for (byte one : bytes) hex.append(String.format("%02x", one)); return hex.substring(0, 32);
    }
    private static String slug(String title, String fallback) {
        String value = Normalizer.normalize(title, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (value.length() > 60) value = value.substring(0, 60); return value.isEmpty() ? fallback.substring(0, Math.min(8, fallback.length())) : value;
    }

    static final class SongFile { final File file; final JSONObject song; final String location; SongFile(File file, JSONObject song, String location) { this.file = file; this.song = song; this.location = location; } }
    static final class SetFile { final File file; final JSONObject set; SetFile(File file, JSONObject set) { this.file = file; this.set = set; } }
}
