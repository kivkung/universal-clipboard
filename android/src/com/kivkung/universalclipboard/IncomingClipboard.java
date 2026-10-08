package com.kivkung.universalclipboard;

import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.util.AtomicFile;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;

/** Disk-backed image receiver. Never reads the current clipboard from the background. */
final class IncomingClipboard {
    interface Status {void update(String message,int percent,boolean receiving);}
    private final Context context;
    private final Status status;
    private final File dir;
    private static final long MAX=32L*1024*1024, BUDGET=128L*1024*1024;
    IncomingClipboard(Context c,Status status){context=c.getApplicationContext();this.status=status;dir=directory(c);dir.mkdirs();}
    static File directory(Context c){return new File(c.getFilesDir(),"received");}
    private static boolean hash(String value){return value.matches("[a-f0-9]{64}");}
    private File file(String key,String suffix){return new File(dir,key+suffix);}
    private JSONObject load(String key)throws Exception{try{return new JSONObject(new String(new AtomicFile(file(key,".json")).readFully(),java.nio.charset.StandardCharsets.UTF_8));}catch(FileNotFoundException e){return null;}}
    private void save(String key,JSONObject m)throws Exception{m.put("updated",System.currentTimeMillis());AtomicFile f=new AtomicFile(file(key,".json"));FileOutputStream out=null;try{out=f.startWrite();out.write(Wire.utf(m.toString()));f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}
    private static String digest(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return Wire.hex(d.digest());}
    synchronized JSONObject handle(JSONObject b)throws Exception{
        try{return apply(b);}catch(Exception e){status.update("รับไม่สำเร็จ • "+e.getMessage(),-1,false);throw e;}
    }
    private JSONObject apply(JSONObject b)throws Exception{
        String type=b.getString("type");
        if("clipboard.text".equals(type)){
            Object value=b.get("text");if(!(value instanceof String))throw new IOException("Invalid text");String text=(String)value;
            if(Wire.utf(text).length>512*1024||!Wire.hash(Wire.utf(text)).equals(b.getString("hash")))throw new IOException("Invalid text hash or size");
            context.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Universal Clipboard",text));
            status.update("รับข้อความแล้ว • กดวางได้เลย",100,false);return Wire.obj("applied",true);
        }
        if(!type.startsWith("file."))throw new IOException("Unsupported clipboard message");
        String id=b.getString("transferId"),sender=b.getString("from");if(!hash(id))throw new IOException("Invalid transfer ID");
        String key=Wire.hash(Wire.utf(sender+":"+id));File part=file(key,".part"),output=file(key,".png");JSONObject m=load(key);
        if("file.offer".equals(type)){
            String name=b.getString("name"),sha=b.getString("hash");long size=integer(b,"size");
            if(!"image".equals(b.optString("kind")))throw new IOException("รองรับข้อความและรูป clipboard เท่านั้น");
            if(size<1||size>MAX||!hash(sha)||name.isEmpty()||name.length()>200||name.matches(".*[\\\\/\\x00-\\x1f].*"))throw new IOException("Invalid image metadata");
            if(m!=null&&(!name.equals(m.getString("name"))||size!=m.getLong("size")||!sha.equals(m.getString("hash"))))throw new IOException("Transfer metadata changed");
            if(m==null){reserve(size,key);m=Wire.obj("name",name,"size",size,"hash",sha);try(FileOutputStream out=new FileOutputStream(part)){out.getFD().sync();}save(key,m);}
            if(m.optBoolean("complete"))return completed(m,output);
            // Recover a crash between publishing a verified file and persisting completion.
            if(output.exists())return finish(key,m,part,output);
            if(!part.exists())try(FileOutputStream out=new FileOutputStream(part)){out.getFD().sync();}
            long offset=part.length();if(offset>size)throw new IOException("Invalid partial size");
            if(offset!=size&&offset%65536!=0){offset-=offset%65536;try(RandomAccessFile f=new RandomAccessFile(part,"rw")){f.setLength(offset);f.getFD().sync();}}
            save(key,m);status.update("กำลังรับรูปจาก Host…",(int)(offset*100/size),true);return Wire.obj("offset",offset);
        }
        if(m==null)throw new IOException("Unknown transfer");long size=m.getLong("size");
        if("file.cancel".equals(type)){if(!m.optBoolean("complete")){part.delete();new AtomicFile(file(key,".json")).delete();}status.update("ยกเลิกการรับรูปแล้ว",-1,false);return Wire.obj("cancelled",true);}
        if("file.chunk".equals(type)){
            if(m.optBoolean("complete"))return Wire.obj("offset",size);
            String encoded=b.getString("data");if(encoded.length()>87384||!encoded.matches("[A-Za-z0-9+/]*={0,2}"))throw new IOException("Invalid chunk encoding");
            byte[] bytes=Base64.getDecoder().decode(encoded);long offset=part.length();
            if(integer(b,"offset")!=offset||integer(b,"sequence")!=offset/65536||offset%65536!=0||bytes.length!=Math.min(65536,size-offset)||bytes.length==0)throw new IOException("Invalid chunk offset or size");
            try(FileOutputStream out=new FileOutputStream(part,true)){out.write(bytes);out.getFD().sync();}
            status.update("กำลังรับรูป • "+((offset+bytes.length)*100/size)+"%",(int)Math.min(99,(offset+bytes.length)*100/size),true);
            return Wire.obj("offset",offset+bytes.length);
        }
        if(!"file.finish".equals(type))throw new IOException("Unsupported transfer message");
        if(m.optBoolean("complete"))return completed(m,output);
        return finish(key,m,part,output);
    }
    private JSONObject finish(String key,JSONObject m,File part,File output)throws Exception{
        File source=output.exists()?output:part;
        if(source.length()!=m.getLong("size"))throw new IOException("Image incomplete");
        if(!digest(source).equals(m.getString("hash"))){part.delete();output.delete();new AtomicFile(file(key,".json")).delete();throw new IOException("Image SHA-256 mismatch");}
        byte[] signature=new byte[8];try(DataInputStream input=new DataInputStream(new FileInputStream(source))){input.readFully(signature);}
        if(!Arrays.equals(signature,new byte[]{(byte)137,80,78,71,13,10,26,10}))throw new IOException("Expected PNG image");
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(source.getPath(),bounds);
        if(bounds.outWidth<=0||bounds.outHeight<=0||(long)bounds.outWidth*bounds.outHeight>16_000_000L)throw new IOException("รูปใหญ่เกิน 16 ล้านพิกเซล");
        Bitmap decoded=BitmapFactory.decodeFile(source.getPath());if(decoded==null)throw new IOException("Invalid PNG");decoded.recycle();
        if(!output.exists()&&!part.renameTo(output))throw new IOException("บันทึกรูปไม่สำเร็จ");
        Uri uri=Uri.parse("content://"+context.getPackageName()+".images/"+key+".png");
        JSONObject result=Wire.obj("complete",true,"offset",m.getLong("size"));
        try{
            context.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newUri(context.getContentResolver(),"Universal Clipboard image",uri));
            Config.prefs(context).edit().putString("receivedImage",key).commit();
            status.update("รับรูปแล้ว • กดวางในแอปที่รองรับรูป",100,false);
        }catch(Exception e){m.put("clipboardError",e.getMessage()==null?"Clipboard unavailable":e.getMessage());result.put("clipboardError",m.getString("clipboardError"));status.update("รับรูปแล้ว แต่ใส่ clipboard ไม่สำเร็จ",-1,false);}
        m.put("complete",true);save(key,m);return result;
    }
    private JSONObject completed(JSONObject m,File output)throws Exception{
        if(!output.exists()||output.length()!=m.getLong("size")||!digest(output).equals(m.getString("hash")))throw new IOException("Received image expired; send as a new transfer");
        JSONObject result=Wire.obj("complete",true,"offset",m.getLong("size"));if(m.has("clipboardError"))result.put("clipboardError",m.getString("clipboardError"));return result;
    }
    private static long integer(JSONObject b,String field)throws Exception{Object n=b.get(field);if(!(n instanceof Number)||((Number)n).doubleValue()!=((Number)n).longValue())throw new IOException("Invalid "+field);return ((Number)n).longValue();}
    private void reserve(long required,String keep)throws Exception{
        String current=Config.prefs(context).getString("receivedImage","");File[] metas=dir.listFiles((d,n)->n.endsWith(".json"));if(metas==null)return;
        Arrays.sort(metas,Comparator.comparingLong(File::lastModified));long committed=0;int unfinished=0;
        for(File f:metas){String key=f.getName().substring(0,64);JSONObject m=load(key);if(m==null)continue;
            if(System.currentTimeMillis()-m.optLong("updated")>7L*86400000&&!key.equals(current)&&!key.equals(keep)){file(key,".part").delete();file(key,".png").delete();new AtomicFile(f).delete();continue;}
            committed+=m.getLong("size");if(!m.optBoolean("complete"))unfinished++;
        }
        for(File f:metas){if(committed+required<=BUDGET)break;String key=f.getName().substring(0,64);JSONObject m=load(key);if(m!=null&&m.optBoolean("complete")&&!key.equals(current)&&!key.equals(keep)){file(key,".png").delete();new AtomicFile(f).delete();committed-=m.getLong("size");}}
        if(unfinished>=4||committed+required>BUDGET)throw new IOException("พื้นที่รับรูปเต็ม กรุณายกเลิกงานค้างก่อน");
    }
}
