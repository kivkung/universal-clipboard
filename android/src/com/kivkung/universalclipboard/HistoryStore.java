package com.kivkung.universalclipboard;

import android.content.*;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.AtomicFile;
import java.io.*;
import java.util.*;
import org.json.*;

/** Per-entry durable metadata. Eviction is logical; clipboard, grant leases and readers pin bytes. */
final class HistoryStore {
    static final Object LOCK=new Object();
    private static final Object COPY_LOCK=new Object();
    static final long DEFAULT_BUDGET=1024L*1024*1024, FREE_RESERVE=16L*1024*1024, LEASE=24L*60*60*1000;
    static final Map<String,Integer> READERS=new HashMap<>();
    final Context c; final File dir;
    HistoryStore(Context context){c=context.getApplicationContext();dir=new File(c.getFilesDir(),"history");dir.mkdirs();}
    File metadata(String id){return new File(dir,id+".json");}
    JSONObject get(String id)throws Exception{if(!id.matches("[a-f0-9]{64}"))throw new IOException("Invalid entry ID");return new JSONObject(new String(new AtomicFile(metadata(id)).readFully(),"UTF-8"));}
    void write(JSONObject e)throws Exception{AtomicFile a=new AtomicFile(metadata(e.getString("id")));FileOutputStream out=null;try{out=a.startWrite();out.write(Wire.utf(e.toString()));a.finishWrite(out);}catch(Exception x){if(out!=null)a.failWrite(out);throw x;}}
    List<JSONObject> all(){List<JSONObject> entries=new ArrayList<>();File[] files=dir.listFiles((d,n)->n.matches("[a-f0-9]{64}\\.json"));if(files!=null)for(File f:files)try{entries.add(get(f.getName().substring(0,64)));}catch(Exception ignored){}entries.sort(Comparator.comparingLong(e->e.optLong("timestamp")));return entries;}
    List<JSONObject> list(){synchronized(LOCK){List<JSONObject> list=all();list.removeIf(e->e.optBoolean("retired"));Collections.reverse(list);return list;}}
    static long tree(File f){if(f.isFile())return f.length();long sum=0;File[] fs=f.listFiles();if(fs!=null)for(File p:fs)sum+=tree(p);return sum;}
    void reserve(long additional)throws Exception{reserve(additional,false);}
    void reserve(long additional,boolean newTransfer)throws Exception{synchronized(LOCK){cleanup();long used=tree(c.getFilesDir()),promised=0;int unfinished=0;File[] fs=IncomingClipboard.directory(c).listFiles((d,n)->n.matches("[a-f0-9]{64}(-batch)?\\.json"));if(fs!=null)for(File f:fs)try{JSONObject m=new JSONObject(new String(new AtomicFile(f).readFully(),"UTF-8"));if(m.optBoolean("complete")||m.optBoolean("cancelled"))continue;if(f.getName().endsWith("-batch.json")){unfinished++;JSONArray members=m.getJSONArray("files");for(int i=0;i<members.length();i++){JSONObject member=members.getJSONObject(i);String key=Wire.hash(Wire.utf(m.getString("sender")+":"+member.getString("transferId")));File part=new File(f.getParentFile(),key+".part"),payload=new File(f.getParentFile(),key+".payload");promised+=Math.max(0,member.getLong("size")-Math.max(part.length(),payload.length()));}}else if(!m.has("batchId")){unfinished++;promised+=Math.max(0,m.getLong("size")-new File(f.getParentFile(),f.getName().replace(".json",".part")).length());}}catch(Exception ignored){}
        long budget=Config.prefs(c).getLong("historyBudgetBytes",DEFAULT_BUDGET);if(additional<0||used+promised+additional>budget||c.getFilesDir().getUsableSpace()<promised+additional+FREE_RESERVE)throw new IOException("History storage full (includes partials and pinned files); save entries or cancel unfinished transfers");if(newTransfer&&unfinished>=4)throw new IOException("Too many unfinished transfers/batches; cancel unfinished transfers first");}}    void commit(JSONObject e)throws Exception{synchronized(LOCK){try{get(e.getString("id"));return;}catch(FileNotFoundException ignored){}long stamp=System.currentTimeMillis();for(JSONObject prior:all())stamp=Math.max(stamp,prior.optLong("timestamp")+1);e.put("timestamp",stamp);e.put("retired",false);write(e);List<JSONObject> entries=all();int active=0;for(JSONObject x:entries)if(!x.optBoolean("retired"))active++;for(JSONObject x:entries){if(active<=5)break;if(!x.optBoolean("retired")){x.put("retired",true);write(x);active--;}}cleanup();}}
    void text(String id,String text,String sender)throws Exception{reserve(Wire.utf(text).length);commit(Wire.obj("id",id,"kind","text","mime","text/plain","text",text,"sender",sender,"files",new JSONArray()));}
    Uri uri(String id,int index){return Uri.parse("content://"+c.getPackageName()+".history/"+id+"/"+index);}
    JSONObject item(String id,int index)throws Exception{return get(id).getJSONArray("files").getJSONObject(index);}
    File payload(String id,int index)throws Exception{JSONObject i=item(id,index);File f=new File(c.getFilesDir(),i.getString("path"));if(!f.getCanonicalPath().startsWith(c.getFilesDir().getCanonicalPath()+File.separator)||!f.isFile())throw new FileNotFoundException("History payload unavailable");return f;}
    void lease(String id)throws Exception{synchronized(LOCK){JSONObject e=get(id);e.put("leaseUntil",System.currentTimeMillis()+LEASE);write(e);}}
    void copy(String id)throws Exception{
        // Serialize publishers, but never hold the storage lock across a clipboard Binder call:
        // Android may synchronously ask our provider for metadata/access on another thread.
        synchronized(COPY_LOCK){
            ClipData clip;
            synchronized(LOCK){
                JSONObject e=get(id);
                if("text".equals(e.getString("kind")))clip=ClipData.newPlainText("Universal Clipboard",e.getString("text"));
                else{JSONArray fs=e.getJSONArray("files");String[] types=new String[fs.length()];for(int i=0;i<types.length;i++)types[i]=fs.getJSONObject(i).getString("mime");clip=new ClipData("Universal Clipboard",types,new ClipData.Item(uri(id,0)));for(int i=1;i<fs.length();i++)clip.addItem(new ClipData.Item(uri(id,i)));}
                lease(id);
                Config.prefs(c).edit().putString("historyClipboardPending",id).commit();
            }
            c.getSystemService(ClipboardManager.class).setPrimaryClip(clip);
            synchronized(LOCK){Config.prefs(c).edit().putString("historyClipboard",id).remove("historyClipboardPending").commit();cleanup();}
        }
    }    void cleanup(){synchronized(LOCK){List<JSONObject> recovery=all();int active=0;for(JSONObject e:recovery)if(!e.optBoolean("retired"))active++;for(JSONObject e:recovery){if(active<=5)break;if(!e.optBoolean("retired"))try{e.put("retired",true);write(e);active--;}catch(Exception ignored){}}String pin=Config.prefs(c).getString("historyClipboard","");String pending=Config.prefs(c).getString("historyClipboardPending","");for(JSONObject e:all())try{String id=e.getString("id");if(!e.optBoolean("retired")||(id.equals(pin)||id.equals(pending))||e.optLong("leaseUntil")>System.currentTimeMillis()||READERS.getOrDefault(id,0)>0)continue;JSONArray fs=e.getJSONArray("files");for(int i=0;i<fs.length();i++)payload(id,i).delete();new AtomicFile(metadata(id)).delete();}catch(Exception ignored){}}}
    void save(String id)throws Exception{lease(id);JSONObject e=get(id);if("text".equals(e.getString("kind"))){saveOne("clipboard-"+id.substring(0,8)+".txt","text/plain",new ByteArrayInputStream(Wire.utf(e.getString("text"))));return;}JSONArray files=e.getJSONArray("files");for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);try(InputStream in=new FileInputStream(payload(id,i))){saveOne(f.getString("name"),f.getString("mime"),in);}}}
    private void saveOne(String name,String mime,InputStream in)throws Exception{ContentValues v=new ContentValues();v.put(MediaStore.Downloads.DISPLAY_NAME,name);v.put(MediaStore.Downloads.MIME_TYPE,mime);v.put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/Universal Clipboard");v.put(MediaStore.Downloads.IS_PENDING,1);Uri dest=c.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);if(dest==null)throw new IOException("Cannot create Downloads export");try{try(OutputStream out=c.getContentResolver().openOutputStream(dest)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}v.clear();v.put(MediaStore.Downloads.IS_PENDING,0);c.getContentResolver().update(dest,v,null,null);}catch(Exception x){c.getContentResolver().delete(dest,null,null);throw x;}}
}
