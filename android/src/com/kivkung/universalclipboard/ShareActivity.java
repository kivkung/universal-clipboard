package com.kivkung.universalclipboard;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.*;

/**
 * Receives the standard Android share sheet (ACTION_SEND). The shared text or
 * content URI is copied into the persistent pending job and delivered to the
 * authenticated Host without touching the phone clipboard.
 */
public final class ShareActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private boolean started=false;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(40,36,40,36);box.setGravity(Gravity.CENTER);
        TextView title=new TextView(this);title.setText("Universal Clipboard");title.setTextSize(20);box.addView(title);
        ProgressBar spinner=new ProgressBar(this);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(64,64);p.topMargin=24;box.addView(spinner,p);
        TextView label=new TextView(this);label.setText("กำลังส่งขึ้น Host…");label.setPadding(0,20,0,0);box.addView(label);setContentView(box);
        // Post past onCreate so the Activity is resumed and the incoming intent's
        // temporary URI read grant is active while the bytes are copied.
        main.post(this::share);
    }
    private void share(){
        if(started||isFinishing()||isDestroyed())return;
        started=true;
        Intent intent=getIntent();
        if(intent==null||!Intent.ACTION_SEND.equals(intent.getAction())){finish();return;}
        CharSequence text=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        Uri uri=stream(intent);
        if(uri==null&&(text==null||text.length()==0)){
            Toast.makeText(this,"ไม่มีข้อมูลที่แชร์ กรุณาแชร์ข้อความหรือไฟล์อีกครั้ง",Toast.LENGTH_LONG).show();finish();return;
        }
        if(ClipboardService.busy||!ClipboardService.capturing.compareAndSet(false,true)){
            Toast.makeText(this,"กำลังส่งอยู่ ดูความคืบหน้าใน notification",Toast.LENGTH_SHORT).show();finish();return;
        }
        try{
            Config cfg=Config.load(this);
            if(!cfg.valid()){ClipboardService.capturing.set(false);startActivity(new Intent(this,MainActivity.class));finish();return;}
            final Uri stream=uri;final CharSequence shared=text;
            startForegroundService(ClipboardService.action(this,ClipboardService.PREPARE).putExtra("label","กำลังอ่านข้อมูลที่แชร์…"));
            // The share intent's read grant lives only while this Activity exists; bytes are
            // copied into private storage before finish() so the job can resume without it.
            new Thread(()->{
                try{
                    Jobs.capture(this,shared,stream,isImageType(intent.getType()),cfg);
                    runOnUiThread(()->{startForegroundService(ClipboardService.action(this,ClipboardService.SEND));finish();});
                }catch(Exception e){runOnUiThread(()->{startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error",e.getMessage()));Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();finish();});}
            },"share-snapshot").start();
        }catch(Exception e){ClipboardService.capturing.set(false);if(ClipboardService.current!=null)startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error","อ่านข้อมูลที่แชร์ไม่สำเร็จ: "+e.getMessage()));Toast.makeText(this,"อ่านข้อมูลที่แชร์ไม่สำเร็จ: "+e.getMessage(),Toast.LENGTH_LONG).show();finish();}
    }
    @SuppressWarnings({"deprecation","unchecked"})
    private static Uri stream(Intent intent){
        if(Build.VERSION.SDK_INT>=33)return intent.getParcelableExtra(Intent.EXTRA_STREAM,Uri.class);
        Object extra=intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return extra instanceof Uri?(Uri)extra:null;
    }
    private static boolean isImageType(String type){return type!=null&&(type.startsWith("image/")||type.equals("image/*"));}
    @Override protected void onDestroy(){main.removeCallbacksAndMessages(null);super.onDestroy();}
}
