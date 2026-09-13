package com.kivkung.universalclipboard;
import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.util.*;
import org.json.JSONObject;

public final class Smoke extends Instrumentation {
    private final StringBuilder report=new StringBuilder();
    void check(boolean ok,String label)throws Exception{if(!ok)throw new Exception("FAILED: "+label);report.append("PASS ").append(label).append('\n');android.util.Log.i("UvcTest",label);}
    public void onCreate(Bundle args){super.onCreate(args);start();}
    public void onStart(){Bundle result=new Bundle();try{test();result.putString("stream",report.toString());finish(Activity.RESULT_OK,result);}catch(Throwable e){result.putString("stream",report+"\nFAIL "+android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
    void test()throws Exception{
        String salt="AQEBAQEBAQEBAQEBAQEBAQ",nonce="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
        byte[] key=Wire.derive("123456",salt);
        check(Wire.hex(key).equals("abd8129e5c37cfaee19872c3bc74909da46c758f98bc04c612eed5b277951d58"),"scrypt matches Node vector");
        check(Wire.hex(Wire.hmac(key,nonce+":android-test-device")).equals("9280e91886b149694f50e16c2950774302d986512ce8e5038d1bc59bd53be4ba"),"HMAC matches Node vector");
        byte[] session=Wire.hmac(key,"session:"+nonce);
        JSONObject envelope=Wire.obj("iv","AwMDAwMDAwMDAwMD","tag","yqiZVAVAMTXB_16-6kQ9tw","data","C4YLa8hJpawe18FsdPw1Bki1nIL5sIW2uJc9sJHM-GU");
        check(Wire.decrypt(envelope,session).getJSONObject("body").getString("type").equals("ping"),"AES-GCM decrypts Node vector");
        envelope.put("tag","AAAAAAAAAAAAAAAAAAAAAA");boolean rejected=false;try{Wire.decrypt(envelope,session);}catch(Exception e){rejected=true;}check(rejected,"tampered tag rejected");
        try(Wire wrong=new Wire()){rejected=false;try{wrong.connect("127.0.0.1",33030,"654321","wrong-pin-device","Bad PIN");}catch(Wire.Rejected e){rejected=true;}check(rejected,"wrong PIN rejected by real Node Host");}
        Context c=getTargetContext();
        File source=new File(c.getCacheDir(),"fixture.png");Bitmap bitmap=Bitmap.createBitmap(512,512,Bitmap.Config.ARGB_8888);Random random=new Random(12);int[] pixels=new int[512*512];for(int i=0;i<pixels.length;i++)pixels[i]=0xff000000|random.nextInt(0x1000000);bitmap.setPixels(pixels,0,512,0,0,512,512);
        try(FileOutputStream out=new FileOutputStream(source)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();
        byte[] bytes=java.nio.file.Files.readAllBytes(source.toPath());
        JSONObject job=Wire.obj("kind","image","transferId",Wire.hash(Wire.utf("resume-test-"+System.nanoTime())),"name","resume.png","size",source.length(),"hash",Wire.hash(bytes));
        try(Wire w=new Wire()){
            w.connect("127.0.0.1",33030,"123456","android-wire-test","Android wire test");
            check(w.hubId.equals("test-host-endpoint"),"targets Host identity, not other devices");
            Transfer.send(w,Wire.obj("kind","text","text","ทดสอบ Android → Host ✓"),source,(a,b)->{});
            check(true,"Thai clipboard text applied by Node endpoint");
            boolean disconnected=false;try{Transfer.send(w,job,source,(a,b)->{});}catch(IOException e){disconnected=true;}check(disconnected,"forced disconnect after persisted chunk");
            Thread.sleep(300);w.connect("127.0.0.1",33030,"123456","android-wire-test","Android wire test");
            final long[] first={-1};Transfer.send(w,job,source,(a,b)->{if(first[0]<0)first[0]=a;});check(first[0]>=65536,"image resumed from acknowledged receiver offset");
            Transfer.send(w,job,source,(a,b)->{});check(true,"completed re-offer idempotent");
        }
        Config cfg=new Config("127.0.0.1",33030,"123456","Nothing Phone 3a",Config.load(c).id);cfg.save(c);
        check(Config.load(c).pin.equals("123456"),"PIN encrypted settings roundtrip");
        MainActivity activity=(MainActivity)startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        shell("cmd statusbar collapse");
        long focusDeadline=SystemClock.elapsedRealtime()+5000;while(!activity.hasWindowFocus()&&SystemClock.elapsedRealtime()<focusDeadline)Thread.sleep(50);
        check(activity.hasWindowFocus(),"test Activity focused before clipboard capture");
        runOnMainSync(()->c.startForegroundService(ClipboardService.action(c,ClipboardService.JOIN)));
        waitStatus("พร้อมส่ง",15000);
        Thread.sleep(600);screenshot("settings.png");
        runOnMainSync(()->activity.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("test","กด SEND ครั้งเดียว จาก Android")));
        Thread.sleep(200);
        long start=SystemClock.elapsedRealtime();
        runOnMainSync(()->activity.startActivity(new Intent(activity,SendActivity.class)));
        waitBusy();Thread.sleep(300);check(ClipboardService.busy,"progress remains visible at least 1 second");
        waitStatus("ส่งสำเร็จ",15000);check(SystemClock.elapsedRealtime()-start>=1000,"success shown after minimum duration");
        check(!ClipboardService.busy&&Jobs.load(c)==null,"one-tap text sends and clears persisted job");
        runOnMainSync(()->activity.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newUri(activity.getContentResolver(),"image",Uri.parse("content://com.kivkung.universalclipboard.test.fixture/image"))));
        Thread.sleep(250);
        runOnMainSync(()->activity.startActivity(new Intent(activity,SendActivity.class)));
        waitBusy();waitStatus("ส่งสำเร็จ",20000);
        check(Jobs.load(c)==null,"real clipboard image URI captured, PNG sent and applied");
        receiveTests(c,cfg,activity);
        shell("cmd statusbar expand-notifications");Thread.sleep(1000);screenshot("notification.png");
        shell("cmd statusbar collapse");
        check(true,"settings and notification screenshots captured");
    }
    void receiveTests(Context c,Config cfg,MainActivity activity)throws Exception{
        try(Wire control=new Wire()){
            control.connect("127.0.0.1",33030,"123456","android-test-control","Test controller");
            shell("input keyevent KEYCODE_HOME");Thread.sleep(500);
            check(!activity.hasWindowFocus(),"Android app unfocused during background receive");
            control.request(Wire.obj("type","test.receive","to",control.hubId,"target",cfg.id,"mode","text"));
            waitStatus("รับข้อความแล้ว",5000);
            check(!activity.hasWindowFocus(),"text receive did not open an Activity");
            MainActivity opened=foreground(c);
            check("รับจาก Host อัตโนมัติ ✓".contentEquals(c.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getText()),"Host text is in actual Android clipboard");
            JSONObject denied=control.request(Wire.obj("type","test.receive","to",control.hubId,"target",cfg.id,"mode","other"));
            check(denied.getJSONObject("value").getBoolean("rejected"),"non-Host peer rejected");
            denied=control.request(Wire.obj("type","test.receive","to",control.hubId,"target",cfg.id,"mode","bad-hash"));
            check(denied.getJSONObject("value").getBoolean("rejected"),"invalid incoming text hash rejected");
            check("รับจาก Host อัตโนมัติ ✓".contentEquals(c.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getText()),"rejected data leaves clipboard unchanged");
            shell("input keyevent KEYCODE_HOME");Thread.sleep(300);
            control.request(Wire.obj("type","test.receive","to",control.hubId,"target",cfg.id,"mode","resume"));
            waitStatus("รับรูปแล้ว",5000);
            check(!opened.hasWindowFocus(),"image receive and reconnect stayed in background");
            foreground(c);
            Uri image=c.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getUri();
            check(image!=null&&image.getAuthority().endsWith(".images"),"received image is a clipboard content URI");
            try(InputStream input=c.getContentResolver().openInputStream(image)){
                Bitmap bitmap=android.graphics.BitmapFactory.decodeStream(input);check(bitmap!=null&&bitmap.getWidth()==512&&bitmap.getHeight()==512,"received PNG readable and complete");if(bitmap!=null)bitmap.recycle();
            }
            boolean readOnly=false;try{c.getContentResolver().openFileDescriptor(image,"w").close();}catch(Exception e){readOnly=true;}check(readOnly,"clipboard image provider is read-only");
            shell("am start -n com.kivkung.universalclipboard.test/com.kivkung.universalclipboard.PasteActivity");
            String paste="";long deadline=SystemClock.elapsedRealtime()+5000;
            while(paste.isEmpty()&&SystemClock.elapsedRealtime()<deadline){try(android.database.Cursor cursor=c.getContentResolver().query(Uri.parse("content://com.kivkung.universalclipboard.test.fixture/paste"),null,null,null,null)){if(cursor!=null&&cursor.moveToFirst())paste=cursor.getString(0);}if(paste.isEmpty())Thread.sleep(100);}
            check("OK 512x512".equals(paste),"separate app can paste image through Android URI grant: "+paste);
            testReceiverValidation(c);
        }
    }
    MainActivity foreground(Context c)throws Exception{
        MainActivity a=(MainActivity)startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_MULTIPLE_TASK));
        long end=SystemClock.elapsedRealtime()+5000;while(!a.hasWindowFocus()&&SystemClock.elapsedRealtime()<end)Thread.sleep(50);check(a.hasWindowFocus(),"foreground verification Activity ready");return a;
    }
    void testReceiverValidation(Context c)throws Exception{
        IncomingClipboard r=new IncomingClipboard(c,(a,b,d)->{});String id=Wire.hash(Wire.utf("invalid-image-"+System.nanoTime()));
        JSONObject offer=Wire.obj("type","file.offer","from","test-host-endpoint","transferId",id,"name","test.png","kind","image","size",8,"hash",Wire.hash(new byte[8]));
        r.handle(offer);
        boolean bad=false;try{r.handle(Wire.obj("type","file.chunk","from","test-host-endpoint","transferId",id,"offset",1,"sequence",0,"data",Base64.getEncoder().encodeToString(new byte[8])));}catch(Exception e){bad=true;}check(bad,"out-of-order inbound chunk rejected");
        r.handle(Wire.obj("type","file.chunk","from","test-host-endpoint","transferId",id,"offset",0,"sequence",0,"data",Base64.getEncoder().encodeToString(new byte[8])));
        bad=false;try{r.handle(Wire.obj("type","file.finish","from","test-host-endpoint","transferId",id));}catch(Exception e){bad=true;}check(bad,"non-PNG cannot replace clipboard");
        r.handle(Wire.obj("type","file.cancel","from","test-host-endpoint","transferId",id));
    }
    void waitBusy()throws Exception{long end=SystemClock.elapsedRealtime()+5000;while(!ClipboardService.busy&&SystemClock.elapsedRealtime()<end)Thread.sleep(10);check(ClipboardService.busy,"SEND enters progress state");}
    void shell(String command)throws Exception{try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation().executeShellCommand(command))){byte[] b=new byte[1024];while(input.read(b)!=-1){}}}
    void waitStatus(String value,int timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(!ClipboardService.status.contains(value)&&SystemClock.elapsedRealtime()<end)Thread.sleep(50);check(ClipboardService.status.contains(value),"status: "+value+" ("+ClipboardService.status+")");}
    void screenshot(String name)throws Exception{Bitmap image=getUiAutomation().takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getExternalFilesDir(null),name))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();}
}
