package com.kivkung.universalclipboard;

import android.app.Activity;
import android.content.*;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.*;

public final class SendActivity extends Activity {
    private boolean started=false;
    private final Handler main=new Handler(Looper.getMainLooper());
    private int attempts=0;
    private final Runnable capture=this::captureWhenFocused;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(40,36,40,36);box.setGravity(Gravity.CENTER);
        TextView title=new TextView(this);title.setText("Universal Clipboard");title.setTextSize(20);box.addView(title);
        ProgressBar spinner=new ProgressBar(this);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(64,64);p.topMargin=24;box.addView(spinner,p);
        TextView label=new TextView(this);label.setText("กำลังเตรียมส่ง…");label.setPadding(0,20,0,0);box.addView(label);setContentView(box);
    }
    @Override public void onWindowFocusChanged(boolean focused){
        super.onWindowFocusChanged(focused);
        main.removeCallbacks(capture);
        if(focused&&!started)main.postDelayed(capture,250);
    }
    private void captureWhenFocused(){
        if(started||isFinishing()||isDestroyed()||!hasWindowFocus())return;
        // A notification launch can report window focus before ClipboardService
        // sees the new focused UID. Retry null reads while this Activity is visible.
        ClipData clip;
        try{clip=getSystemService(ClipboardManager.class).getPrimaryClip();}
        catch(SecurityException e){clip=null;}
        if((clip==null||clip.getItemCount()==0)&&!Jobs.metadata(this).exists()){
            if(++attempts<6){main.postDelayed(capture,250);return;}
            Toast.makeText(this,"อ่าน clipboard ไม่ได้หรือ clipboard ว่าง กรุณาคัดลอกใหม่ แล้วกด SEND อีกครั้ง",Toast.LENGTH_LONG).show();finish();return;
        }
        started=true;
        final ClipData snapshot=clip;
        if(ClipboardService.busy||!ClipboardService.capturing.compareAndSet(false,true)){
            Toast.makeText(this,"กำลังส่งอยู่ ดูความคืบหน้าใน notification",Toast.LENGTH_SHORT).show();finish();return;
        }
        try{
            Config cfg=Config.load(this);
            if(!cfg.valid()){ClipboardService.capturing.set(false);startActivity(new Intent(this,MainActivity.class));finish();return;}
            startForegroundService(ClipboardService.action(this,ClipboardService.PREPARE));
            // Clipboard access happens only after this real, visible Activity gains window focus.
            new Thread(()->{
                try{
                    if(Jobs.load(this)==null)Jobs.capture(this,snapshot,cfg);
                    runOnUiThread(()->{startForegroundService(ClipboardService.action(this,ClipboardService.SEND));finish();});
                }catch(Exception e){runOnUiThread(()->{startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error",e.getMessage()));Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();finish();});}
            },"clipboard-snapshot").start();
        }catch(Exception e){ClipboardService.capturing.set(false);if(ClipboardService.current!=null)startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error","อ่าน clipboard ไม่สำเร็จ: "+e.getMessage()));Toast.makeText(this,"อ่าน clipboard ไม่สำเร็จ: "+e.getMessage(),Toast.LENGTH_LONG).show();finish();}
    }
    @Override protected void onDestroy(){main.removeCallbacks(capture);super.onDestroy();}
}
