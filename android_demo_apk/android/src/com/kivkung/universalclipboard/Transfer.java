package com.kivkung.universalclipboard;

import java.io.*;
import java.util.Base64;
import org.json.JSONObject;

public final class Transfer {
    public interface Progress { void update(long bytes,long total); }
    public static void send(Wire wire,JSONObject job,File source,Progress progress) throws Exception {
        String to=wire.hubId;
        if(job.has("to")&&!to.equals(job.getString("to")))throw new Wire.Rejected("Host เปลี่ยนไป กรุณาส่งรายการใหม่");
        if("text".equals(job.getString("kind"))) {
            String text=job.getString("text");
            JSONObject result=wire.request(Wire.obj("type","clipboard.text","to",to,"text",text,"hash",Wire.hash(Wire.utf(text))));
            if(!result.optBoolean("applied"))throw new Wire.Rejected("Host พักการรับ clipboard อยู่");
            progress.update(1,1);return;
        }
        long size=job.getLong("size");String id=job.getString("transferId");
        if(source.length()!=size)throw new Wire.Rejected("ไฟล์ต้นทางเปลี่ยนไป");
        java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
        try(InputStream input=new FileInputStream(source)){byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}
        if(!Wire.hex(digest.digest()).equals(job.getString("hash")))throw new Wire.Rejected("ไฟล์ต้นทางเสียหาย กรุณาล้างงานค้างและส่งใหม่");
        JSONObject result=wire.request(Wire.obj("type","file.offer","to",to,"transferId",id,"name",job.getString("name"),"size",size,"hash",job.getString("hash"),"kind","image"));
        if(result.optBoolean("complete")){checkComplete(result,size);progress.update(size,size);return;}
        long offset=result.getLong("offset");
        if(offset<0||offset>size||(offset!=size&&offset%65536!=0))throw new Wire.Rejected("Invalid resume offset");
        progress.update(offset,size);
        try(RandomAccessFile file=new RandomAccessFile(source,"r")) {
            file.seek(offset);
            while(offset<size) {
                if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Stopped");
                byte[] chunk=new byte[(int)Math.min(65536,size-offset)];file.readFully(chunk);
                JSONObject ack=wire.request(Wire.obj("type","file.chunk","to",to,"transferId",id,"offset",offset,"sequence",offset/65536,"data",Base64.getEncoder().encodeToString(chunk)));
                if(ack.getLong("offset")!=offset+chunk.length)throw new Wire.Rejected("Invalid chunk acknowledgement");
                offset+=chunk.length;progress.update(offset,size);
            }
        }
        checkComplete(wire.request(Wire.obj("type","file.finish","to",to,"transferId",id)),size);
    }
    static void checkComplete(JSONObject r,long size)throws Exception {
        if(!r.optBoolean("complete")||r.getLong("offset")!=size)throw new Wire.Rejected("Host ยังรับไฟล์ไม่ครบ");
        if(r.has("clipboardError"))throw new Wire.Rejected("Host ได้รับรูปแล้ว แต่วางใน clipboard ไม่สำเร็จ: "+r.getString("clipboardError"));
    }
}
