package com.worshiparchive.band;

import android.content.*;
import android.net.Uri;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Native Android Leader HTTP/API/WebSocket host. */
final class LocalLeaderServer implements Closeable {
    interface Assets { InputStream open(String path) throws IOException; }
    private final Assets assets; private final LeaderRepository repository; private final LeaderSessionHub hub; private final AndroidCloudSync cloud;
    private final ServerSocket listener; private final ExecutorService workers = Executors.newCachedThreadPool(); private final ScheduledExecutorService background = Executors.newSingleThreadScheduledExecutor(); private volatile boolean closed;

    LocalLeaderServer(int port, Context context, SharedPreferences preferences, File files, String leaderId, Assets assets) throws Exception {
        this.assets = assets; repository = new LeaderRepository(new File(files, "library")); hub = new LeaderSessionHub(new File(files, "session.json"), leaderId); cloud = new AndroidCloudSync(context, preferences, repository.root());
        listener = new ServerSocket(); listener.setReuseAddress(true); listener.bind(new InetSocketAddress("0.0.0.0", port));
        workers.execute(() -> { while (!closed) try { Socket socket = listener.accept(); workers.execute(() -> serve(socket)); } catch (Exception error) { if (!closed) close(); } });
        // Cloud synchronization is event-driven: once at startup, then after local
        // song/set mutations (see changed()). There is deliberately no polling loop.
        background.schedule(this::syncCloudQuietly, 2, TimeUnit.SECONDS);
        background.scheduleWithFixedDelay(hub::heartbeat,5,5,TimeUnit.SECONDS);
    }
    int port() { return listener.getLocalPort(); }
    String origin() { return "http://127.0.0.1:" + port(); }
    void networkAvailable() { if (cloud.configured() && !closed) background.execute(this::syncCloudQuietly); }
    void selectCloudFolder(Uri uri,int flags) throws Exception { cloud.select(uri,flags); background.execute(this::syncCloudQuietly); }
    void disconnectCloudFolder() { cloud.disconnect(); }
    Uri cloudFolder() { return cloud.tree(); }
    private void syncCloudQuietly() { if (!cloud.configured() || closed) return; try { JSONObject result=cloud.sync(); if(result.optInt("pulled")+result.optInt("deletedLocally")>0)hub.reloadLibrary(); } catch(Exception error){android.util.Log.w("WorshipCloud", "Cloud sync unavailable", error);} }
    private void changed() { hub.reloadLibrary(); if(cloud.configured())background.execute(this::syncCloudQuietly); }

    private void serve(Socket socket) {
        boolean websocket = false;
        try {
            socket.setSoTimeout(15000); InputStream input = socket.getInputStream(); String header = readHeader(input); String[] lines = header.split("\r\n"); String[] first = lines[0].split(" ");
            if (first.length != 3) { text(socket, 400, "Bad request"); return; }
            Map<String, String> headers = new LinkedHashMap<>(); for (int i = 1; i < lines.length; i++) { int at = lines[i].indexOf(':'); if (at > 0) headers.put(lines[i].substring(0, at).toLowerCase(Locale.ROOT), lines[i].substring(at + 1).trim()); }
            URI uri = URI.create(first[1]); String path = uri.getPath(); String method = first[0]; boolean local = socket.getInetAddress().isLoopbackAddress();
            if ("/ws".equals(path)) { websocket = true; hub.accept(socket, headers, local); return; }
            byte[] body = readBody(input, headers); if (path.startsWith("/api/")) api(socket, method, path, query(uri), body, local); else if ("GET".equals(method)) asset(socket, path); else text(socket, 405, "Method not allowed");
        } catch (Exception error) { try { json(socket, 500, new JSONObject().put("error", error.getMessage() == null ? error.toString() : error.getMessage())); } catch (Exception ignored) { } }
        finally { if (!websocket) try { socket.close(); } catch (IOException ignored) { } }
    }

    private void api(Socket socket, String method, String path, Map<String, String> query, byte[] bytes, boolean local) throws Exception {
        if (!("GET".equals(method) || "OPTIONS".equals(method)) && !local) { json(socket, 403, error("Leader controls are only available on the host")); return; }
        if ("OPTIONS".equals(method)) { header(socket, 204, "application/json", 0); return; }
        JSONObject body = bytes.length == 0 ? new JSONObject() : new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if ("GET".equals(method) && "/api/stats".equals(path)) { json(socket, 200, new JSONObject().put("songs", repository.songFiles().size()).put("collections", repository.locations().length()).put("songsDir", new File(repository.root(), "Songs").getAbsolutePath())); return; }
        if ("GET".equals(method) && "/api/facets".equals(path)) { json(socket, 200, facets()); return; }
        if ("GET".equals(method) && "/api/song-locations".equals(path)) { json(socket, 200, new JSONObject().put("locations", repository.locations())); return; }
        if ("POST".equals(method) && "/api/song-locations".equals(path)) { json(socket, 201, new JSONObject().put("location", repository.createLocation(body.optString("name")))); return; }
        if ("GET".equals(method) && path.startsWith("/api/song-locations/")) { LeaderRepository.SongFile song = repository.song(decode(path.substring(20))); if (song == null) { json(socket, 404, error("not found")); return; } json(socket, 200, new JSONObject().put("location", song.location)); return; }
        if ("GET".equals(method) && "/api/songs".equals(path)) { json(socket, 200, listSongs(query)); return; }
        if ("GET".equals(method) && "/api/search".equals(path)) { json(socket, 200, search(query.get("q"))); return; }
        if ("POST".equals(method) && "/api/songs".equals(path)) { JSONObject song = newSong(body); JSONObject saved = repository.saveSong(song, query.get("location")); changed(); json(socket, 201, saved); return; }
        if (path.startsWith("/api/songs/")) {
            String suffix = path.substring(11); int revisionsAt=suffix.indexOf("/revisions");
            if(revisionsAt>=0){String id=decode(suffix.substring(0,revisionsAt));String tail=suffix.substring(revisionsAt+10);if(tail.isEmpty()&&"GET".equals(method)){json(socket,200,repository.revisions(id));return;}String value=tail.startsWith("/")?tail.substring(1):tail;boolean restore=value.endsWith("/restore");if(restore)value=value.substring(0,value.length()-8);int revision;try{revision=Integer.parseInt(value);}catch(Exception error){json(socket,404,error("not found"));return;}JSONObject saved=restore&&"POST".equals(method)?repository.revert(id,revision):repository.revision(id,revision);if(saved==null){json(socket,404,error("not found"));return;}if(restore){changed();json(socket,200,saved);}else if("GET".equals(method))json(socket,200,saved);else json(socket,405,error("Method not allowed"));return;}
            String id = decode(suffix);
            if ("GET".equals(method)) { LeaderRepository.SongFile song = repository.song(id); if (song == null) json(socket, 404, error("not found")); else json(socket, 200, song.song); return; }
            if ("PUT".equals(method)) { body.put("id", id); JSONObject saved = repository.saveSong(body, query.get("location")); changed(); json(socket, 200, saved); return; }
            if ("DELETE".equals(method)) { if (!repository.deleteSong(id)) json(socket, 404, error("not found")); else { changed(); header(socket, 204, "application/json", 0); } return; }
        }
        if ("GET".equals(method) && "/api/sets".equals(path)) { json(socket, 200, listSets()); return; }
        if ("POST".equals(method) && "/api/sets".equals(path)) { JSONObject saved = repository.saveSet(newSet(body)); changed(); json(socket, 201, saved); return; }
        if (path.startsWith("/api/sets/")) {
            String suffix = path.substring(10); boolean full = suffix.endsWith("/full"); boolean duplicate = suffix.endsWith("/duplicate"); String id = decode(suffix.replaceFirst("/(full|duplicate)$", "")); LeaderRepository.SetFile set = repository.set(id);
            if (set == null) { json(socket, 404, error("not found")); return; }
            if (full && "GET".equals(method)) { json(socket, 200, fullSet(set.set)); return; }
            if (duplicate && "POST".equals(method)) { JSONObject copy = new JSONObject(set.set.toString()).put("id", UUID.randomUUID().toString()).put("rev", 0).put("createdAt", Instant.now().toString()).put("updatedAt", Instant.now().toString()); if (body.has("title")) copy.put("title", body.get("title")); if (body.has("date")) copy.put("date", body.get("date")); JSONObject saved=repository.saveSet(copy);changed();json(socket, 201, saved); return; }
            if ("GET".equals(method)) { json(socket, 200, set.set); return; }
            if ("PUT".equals(method)) { body.put("id", id); JSONObject saved = repository.saveSet(body); changed(); json(socket, 200, saved); return; }
            if ("DELETE".equals(method)) { repository.deleteSet(id); changed(); header(socket, 204, "application/json", 0); return; }
        }
        if ("GET".equals(method) && "/api/library/export".equals(path)) { String fingerprint = repository.fingerprint(); if (fingerprint.equals(query.get("since"))) { header(socket, 204, "application/json", 0); return; } json(socket, 200, new JSONObject().put("songs", repository.allSongs()).put("sets", repository.allSets()).put("fingerprint", fingerprint).put("exportedAt", Instant.now().toString())); return; }
        if ("GET".equals(method) && "/api/host".equals(path)) { JSONArray addresses = addresses(); json(socket, 200, new JSONObject().put("addresses", addresses).put("interfaces", interfaces()).put("port", port()).put("hostname", "android-leader").put("friendlyHostname", JSONObject.NULL).put("mdns", "published").put("mdnsError", JSONObject.NULL).put("servesInterface", true)); return; }
        if ("GET".equals(method) && "/api/network/ping".equals(path)) { json(socket, 200, new JSONObject().put("ok", true).put("leaderId", hub.state().optString("leaderId")).put("protocol", Protocol.VERSION).put("at", Instant.now().toString())); return; }
        if ("GET".equals(method) && "/api/session".equals(path)) { json(socket, 200, new JSONObject().put("state", hub.state()).put("devices", hub.devices())); return; }
        if ("PUT".equals(method) && "/api/session/host".equals(path)) { json(socket, 200, hub.patch(new JSONObject().put("host", body), false)); return; }
        if ("PUT".equals(method) && "/api/session/stage".equals(path)) { JSONObject state = hub.state(); JSONObject stage = state.optJSONObject("stage"); if (stage == null) stage = new JSONObject(); for (Iterator<String> keys = body.keys(); keys.hasNext();) { String key = keys.next(); if (!("screen".equals(key) || "deviceId".equals(key))) stage.put(key, body.get(key)); } hub.patch(new JSONObject().put("stage", stage), false); json(socket, 200, new JSONObject().put("stage", stage)); return; }
        if ("GET".equals(method) && "/api/cloud-sync".equals(path)) { json(socket, 200, cloud.status()); return; }
        if ("POST".equals(method) && "/api/cloud-sync".equals(path)) { JSONObject result=cloud.sync();if(result.optInt("pulled")+result.optInt("deletedLocally")>0)hub.reloadLibrary();json(socket,200,result);return; }
        if (path.startsWith("/api/powerpoints/")) { json(socket, 503, error("PowerPoint is available in the desktop Leader")); return; }
        if ("GET".equals(method) && "/api/backup".equals(path)) { json(socket, 200, backup()); return; }
        if ("POST".equals(method) && "/api/restore".equals(path)) { JSONObject result=repository.restore(body);changed();json(socket,200,result);return; }
        if (path.startsWith("/api/cleanup")) { json(socket, 200, new JSONObject().put("suggestions", new JSONArray()).put("spellings", new JSONArray()).put("songsAffected", 0).put("chordsScanned", 0)); return; }
        json(socket, 404, error("not found"));
    }

    private JSONObject facets() throws Exception {
        Map<String,Integer> locations = new TreeMap<>(String.CASE_INSENSITIVE_ORDER), tags = new HashMap<>(), keys = new HashMap<>();
        for (LeaderRepository.SongFile file : repository.songFiles()) { locations.put(file.location, locations.containsKey(file.location) ? locations.get(file.location) + 1 : 1); JSONArray songTags = file.song.optJSONArray("tags"); if (songTags != null) for (int i=0;i<songTags.length();i++) count(tags,songTags.getString(i)); String key = file.song.optString("performanceKey", file.song.optString("writtenKey", "")); if (!key.isEmpty()) count(keys,key); }
        return new JSONObject().put("collections", counted(locations)).put("tags", counted(tags)).put("keys", counted(keys));
    }
    private static void count(Map<String,Integer> values,String key){ values.put(key,values.containsKey(key)?values.get(key)+1:1); }
    private static JSONArray counted(Map<String,Integer> values) throws JSONException { List<String> names = new ArrayList<>(values.keySet()); Collections.sort(names,String.CASE_INSENSITIVE_ORDER); JSONArray out=new JSONArray(); for(String name:names)out.put(new JSONObject().put("name",name).put("count",values.get(name)));return out; }
    private JSONArray listSongs(Map<String,String> query) throws Exception { List<JSONObject> values=new ArrayList<>(); for(LeaderRepository.SongFile file:repository.songFiles()){ JSONObject summary=summary(file); if(query.containsKey("collection")&&!query.get("collection").equals(file.location))continue; if(query.containsKey("tag")&&!contains(file.song.optJSONArray("tags"),query.get("tag")))continue; values.add(summary);} if("updated".equals(query.get("sort")))Collections.sort(values,(a,b)->b.optString("updatedAt").compareTo(a.optString("updatedAt"))); JSONArray out=new JSONArray();for(JSONObject value:values)out.put(value);return out; }
    private JSONArray search(String raw) throws Exception { String term=fold(raw==null?"":raw);JSONArray out=new JSONArray();if(term.isEmpty())return out;for(LeaderRepository.SongFile file:repository.songFiles()){StringBuilder text=new StringBuilder(file.song.optString("title"));JSONArray blocks=file.song.optJSONArray("blocks");if(blocks!=null)for(int i=0;i<blocks.length();i++){JSONArray lines=blocks.getJSONObject(i).optJSONArray("lines");if(lines!=null)for(int j=0;j<lines.length();j++)text.append('\n').append(lines.getJSONObject(j).optString("text"));}if(fold(text.toString()).contains(term))out.put(summary(file).put("snippet","").put("rank",0));}return out; }
    private static String fold(String text){return Normalizer.normalize(text,Normalizer.Form.NFD).replaceAll("\\p{M}","").toLowerCase(Locale.ROOT).trim();}
    private static boolean contains(JSONArray array,String value){if(array==null)return false;for(int i=0;i<array.length();i++)if(value.equals(array.optString(i)))return true;return false;}
    private JSONObject summary(LeaderRepository.SongFile file)throws JSONException{JSONObject song=file.song;return new JSONObject().put("id",song.optString("id")).put("title",song.optString("title")).put("writtenKey",song.opt("writtenKey")).put("performanceKey",song.opt("performanceKey")).put("tempo",song.opt("tempo")).put("timeSignature",song.opt("timeSignature")).put("authors",song.optJSONArray("authors")).put("tags",song.optJSONArray("tags")).put("collection",file.location).put("updatedAt",song.optString("updatedAt")).put("blockCount",song.optJSONArray("blocks")==null?0:song.optJSONArray("blocks").length());}
    private JSONArray listSets() throws Exception { JSONArray out=new JSONArray();for(LeaderRepository.SetFile file:repository.setFiles()){JSONObject set=file.set;int songs=0;JSONArray items=set.optJSONArray("items");if(items!=null)for(int i=0;i<items.length();i++)if("song".equals(items.getJSONObject(i).optString("kind")))songs++;out.put(new JSONObject().put("id",set.optString("id")).put("title",set.optString("title")).put("date",set.opt("date")).put("itemCount",items==null?0:items.length()).put("songCount",songs).put("updatedAt",set.optString("updatedAt")));}return out;}
    private JSONObject fullSet(JSONObject set)throws Exception{JSONObject songs=new JSONObject();JSONArray items=set.optJSONArray("items");if(items!=null)for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if("song".equals(item.optString("kind"))){LeaderRepository.SongFile song=repository.song(item.optString("songId"));if(song!=null)songs.put(song.song.getString("id"),song.song);}}return new JSONObject().put("set",set).put("songs",songs);}
    private static Object nullableValue(JSONObject object,String key)throws JSONException{return object.has(key)&&!object.isNull(key)?object.get(key):JSONObject.NULL;}
    private static JSONObject newSong(JSONObject incoming)throws JSONException{String now=Instant.now().toString();JSONObject song=new JSONObject().put("id",UUID.randomUUID().toString()).put("legacyUuid",JSONObject.NULL).put("title",incoming.optString("title")).put("writtenKey",nullableValue(incoming,"writtenKey")).put("performanceKey",nullableValue(incoming,"performanceKey")).put("tempo",nullableValue(incoming,"tempo")).put("timeSignature",nullableValue(incoming,"timeSignature")).put("authors",incoming.optJSONArray("authors")==null?new JSONArray():incoming.optJSONArray("authors")).put("copyright",nullableValue(incoming,"copyright")).put("ccli",nullableValue(incoming,"ccli")).put("tags",incoming.optJSONArray("tags")==null?new JSONArray():incoming.optJSONArray("tags")).put("collectionIds",incoming.optJSONArray("collectionIds")==null?new JSONArray():incoming.optJSONArray("collectionIds")).put("arrangement",nullableValue(incoming,"arrangement")).put("lang",nullableValue(incoming,"lang")).put("createdAt",now).put("updatedAt",now).put("rev",0);if(incoming.optJSONArray("blocks")!=null)song.put("blocks",incoming.optJSONArray("blocks"));else song.put("blocks",new JSONArray().put(new JSONObject().put("id","V1").put("type","Verse").put("label",JSONObject.NULL).put("singers",JSONObject.NULL).put("repeat",JSONObject.NULL).put("linkToPrevious",false).put("bandOnly",false).put("lines",new JSONArray().put(new JSONObject().put("text","").put("chords",new JSONArray()).put("bass",new JSONArray()).put("singers",JSONObject.NULL).put("indent",JSONObject.NULL).put("color",JSONObject.NULL)))));return song;}
    private static JSONObject newSet(JSONObject incoming)throws JSONException{String now=Instant.now().toString();return new JSONObject().put("id",UUID.randomUUID().toString()).put("title",incoming.optString("title")).put("date",incoming.has("date")?incoming.opt("date"):JSONObject.NULL).put("items",incoming.optJSONArray("items")==null?new JSONArray():incoming.optJSONArray("items")).put("createdAt",now).put("updatedAt",now).put("rev",0);}
    private JSONObject backup()throws Exception{JSONArray songFiles=new JSONArray();for(LeaderRepository.SongFile song:repository.songFiles())songFiles.put(new JSONObject().put("path",relative(new File(repository.root(),"Songs"),song.file)).put("text",new String(java.nio.file.Files.readAllBytes(song.file.toPath()),StandardCharsets.UTF_8)));JSONArray setFiles=new JSONArray();for(LeaderRepository.SetFile set:repository.setFiles())setFiles.put(new JSONObject().put("path",set.file.getName()).put("text",set.set.toString(2)));return new JSONObject().put("format","worship-archive-backup").put("version",1).put("createdAt",Instant.now().toString()).put("counts",new JSONObject().put("songs",songFiles.length()).put("sets",setFiles.length())).put("songs",songFiles).put("sets",setFiles);}
    private static String relative(File parent,File child){return parent.toPath().relativize(child.toPath()).toString().replace(File.separatorChar,'/');}

    private void asset(Socket socket,String path)throws IOException{String resource=path.equals("/")?"index.html":path.substring(1);if(!resource.contains(".")||path.equals("/band")||path.equals("/stage")||path.startsWith("/archive")||path.startsWith("/song/")||path.startsWith("/edit/")||path.startsWith("/sets")||path.startsWith("/settings")||path.startsWith("/join")||path.startsWith("/import")||path.startsWith("/cleanup"))resource="index.html";if(resource.contains("..")||resource.contains("\\")){text(socket,403,"Invalid asset");return;}try(InputStream file=assets.open(resource)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();copy(file,bytes);byte[] body=bytes.toByteArray();header(socket,200,mime(resource),body.length);socket.getOutputStream().write(body);}catch(FileNotFoundException error){text(socket,404,"Not found");}}
    private static Map<String,String> query(URI uri)throws Exception{Map<String,String>out=new HashMap<>();if(uri.getRawQuery()==null)return out;for(String part:uri.getRawQuery().split("&")){int at=part.indexOf('=');out.put(decode(at<0?part:part.substring(0,at)),decode(at<0?"":part.substring(at+1)));}return out;}
    private static String decode(String value)throws UnsupportedEncodingException{return URLDecoder.decode(value,"UTF-8");}
    private static JSONObject error(String message)throws JSONException{return new JSONObject().put("error",message);}
    private static byte[] readBody(InputStream input,Map<String,String>headers)throws IOException{int length=Integer.parseInt(headers.containsKey("content-length")?headers.get("content-length"):"0");if(length<0||length>64*1024*1024)throw new IOException("Body too large");byte[]body=new byte[length];int at=0;while(at<length){int count=input.read(body,at,length-at);if(count<0)throw new EOFException();at+=count;}return body;}
    private static String readHeader(InputStream input)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();int tail=0;while(out.size()<32768){int next=input.read();if(next<0)throw new EOFException();out.write(next);tail=(tail<<8)|next;if(tail==0x0d0a0d0a)return new String(out.toByteArray(),StandardCharsets.ISO_8859_1);}throw new IOException("Header too large");}
    private static void copy(InputStream input,OutputStream output)throws IOException{byte[]buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
    private static void json(Socket socket,int status,Object value)throws IOException{byte[]body=String.valueOf(value).getBytes(StandardCharsets.UTF_8);header(socket,status,"application/json; charset=utf-8",body.length);socket.getOutputStream().write(body);}
    private static void text(Socket socket,int status,String value)throws IOException{byte[]body=value.getBytes(StandardCharsets.UTF_8);header(socket,status,"text/plain; charset=utf-8",body.length);socket.getOutputStream().write(body);}
    private static void header(Socket socket,int status,String type,int length)throws IOException{String message="HTTP/1.1 "+status+" Response\r\nContent-Type: "+type+"\r\nContent-Length: "+length+"\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\nX-Content-Type-Options: nosniff\r\n\r\n";socket.getOutputStream().write(message.getBytes(StandardCharsets.ISO_8859_1));}
    private static String mime(String path){if(path.endsWith(".js"))return"text/javascript";if(path.endsWith(".css"))return"text/css";if(path.endsWith(".html"))return"text/html; charset=utf-8";if(path.endsWith(".svg"))return"image/svg+xml";if(path.endsWith(".png"))return"image/png";if(path.endsWith(".woff2"))return"font/woff2";return"application/octet-stream";}
    private static JSONArray addresses()throws SocketException{JSONArray out=new JSONArray();Enumeration<NetworkInterface>networks=NetworkInterface.getNetworkInterfaces();while(networks.hasMoreElements()){Enumeration<InetAddress>addresses=networks.nextElement().getInetAddresses();while(addresses.hasMoreElements()){InetAddress address=addresses.nextElement();if(address instanceof Inet4Address&&!address.isLoopbackAddress())out.put(address.getHostAddress());}}return out;}
    private static JSONArray interfaces()throws Exception{JSONArray out=new JSONArray();Enumeration<NetworkInterface>networks=NetworkInterface.getNetworkInterfaces();while(networks.hasMoreElements()){NetworkInterface network=networks.nextElement();Enumeration<InetAddress>addresses=network.getInetAddresses();while(addresses.hasMoreElements()){InetAddress address=addresses.nextElement();if(address instanceof Inet4Address&&!address.isLoopbackAddress())out.put(new JSONObject().put("name",network.getDisplayName()).put("address",address.getHostAddress()));}}return out;}
    @Override public void close(){closed=true;try{listener.close();}catch(IOException ignored){}hub.close();workers.shutdownNow();background.shutdownNow();}
}
