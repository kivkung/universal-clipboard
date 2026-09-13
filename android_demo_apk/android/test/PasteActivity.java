package com.kivkung.universalclipboard;
import android.app.Activity;
import android.content.*;
import android.graphics.*;
import android.os.Bundle;
import android.widget.TextView;
import java.io.*;
public final class PasteActivity extends Activity {
    boolean checked;
    public void onCreate(Bundle state){super.onCreate(state);TextView view=new TextView(this);view.setText("Separate app: paste clipboard image");setContentView(view);}
    public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(!focus||checked)return;checked=true;
        String result;
        try{ClipData clip=getSystemService(ClipboardManager.class).getPrimaryClip();try(InputStream in=getContentResolver().openInputStream(clip.getItemAt(0).getUri())){Bitmap image=BitmapFactory.decodeStream(in);if(image==null)throw new IOException("No image");result="OK "+image.getWidth()+"x"+image.getHeight();image.recycle();}}
        catch(Exception e){result="FAIL "+e;}
        getSharedPreferences("paste",MODE_PRIVATE).edit().putString("result",result).commit();
    }
}
