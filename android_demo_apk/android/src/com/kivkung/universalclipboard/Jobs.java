package com.kivkung.universalclipboard;

import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.util.AtomicFile;
import java.io.*;
import java.security.*;
import org.json.JSONObject;

final class Jobs {
    static File metadata(Context c){return new File(c.getFilesDir(),"pending.json");}
    static File image(Context c){return new File(c.getFilesDir(),"pending.png");}
    static JSONObject load(Context c)throws Exception {
        if(!metadata(c).exists())return null;
        return new JSONObject(new String(new AtomicFile(metadata(c)).readFully(),java.nio.charset.StandardCharsets.UTF_8));
    }
    static void save(Context c,JSONObject j)throws Exception {
        AtomicFile f=new AtomicFile(metadata(c));FileOutputStream out=null;
        try{out=f.startWrite();out.write(Wire.utf(j.toString()));f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}
    }
    static void clear(Context c){new AtomicFile(metadata(c)).delete();image(c).delete();}
    static JSONObject capture(Context c,ClipData clip,Config cfg)throws Exception {
        if(clip==null||clip.getItemCount()==0)throw new Exception("Clipboard ว่าง — คัดลอกข้อความหรือรูปก่อน");
        ClipData.Item item=clip.getItemAt(0);Uri uri=item.getUri();
        JSONObject job=Wire.obj("host",cfg.host,"port",cfg.port);
        if(uri!=null) {
            String mime=c.getContentResolver().getType(uri);
            if((mime!=null&&mime.startsWith("image/"))||clip.getDescription().hasMimeType("image/*")) {
                // Copy while the focused Activity still owns clipboard URI access; never keep a transient URI as the resumable source.
                byte[] encoded;
                try(InputStream input=c.getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                    if(input==null)throw new IOException("เปิดรูปไม่ได้");byte[] b=new byte[65536];int n;
                    while((n=input.read(b))!=-1){if(bytes.size()+n>32*1024*1024)throw new IOException("รูปใหญ่เกิน 32 MB");bytes.write(b,0,n);}encoded=bytes.toByteArray();
                }
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(encoded,0,encoded.length,bounds);
                if(bounds.outWidth<=0||bounds.outHeight<=0||(long)bounds.outWidth*bounds.outHeight>16_000_000L)throw new IOException("รองรับรูปไม่เกิน 16 ล้านพิกเซล");
                Bitmap bitmap=BitmapFactory.decodeByteArray(encoded,0,encoded.length);
                if(bitmap==null)throw new IOException("อ่านรูปไม่ได้");
                try(FileOutputStream out=new FileOutputStream(image(c))){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("แปลงรูปไม่ได้");out.getFD().sync();}finally{bitmap.recycle();}
                if(image(c).length()>32*1024*1024){image(c).delete();throw new IOException("รูป PNG ใหญ่เกิน 32 MB");}
                MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(image(c))){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}
                byte[] id=new byte[32];new SecureRandom().nextBytes(id);
                job.put("kind","image").put("transferId",Wire.hex(id)).put("name","clipboard.png").put("size",image(c).length()).put("hash",Wire.hex(digest.digest()));
                save(c,job);return job;
            }
        }
        CharSequence text=item.getText();if(text==null||text.length()==0)throw new Exception("Clipboard นี้ไม่ใช่ข้อความหรือรูปที่อ่านได้");
        if(Wire.utf(text.toString()).length>512*1024)throw new Exception("ข้อความใหญ่เกิน 512 KB");
        job.put("kind","text").put("text",text.toString());save(c,job);return job;
    }
}
