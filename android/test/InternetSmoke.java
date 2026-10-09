package com.kivkung.universalclipboard;
import android.app.*;
import android.content.*;
import android.os.*;
import java.io.*;
import java.util.*;
import org.json.*;

/** Live public TLS/WebSocket interop with scripts/internet-smoke.mjs --android. */
public final class InternetSmoke extends Instrumentation {
    final StringBuilder report=new StringBuilder();
    void check(boolean ok,String name)throws Exception{if(!ok)throw new Exception("FAILED "+name);report.append("PASS ").append(name).append('\n');}
    public void onCreate(Bundle args){super.onCreate(args);start();}
    public void onStart(){Bundle result=new Bundle();try{test();result.putString("stream",report.toString());finish(Activity.RESULT_OK,result);}catch(Throwable e){result.putString("stream",report+"\nFAIL "+android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
    void test()throws Exception {
        String invitation=new String(java.nio.file.Files.readAllBytes(new File("/data/local/tmp/uvc-internet-invite.txt").toPath()),"UTF-8").trim();
        Invitation invite=Invitation.parse(invitation);check(invite.host.startsWith("https:"),"v2 Internet invitation parses");
        boolean denied=false;try{WebSocketTransport.origin("http://example.com");}catch(Exception e){denied=true;}check(denied,"insecure endpoint rejected");
        Context context=getTargetContext();IncomingClipboard receiver=new IncomingClipboard(context,(s,p,b)->{});
        String id="android-internet-device";
        try(Wire wire=new Wire(receiver::handle)) {
            wire.connect(invite.host,443,invite.secret,id,"Android Internet",invite.id,invite.hubId);
            check(invite.hubId.equals(wire.hubId),"TLS hostname verified and public WSS pairing succeeds");wire.ping();check(true,"encrypted heartbeat over WSS");
            String text="Android sent via public WSS";wire.request(Wire.obj("type","clipboard.text","to",wire.hubId,"text",text,"hash",Wire.hash(Wire.utf(text))));check(true,"Android text upload via public WSS");
            byte[] bytes=new byte[140123];new Random(42).nextBytes(bytes);String sha=Wire.hash(bytes),transfer=Wire.hash(Wire.utf("internet-test-"+System.nanoTime()));
            wire.request(Wire.obj("type","file.offer","to",wire.hubId,"transferId",transfer,"name","android-binary.bin","size",bytes.length,"hash",sha,"kind","file","mime","application/octet-stream"));
            for(int offset=0;offset<bytes.length;offset+=65536){int count=Math.min(65536,bytes.length-offset);JSONObject reply=wire.request(Wire.obj("type","file.chunk","to",wire.hubId,"transferId",transfer,"offset",offset,"sequence",offset/65536,"data",Base64.getEncoder().encodeToString(Arrays.copyOfRange(bytes,offset,offset+count))));check(reply.getInt("offset")==offset+count,"binary chunk acknowledged "+offset);}
            check(wire.request(Wire.obj("type","file.finish","to",wire.hubId,"transferId",transfer)).getBoolean("complete"),"Android binary upload complete");
            check(sha.equals(wire.request(Wire.obj("type","test.internet","to",wire.hubId,"mode","upload-check")).getString("hash")),"Node validates Android binary SHA-256");
            wire.request(Wire.obj("type","test.internet","to",wire.hubId,"mode","receive-text"));
            List<JSONObject> history=new HistoryStore(context).list();boolean found=false;for(JSONObject entry:history)if("Android received via public WSS".equals(entry.optString("text")))found=true;check(found,"Host text download committed to Android history");
            JSONObject delivery=wire.request(Wire.obj("type","test.internet","to",wire.hubId,"mode","receive-file"));JSONObject fileResult=delivery.getJSONArray("value").getJSONObject(0);check(fileResult.optBoolean("complete")&&!fileResult.has("error")&&!fileResult.has("clipboardError"),"Host generic file download publishes Android clipboard URI");
            String historyId=fileResult.getString("historyId"),expected=new String(java.nio.file.Files.readAllBytes(new File("/data/local/tmp/uvc-internet-hash.txt").toPath()),"UTF-8").trim();
            HistoryStore store=new HistoryStore(context);try(InputStream in=context.getContentResolver().openInputStream(store.uri(historyId,0))){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);check(expected.equals(Wire.hash(out.toByteArray())),"Android received URI bytes match Host SHA-256");}
        }
        Thread.sleep(500);
        try(Wire reconnect=new Wire(receiver::handle)){reconnect.connect(invite.host,443,invite.secret,id,"Android Internet","",invite.hubId);reconnect.ping();check(true,"saved device credential reconnects without invitation");}
        Thread.sleep(300);
        denied=false;try(Wire wrong=new Wire()){wrong.connect(invite.host,443,invite.secret,"wrong-host-internet-device","Wrong Host","","different-host-device");}catch(Wire.Rejected e){denied=true;}check(denied,"unexpected Host identity rejected");
    }
}
