package com.kivkung.universalclipboard;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.view.View;
import android.widget.RemoteViews;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

public final class ClipboardService extends Service {
    static final String JOIN="join", SEND="send", PREPARE="prepare", FAIL="fail";
    static final AtomicBoolean capturing=new AtomicBoolean(false);
    static volatile ClipboardService current;
    static volatile String status="ยังไม่ได้เชื่อมต่อ";
    static volatile boolean busy=false;
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile Wire wire;
    private volatile boolean stopped=false;
    private boolean connected=false,fatal=false;
    private Config config;
    private String hostName="";
    private volatile int progress=-1;
    private volatile long started=0,lastNotice=0;
    private PowerManager.WakeLock wake;
    private PowerManager.WakeLock receiveWake;
    private IncomingClipboard receiver;
    private volatile boolean receiving=false;
    static Intent action(Context c,String action){return new Intent(c,ClipboardService.class).setAction(action);}
    @Override public void onCreate(){
        super.onCreate();current=this;
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("connection","Clipboard controls",NotificationManager.IMPORTANCE_LOW));
        try{config=Config.load(this);}catch(Exception e){status="อ่านการตั้งค่าไม่ได้ กรุณา Join Host ใหม่";}
        startForeground(1,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"uvc:send");
        receiveWake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"uvc:receive");receiveWake.setReferenceCounted(false);
        receiver=new IncomingClipboard(this,(message,value,active)->{
            if(stopped)return;receiving=active;
            if(active)receiveWake.acquire(30000);else if(receiveWake.isHeld())receiveWake.release();
            if(!busy)update(message,value,active);
        });
        worker.scheduleWithFixedDelay(this::tick,0,5,TimeUnit.SECONDS);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if(PREPARE.equals(action)){begin();update("กำลังอ่าน clipboard…",-1,true);}
        if(FAIL.equals(action)){capturing.set(false);finish(intent.getStringExtra("error"),false);}
        if(JOIN.equals(action))worker.execute(()->{
            disconnect();fatal=false;
            try{config=Config.load(this);JSONObject job=Jobs.load(this);if(job!=null){begin();update("กำลังส่งรายการที่ค้างไว้…",-1,true);}tick();}catch(Exception e){finish(message(e),false);}
        });
        if(SEND.equals(action)){capturing.set(false);worker.execute(()->{if(!busy)begin();fatal=false;tick();});}
        return START_NOT_STICKY;
    }
    private void begin(){busy=true;started=SystemClock.elapsedRealtime();progress=-1;}
    private void tick(){
        if(stopped||capturing.get()||fatal||config==null||!config.valid())return;
        try{
            if(!connected){
                update("กำลังเชื่อมต่อ Host…",-1,busy);
                Wire next=new Wire(body->{if(stopped)throw new java.io.IOException("Stopped");return receiver.handle(body);});wire=next;next.connect(config.host,config.port,config.pin,config.id,config.name);
                if(stopped){next.close();return;}connected=true;hostName=next.hubName;
                if(!busy)update("เชื่อมต่อแล้ว • พร้อมส่ง",-1,false);
            }
            JSONObject job=Jobs.load(this);
            if(job==null){wire.ping();return;}
            if(!busy)begin();
            if(!config.host.equals(job.getString("host"))||config.port!=job.getInt("port"))throw new Wire.Rejected("มีงานของ Host เดิม กรุณาล้างงานค้างในหน้าตั้งค่า");
            if(!job.has("to")){job.put("to",wire.hubId);Jobs.save(this,job);}
            if(!wake.isHeld())wake.acquire(10*60*1000L);
            update("กำลังส่งไปยัง "+hostName+"…",0,true);
            Transfer.send(wire,job,Jobs.image(this),(done,total)->{
                int pct=(int)Math.min(99,done*100/Math.max(1,total));
                update("กำลังส่ง • "+pct+"%",pct,true);
            });
            Jobs.clear(this);finish("ส่งสำเร็จ • วางบน Host ได้เลย",true);
        }catch(Wire.Rejected e){fatal=true;disconnect();finish(message(e),false);}
        catch(Exception e){disconnect();if(!stopped)update("รอเชื่อมต่อใหม่ • "+message(e),progress,busy);}
        finally{if(wake!=null&&wake.isHeld())wake.release();}
    }
    private static String message(Exception e){String m=e.getMessage();if(e instanceof java.net.ConnectException)return "เปิด Host และตรวจ IP / Wi-Fi";if(e instanceof java.net.SocketTimeoutException)return "Host ไม่ตอบกลับ ตรวจ IP / Wi-Fi";return m==null?"เชื่อมต่อไม่สำเร็จ":m;}
    private void disconnect(){connected=false;receiving=false;Wire w=wire;wire=null;if(w!=null)w.close();if(receiveWake!=null&&receiveWake.isHeld())receiveWake.release();}
    private void finish(String text,boolean success){
        long generation=started,delay=Math.max(0,1000-(SystemClock.elapsedRealtime()-started));
        main.postDelayed(()->{if(stopped||generation!=started)return;busy=false;capturing.set(false);update(text,success?100:-1,false);},delay);
    }
    private void update(String text,int value,boolean working){
        if(stopped)return;status=text;progress=value;
        long now=SystemClock.elapsedRealtime();
        if(working&&value>=0&&now-lastNotice<200)return;lastNotice=now;
        main.post(()->{if(!stopped)getSystemService(NotificationManager.class).notify(1,notification());});
    }
    private Notification notification(){
        PendingIntent settings=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent send=PendingIntent.getActivity(this,1,new Intent(this,SendActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getBroadcast(this,2,new Intent(this,StopReceiver.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String name=config==null?"Universal Clipboard":config.name;
        String host=hostName.isEmpty()?(config==null?"ยังไม่ตั้งค่า":config.host):hostName;
        RemoteViews layout=new RemoteViews(getPackageName(),R.layout.notification);
        layout.setTextViewText(R.id.device,name);layout.setTextViewText(R.id.host,"Host: "+host);layout.setTextViewText(R.id.status,status);
        layout.setTextViewText(R.id.send,busy?"SENDING":"SEND");layout.setOnClickPendingIntent(R.id.send,send);layout.setOnClickPendingIntent(R.id.stop,stop);
        layout.setViewVisibility(R.id.progress,busy||receiving?View.VISIBLE:View.GONE);layout.setProgressBar(R.id.progress,100,Math.max(0,progress),progress<0);
        RemoteViews compact=new RemoteViews(getPackageName(),R.layout.notification_compact);
        compact.setTextViewText(R.id.device,name);compact.setTextViewText(R.id.status,status);compact.setTextViewText(R.id.send,busy?"…":"SEND");
        compact.setOnClickPendingIntent(R.id.send,send);compact.setOnClickPendingIntent(R.id.stop,stop);
        compact.setViewVisibility(R.id.progress,busy||receiving?View.VISIBLE:View.GONE);compact.setProgressBar(R.id.progress,100,Math.max(0,progress),progress<0);
        Notification.Builder b=new Notification.Builder(this,"connection").setSmallIcon(R.drawable.ic_status).setContentTitle(name+" → "+host)
            .setContentText(status).setContentIntent(settings).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_SERVICE)
            .setStyle(new Notification.DecoratedCustomViewStyle()).setCustomContentView(compact).setCustomBigContentView(layout);
        return b.build();
    }
    void shutdown(){stopped=true;capturing.set(false);busy=false;disconnect();worker.shutdownNow();main.removeCallbacksAndMessages(null);if(wake!=null&&wake.isHeld())wake.release();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
    @Override public void onDestroy(){shutdown();current=null;status="หยุดแล้ว • กด Join Host เพื่อเปิดอีกครั้ง";super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
