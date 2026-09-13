package com.kivkung.universalclipboard;

import android.app.Activity;
import android.content.*;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.*;

public final class SendActivity extends Activity {
    private boolean started=false;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(40,36,40,36);box.setGravity(Gravity.CENTER);
        TextView title=new TextView(this);title.setText("Universal Clipboard");title.setTextSize(20);box.addView(title);
        ProgressBar spinner=new ProgressBar(this);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(64,64);p.topMargin=24;box.addView(spinner,p);
        TextView label=new TextView(this);label.setText("กำลังเตรียมส่ง…");label.setPadding(0,20,0,0);box.addView(label);setContentView(box);
    }
    @Override public void onWindowFocusChanged(boolean focused){
        super.onWindowFocusChanged(focused);
        if(!focused||started)return;started=true;
        if(ClipboardService.busy||!ClipboardService.capturing.compareAndSet(false,true)){
            Toast.makeText(this,"กำลังส่งอยู่ ดูความคืบหน้าใน notification",Toast.LENGTH_SHORT).show();finish();return;
        }
        try{
            Config cfg=Config.load(this);
            if(!cfg.valid()){ClipboardService.capturing.set(false);startActivity(new Intent(this,MainActivity.class));finish();return;}
            startForegroundService(ClipboardService.action(this,ClipboardService.PREPARE));
            // Clipboard access happens only after this real, visible Activity gains window focus.
            ClipData clip=getSystemService(ClipboardManager.class).getPrimaryClip();
            new Thread(()->{
                try{
                    if(Jobs.load(this)==null)Jobs.capture(this,clip,cfg);
                    runOnUiThread(()->{startForegroundService(ClipboardService.action(this,ClipboardService.SEND));finish();});
                }catch(Exception e){runOnUiThread(()->{startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error",e.getMessage()));Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();finish();});}
            },"clipboard-snapshot").start();
        }catch(Exception e){ClipboardService.capturing.set(false);if(ClipboardService.current!=null)startService(ClipboardService.action(this,ClipboardService.FAIL).putExtra("error","อ่าน clipboard ไม่สำเร็จ: "+e.getMessage()));Toast.makeText(this,"อ่าน clipboard ไม่สำเร็จ: "+e.getMessage(),Toast.LENGTH_LONG).show();finish();}
    }
}
