package com.kivkung.universalclipboard;

import org.json.JSONObject;
import org.json.JSONArray;
import org.bouncycastle.crypto.generators.SCrypt;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** UCP/2 transport with a continuous reader, so inbound chunks are acknowledged immediately. */
public final class Wire implements AutoCloseable {
    public interface Incoming { JSONObject handle(JSONObject body) throws Exception; }
    private final Incoming handler;
    private volatile Connection connection;
    public Wire(){this(null);}
    public Wire(Incoming handler){this.handler=handler;}
    public String hubId, hubName;
    public static final class Rejected extends IOException { public Rejected(String message) { super(message); } }
    public static JSONObject obj(Object... pairs) throws Exception {
        JSONObject o=new JSONObject(); for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]); return o;
    }
    public static byte[] utf(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    public static String hex(byte[] b) { StringBuilder s=new StringBuilder(); for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString(); }
    public static byte[] hmac(byte[] key,String text) throws Exception { Mac m=Mac.getInstance("HmacSHA256");m.init(new SecretKeySpec(key,"HmacSHA256"));return m.doFinal(utf(text)); }
    public static String hash(byte[] b) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(b)); }
    public static byte[] derive(String pin,String salt) { return SCrypt.generate(utf(pin),Base64.getUrlDecoder().decode(salt),16384,8,1,32); }
    public static String b64(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    public static JSONObject encrypt(JSONObject value,byte[] key) throws Exception {
        byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        byte[] data=c.doFinal(utf(value.toString()));
        return obj("iv",b64(iv),"data",b64(Arrays.copyOf(data,data.length-16)),"tag",b64(Arrays.copyOfRange(data,data.length-16,data.length)));
    }
    public static JSONObject decrypt(JSONObject e,byte[] key) throws Exception {
        byte[] iv=Base64.getUrlDecoder().decode(e.getString("iv")),tag=Base64.getUrlDecoder().decode(e.getString("tag")),data=Base64.getUrlDecoder().decode(e.getString("data"));
        if(iv.length!=12||tag.length!=16)throw new Rejected("Invalid encryption envelope");
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        byte[] joined=Arrays.copyOf(data,data.length+tag.length);System.arraycopy(tag,0,joined,data.length,tag.length);
        return new JSONObject(new String(c.doFinal(joined),StandardCharsets.UTF_8));
    }
    public void connect(String host,int port,String pin,String id,String name) throws Exception {
        close(); Connection c=new Connection();connection=c;
        try {
        c.socket.connect(new InetSocketAddress(host,port),7000);c.socket.setSoTimeout(10000);c.socket.setKeepAlive(true);
        c.in=new DataInputStream(c.socket.getInputStream());c.out=new DataOutputStream(c.socket.getOutputStream());
        JSONObject challenge=c.read();
        if(!"challenge".equals(challenge.optString("type"))||!"ucp/2".equals(challenge.optString("protocol")))throw new Rejected("Host ต้องเป็น Universal Clipboard 0.2 ขึ้นไป");
        String nonce=challenge.getString("nonce"),salt=challenge.getString("salt");
        if(Base64.getUrlDecoder().decode(nonce).length!=32||Base64.getUrlDecoder().decode(salt).length!=16)throw new Rejected("Invalid challenge");
        byte[] key=derive(pin,salt);
        c.write(obj("type","auth","protocol","ucp/2","deviceId",id,"name",name,"proof",hex(hmac(key,nonce+":"+id))));
        JSONObject auth=c.read();
        if("error".equals(auth.optString("type")))throw new Rejected("BAD_PIN".equals(auth.optString("code"))?"PIN ไม่ถูกต้อง":auth.optString("code"));
        if(!"auth.ok".equals(auth.optString("type"))||!MessageDigest.isEqual(utf(auth.optString("proof")),utf(hex(hmac(key,"hub:"+nonce)))))throw new Rejected("ยืนยันตัวตน Host ไม่สำเร็จ");
        c.key=hmac(key,"session:"+nonce);Arrays.fill(key,(byte)0);
        hubId=challenge.getString("hubId");
        c.hub=hubId;c.socket.setSoTimeout(30000);
        Thread reader=new Thread(c::loop,"ucp-receiver");reader.setDaemon(true);reader.start();
        JSONArray devices=request(obj("type","devices")).getJSONArray("devices");
        hubName=null;
        for(int i=0;i<devices.length();i++) {JSONObject d=devices.getJSONObject(i);if(hubId.equals(d.getString("id")))hubName=d.optString("name",host);}
        if(hubName==null)throw new IOException("Host ยังไม่พร้อมรับ clipboard — เปิด uc start บนคอม");
        }catch(Exception e){c.close();throw e;}
    }
    public JSONObject request(JSONObject b) throws Exception {
        Connection c=connection;if(c==null)throw new IOException("Disconnected");
        String id=UUID.randomUUID().toString();Pending p=new Pending(b.optString("to","@hub"));c.pending.put(id,p);
        try{b.put("requestId",id);c.send(b);JSONObject response=await(p.future);
            if(response.has("error")){if(response.optBoolean("retryable"))throw new IOException(response.getString("error"));throw new Rejected(response.getString("error"));}
            Object result=response.get("result");return result instanceof JSONArray?obj("devices",result):(JSONObject)result;
        }finally{c.pending.remove(id);}
    }
    public void ping() throws Exception {
        Connection c=connection;if(c==null)throw new IOException("Disconnected");
        CompletableFuture<JSONObject> pong=new CompletableFuture<>();c.pong=pong;c.send(obj("type","ping"));await(pong);
    }
    private static JSONObject await(CompletableFuture<JSONObject> f)throws Exception{
        try{return f.get(15,TimeUnit.SECONDS);}catch(TimeoutException e){throw new IOException("Host ตอบกลับช้าเกินไป",e);}catch(ExecutionException e){throw new IOException("Disconnected",e.getCause());}
    }
    private static final class Pending {final String from;final CompletableFuture<JSONObject> future=new CompletableFuture<>();Pending(String from){this.from=from;}}
    private final class Connection {
        final Socket socket=new Socket();DataInputStream in;DataOutputStream out;byte[] key;String hub;long sendSeq,recvSeq;
        volatile boolean closed=false;volatile CompletableFuture<JSONObject> pong;
        final ConcurrentHashMap<String,Pending> pending=new ConcurrentHashMap<>();
        void write(JSONObject o)throws Exception{byte[] b=utf(o.toString());if(b.length>2097152)throw new Rejected("Frame too large");out.writeInt(b.length);out.writeByte(1);out.write(b);out.flush();}
        JSONObject read()throws Exception{int n=in.readInt();int type=in.readUnsignedByte();if(n<1||n>2097152||type!=1)throw new Rejected("Invalid frame");byte[] b=new byte[n];in.readFully(b);return new JSONObject(new String(b,StandardCharsets.UTF_8));}
        synchronized void send(JSONObject body)throws Exception{if(closed)throw new IOException("Disconnected");write(obj("type","secure","envelope",encrypt(obj("seq",sendSeq++,"body",body),key)));}
        void loop(){try{while(!closed){
            JSONObject frame=read();if(!"secure".equals(frame.optString("type")))throw new Rejected("Expected secure frame");
            JSONObject p=decrypt(frame.getJSONObject("envelope"),key);if(p.getLong("seq")!=recvSeq++)throw new Rejected("Invalid sequence");JSONObject b=p.getJSONObject("body");
            if(b.has("replyTo")){Pending request=pending.get(b.getString("replyTo"));if(request!=null&&request.from.equals(b.optString("from")))request.future.complete(b);continue;}
            if("pong".equals(b.optString("type"))){CompletableFuture<JSONObject> f=pong;if(f!=null)f.complete(b);continue;}
            if(!b.has("requestId")||!b.has("from"))continue;
            JSONObject reply=obj("type","reply","to",b.getString("from"),"replyTo",b.getString("requestId"));
            try{if(!hub.equals(b.getString("from")))throw new Rejected("รับ clipboard จาก Host ที่เชื่อมต่อเท่านั้น");if(handler==null)throw new Rejected("Receiver unavailable");reply.put("result",handler.handle(b));}
            catch(Exception e){reply.put("error",e.getMessage()==null?"Receive failed":e.getMessage());}
            send(reply);
        }}catch(Exception ignored){}finally{close();}}
        void close(){closed=true;try{socket.close();}catch(Exception ignored){}IOException e=new IOException("Disconnected");for(Pending p:pending.values())p.future.completeExceptionally(e);if(pong!=null)pong.completeExceptionally(e);}
    }
    public void close(){Connection c=connection;connection=null;if(c!=null)c.close();}
}
