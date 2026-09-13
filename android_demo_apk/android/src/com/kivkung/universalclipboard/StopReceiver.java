package com.kivkung.universalclipboard;
import android.app.ActivityManager;
import android.content.*;
import android.os.*;

public final class StopReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(ClipboardService.current!=null)ClipboardService.current.shutdown();
        context.stopService(new Intent(context,ClipboardService.class));
        for(ActivityManager.AppTask task:context.getSystemService(ActivityManager.class).getAppTasks())task.finishAndRemoveTask();
        // Explicit STOP: no sticky service, boot receiver, scheduler, or automatic process resurrection.
        new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),250);
    }
}
