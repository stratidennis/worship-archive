package com.worshiparchive.band;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/**
 * Provider-neutral Android cloud synchronization using the Storage Access Framework.
 *
 * The system folder picker supplies Google Drive, Dropbox, OneDrive and any other
 * installed DocumentsProvider. Worship Archive receives persistent access to the one
 * folder the user chose, never their account credentials or the rest of the drive.
 */
final class AndroidCloudSync {
    private static final String PREF_TREE = "cloudTree";
    private static final String STATE = ".cloud-sync-state.json";
    private static final String CONFLICTS = "Cloud Conflicts";
    private final Context context;
    private final ContentResolver resolver;
    private final SharedPreferences preferences;
    private final File localRoot;

    AndroidCloudSync(Context context, SharedPreferences preferences, File localRoot) {
        this.context = context.getApplicationContext();
        this.resolver = context.getContentResolver();
        this.preferences = preferences;
        this.localRoot = localRoot;
    }

    synchronized boolean configured() { return tree() != null; }

    synchronized void select(Uri uri, int grantedFlags) throws IOException {
        int flags = grantedFlags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
            throw new IOException("The selected provider did not grant read and write access");
        resolver.takePersistableUriPermission(uri, flags);
        String previous = preferences.getString(PREF_TREE, null);
        if (previous != null && !previous.equals(uri.toString())) {
            try { resolver.releasePersistableUriPermission(Uri.parse(previous), flags); }
            catch (Exception ignored) { }
            new File(localRoot, STATE).delete();
        }
        preferences.edit().putString(PREF_TREE, uri.toString()).apply();
    }

    synchronized void disconnect() {
        Uri value = tree();
        preferences.edit().remove(PREF_TREE).apply();
        new File(localRoot, STATE).delete();
        if (value != null) try {
            resolver.releasePersistableUriPermission(value,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { }
    }

    synchronized Uri tree() {
        String value = preferences.getString(PREF_TREE, null);
        return value == null || value.isEmpty() ? null : Uri.parse(value);
    }

    synchronized JSONObject status() throws Exception {
        Uri tree = tree();
        if (tree == null) return new JSONObject().put("configured", false).put("remoteRoot", JSONObject.NULL)
                .put("lastSync", JSONObject.NULL).put("trackedFiles", 0);
        JSONObject state = readState();
        String updated = state.optString("updatedAt", "");
        return new JSONObject().put("configured", true).put("remoteRoot", displayName(tree))
                .put("lastSync", updated.isEmpty() ? JSONObject.NULL : updated)
                .put("trackedFiles", state.optJSONObject("files") == null ? 0 : state.optJSONObject("files").length());
    }

    synchronized JSONObject sync() throws Exception {
        Uri tree = tree();
        if (tree == null) throw new IOException("Cloud synchronization is not configured");
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Map<String, File> local = collectLocal();
        Map<String, Remote> remote = collectRemote(root);
        JSONObject state = readState();
        JSONObject previous = state.optJSONObject("files"); if (previous == null) previous = new JSONObject();
        Set<String> paths = new TreeSet<>(); paths.addAll(local.keySet()); paths.addAll(remote.keySet());
        for (Iterator<String> keys = previous.keys(); keys.hasNext();) paths.add(keys.next());
        JSONObject next = new JSONObject(); JSONArray conflicts = new JSONArray();
        int pushed=0,pulled=0,deletedLocally=0,deletedRemotely=0,unchanged=0;
        for (String path : paths) {
            File localFile = local.get(path); Remote remoteFile = remote.get(path);
            String localHash = localFile == null ? null : hash(new FileInputStream(localFile));
            String remoteHash = remoteFile == null ? null : hash(resolver.openInputStream(remoteFile.uri));
            String base = previous.optString(path, null);
            if (Objects.equals(localHash, remoteHash)) {
                if (localHash != null) next.put(path, localHash); unchanged++; continue;
            }
            if (base == null) {
                if (localFile != null && remoteFile == null) {
                    writeRemote(root, path, localFile); next.put(path, localHash); pushed++; continue;
                }
                if (remoteFile != null && localFile == null) {
                    File target = localPath(path); writeLocal(remoteFile, target); next.put(path, remoteHash); pulled++; continue;
                }
            } else {
                if (localFile != null && base.equals(localHash) && remoteFile != null) {
                    writeLocal(remoteFile, localFile); next.put(path, remoteHash); pulled++; continue;
                }
                if (remoteFile != null && base.equals(remoteHash) && localFile != null) {
                    writeRemote(root, path, localFile); next.put(path, localHash); pushed++; continue;
                }
                if (localFile == null && remoteFile != null && base.equals(remoteHash)) {
                    DocumentsContract.deleteDocument(resolver, remoteFile.uri); deletedRemotely++; continue;
                }
                if (remoteFile == null && localFile != null && base.equals(localHash)) {
                    Files.deleteIfExists(localFile.toPath()); deletedLocally++; continue;
                }
            }
            String folder = preserve(root, path, localFile, remoteFile);
            conflicts.put(new JSONObject().put("path", path).put("folder", folder));
            if (base != null) next.put(path, base);
        }
        String syncedAt = Instant.now().toString();
        writeState(new JSONObject().put("version", 1).put("tree", tree.toString()).put("files", next).put("updatedAt", syncedAt));
        return new JSONObject().put("pushed",pushed).put("pulled",pulled)
                .put("deletedLocally",deletedLocally).put("deletedRemotely",deletedRemotely)
                .put("unchanged",unchanged).put("conflicts",conflicts).put("syncedAt",syncedAt);
    }

    private JSONObject readState() {
        try {
            File file = new File(localRoot, STATE);
            JSONObject state = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            Uri tree = tree();
            if (state.optInt("version") == 1 && tree != null && tree.toString().equals(state.optString("tree"))) return state;
        } catch (Exception ignored) { }
        return new JSONObject();
    }

    private void writeState(JSONObject state) throws Exception {
        if (!localRoot.isDirectory() && !localRoot.mkdirs()) throw new IOException("Could not create local library");
        File target = new File(localRoot, STATE), temporary = new File(localRoot, STATE + ".tmp");
        Files.write(temporary.toPath(), state.toString(2).getBytes(StandardCharsets.UTF_8));
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private Map<String,File> collectLocal() {
        Map<String,File> result = new LinkedHashMap<>();
        collectLocalFolder(new File(localRoot,"Songs"),"Songs",result);
        collectLocalFolder(new File(localRoot,"Sets"),"Sets",result);
        return result;
    }

    private void collectLocalFolder(File folder,String prefix,Map<String,File> result) {
        File[] entries=folder.listFiles(); if(entries==null)return;
        for(File entry:entries){if(entry.getName().startsWith("."))continue;String path=prefix+"/"+entry.getName();
            if(entry.isDirectory())collectLocalFolder(entry,path,result);
            else if(allowed(prefix.startsWith("Songs"),entry.getName()))result.put(path,entry);}
    }

    private Map<String,Remote> collectRemote(Uri root) throws Exception {
        Map<String,Remote> result=new LinkedHashMap<>();
        for(Remote child:children(root)) if(child.directory&&(child.name.equals("Songs")||child.name.equals("Sets"))) collectRemoteFolder(child.uri,child.name,result);
        return result;
    }

    private void collectRemoteFolder(Uri folder,String prefix,Map<String,Remote> result)throws Exception{
        for(Remote child:children(folder)){if(child.name.startsWith("."))continue;String path=prefix+"/"+child.name;
            if(child.directory)collectRemoteFolder(child.uri,path,result);
            else if(allowed(prefix.startsWith("Songs"),child.name))result.put(path,child);}
    }

    private List<Remote> children(Uri parent)throws Exception{
        String parentId=DocumentsContract.getDocumentId(parent);
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(parent,parentId);
        List<Remote> out=new ArrayList<>();
        String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE};
        try(Cursor cursor=resolver.query(children,columns,null,null,null)){
            if(cursor==null)throw new IOException("Cloud provider did not return the selected folder");
            while(cursor.moveToNext()){String id=cursor.getString(0),name=cursor.getString(1),mime=cursor.getString(2);
                out.add(new Remote(DocumentsContract.buildDocumentUriUsingTree(parent,id),name,DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)));}
        }
        return out;
    }

    private Uri folder(Uri parent,String name)throws Exception{
        for(Remote child:children(parent))if(child.directory&&name.equals(child.name))return child.uri;
        Uri created=DocumentsContract.createDocument(resolver,parent,DocumentsContract.Document.MIME_TYPE_DIR,name);
        if(created==null)throw new IOException("Cloud provider could not create folder "+name);return created;
    }

    private void writeRemote(Uri root,String path,File source)throws Exception{
        String[] parts=path.split("/");Uri parent=root;for(int i=0;i<parts.length-1;i++)parent=folder(parent,parts[i]);
        String name=parts[parts.length-1];Uri target=null;for(Remote child:children(parent))if(!child.directory&&name.equals(child.name)){target=child.uri;break;}
        if(target==null){target=DocumentsContract.createDocument(resolver,parent,"application/octet-stream",name);if(target==null)throw new IOException("Cloud provider could not create "+path);}
        try(InputStream input=new FileInputStream(source);OutputStream output=resolver.openOutputStream(target,"wt")){if(output==null)throw new IOException("Cloud provider could not write "+path);copy(input,output);}
    }

    private void writeLocal(Remote source,File target)throws Exception{
        File parent=target.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Could not create "+parent);
        File temporary=new File(parent,"."+target.getName()+".cloud-tmp");
        try(InputStream input=resolver.openInputStream(source.uri);OutputStream output=new FileOutputStream(temporary)){if(input==null)throw new IOException("Cloud provider could not read "+source.name);copy(input,output);}
        Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);
    }

    private String preserve(Uri root,String path,File local,Remote remote)throws Exception{
        String stamp=Instant.now().toString().replace(':','-').replace('.','-');String relative=CONFLICTS+"/"+stamp+"/"+parent(path);File folder=new File(localRoot,relative);
        if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Could not preserve cloud conflict");String name=name(path);
        File localCopy=new File(folder,name+".local"),cloudCopy=new File(folder,name+".cloud"),note=new File(folder,name+".txt");
        if(local!=null){Files.copy(local.toPath(),localCopy.toPath(),StandardCopyOption.REPLACE_EXISTING);writeRemote(root,relative+"/"+localCopy.getName(),localCopy);}
        if(remote!=null){writeLocal(remote,cloudCopy);writeRemote(root,relative+"/"+cloudCopy.getName(),cloudCopy);}
        Files.write(note.toPath(),"Both copies changed. Neither original was overwritten.\n".getBytes(StandardCharsets.UTF_8));writeRemote(root,relative+"/"+note.getName(),note);return relative;
    }

    private File localPath(String path)throws IOException{File file=new File(localRoot,path);String root=localRoot.getCanonicalPath()+File.separator;if(!file.getCanonicalPath().startsWith(root))throw new IOException("Invalid cloud path");return file;}
    private String displayName(Uri tree){try{Uri root=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));try(Cursor cursor=resolver.query(root,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())return cursor.getString(0);}}catch(Exception ignored){}return "Selected cloud folder";}
    private static boolean allowed(boolean songs,String name){String lower=name.toLowerCase(Locale.ROOT);return songs?lower.endsWith(".chopro"):lower.endsWith(".json");}
    private static String parent(String path){int at=path.lastIndexOf('/');return at<0?"":path.substring(0,at);}
    private static String name(String path){int at=path.lastIndexOf('/');return at<0?path:path.substring(at+1);}
    private static String hash(InputStream input)throws Exception{if(input==null)return null;try(InputStream value=input){MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[16384];int count;while((count=value.read(buffer))!=-1)digest.update(buffer,0,count);StringBuilder out=new StringBuilder();for(byte one:digest.digest())out.append(String.format("%02x",one));return out.toString();}}
    private static void copy(InputStream input,OutputStream output)throws IOException{byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
    private static final class Remote{final Uri uri;final String name;final boolean directory;Remote(Uri uri,String name,boolean directory){this.uri=uri;this.name=name;this.directory=directory;}}
}
