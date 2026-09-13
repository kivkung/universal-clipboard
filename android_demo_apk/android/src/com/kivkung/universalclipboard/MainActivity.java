package com.kivkung.universalclipboard;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.text.InputType;
import android.view.*;
import android.widget.*;

public final class MainActivity extends Activity {
    private EditText ip,pin,name,port;
    private TextView state;
    private Button join,send;
    private Config saved;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Runnable refresh=new Runnable(){public void run(){
        state.setText(ClipboardService.status);
        send.setEnabled(ClipboardService.current!=null&&!ClipboardService.busy);
        join.setEnabled(!ClipboardService.busy);
        handler.postDelayed(this,500);
    }};
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);return t;}
    private void gap(LinearLayout box,int height){Space s=new Space(this);box.addView(s,new LinearLayout.LayoutParams(1,dp(height)));}
    private EditText field(LinearLayout box,String label,String hint,int input){
        TextView title=text(label,14,Color.rgb(55,68,65));box.addView(title);
        EditText e=new EditText(this);e.setSingleLine(true);e.setTextSize(17);e.setHint(hint);e.setInputType(input);e.setPadding(dp(12),dp(8),dp(12),dp(8));
        box.addView(e,new LinearLayout.LayoutParams(-1,dp(54)));gap(box,16);return e;
    }
    private Button button(LinearLayout box,String title,boolean primary){
        Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setTextSize(16);b.setTextColor(primary?Color.WHITE:Color.rgb(8,127,120));
        GradientDrawable bg=new GradientDrawable();bg.setColor(primary?Color.rgb(8,127,120):Color.rgb(229,243,239));bg.setCornerRadius(dp(16));b.setBackground(bg);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(52));p.bottomMargin=dp(12);box.addView(b,p);return b;
    }
    @Override public void onCreate(Bundle bundle){
        super.onCreate(bundle);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(24),dp(24),dp(24),dp(24));scroll.addView(box);
        scroll.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        TextView mark=text("UVC",16,Color.rgb(8,127,120));mark.setTypeface(null,Typeface.BOLD);box.addView(mark);gap(box,12);
        TextView heading=text("Universal Clipboard",28,Color.rgb(24,38,34));heading.setTypeface(null,Typeface.BOLD);box.addView(heading);gap(box,8);
        box.addView(text("เชื่อมต่อครั้งเดียว แล้วส่งจากแถบแจ้งเตือนได้เลย",15,Color.DKGRAY));gap(box,24);
        ip=field(box,"Host IP","เช่น 192.168.1.10",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        pin=field(box,"PIN ของ Host","ตัวเลข 6 หลัก",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        name=field(box,"Device name · ชื่อมือถือ","Nothing Phone",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        TextView advanced=text("ตั้งค่าเพิ่มเติม ▾",14,Color.rgb(8,127,120));box.addView(advanced);gap(box,8);
        LinearLayout extra=new LinearLayout(this);extra.setOrientation(LinearLayout.VERTICAL);box.addView(extra);port=field(extra,"Port","3000",InputType.TYPE_CLASS_NUMBER);extra.setVisibility(View.GONE);
        advanced.setOnClickListener(v->extra.setVisibility(extra.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE));
        join=button(box,"Join Host",true);join.setOnClickListener(v->join());
        state=text(ClipboardService.status,14,Color.rgb(8,100,95));box.addView(state);gap(box,20);
        send=button(box,"SEND · ส่ง clipboard",false);send.setOnClickListener(v->startActivity(new Intent(this,SendActivity.class)));
        Button stop=button(box,"STOP · ปิดแอป",false);stop.setOnClickListener(v->sendBroadcast(new Intent(this,StopReceiver.class)));
        TextView clear=text("ล้างรายการส่งที่ค้างไว้",14,Color.DKGRAY);clear.setPadding(0,dp(12),0,dp(12));box.addView(clear);
        clear.setOnClickListener(v->{if(ClipboardService.busy){Toast.makeText(this,"กด STOP แล้วเปิดแอปใหม่ก่อนล้างงานค้าง",Toast.LENGTH_LONG).show();return;}
            new AlertDialog.Builder(this).setTitle("ล้างงานค้าง?").setMessage("ลบรายการที่รอส่งออกจากมือถือ เพื่อส่ง clipboard ชิ้นใหม่").setNegativeButton("ยกเลิก",null).setPositiveButton("ล้าง",(d,w)->{Jobs.clear(this);Toast.makeText(this,"ล้างแล้ว",Toast.LENGTH_SHORT).show();}).show();});
        gap(box,16);box.addView(text("เริ่มต้นบนคอม: เปิด Host แล้วใช้ IP และ PIN ที่แสดง\nมือถือและคอมต้องอยู่ในเครือข่ายเดียวกัน\n\nSEND เปิดหน้าต่างอ่าน clipboard ชั่วครู่ แล้วส่งไปยัง Host โดยตรง\nSTOP ปิดแอปทั้งหมด เปิดแอปและกด Join Host เพื่อเริ่มใหม่",13,Color.GRAY));
        setContentView(scroll);
        try{saved=Config.load(this);ip.setText(saved.host);pin.setText(saved.pin);name.setText(saved.name);port.setText(String.valueOf(saved.port));}
        catch(Exception e){state.setText("อ่านค่าที่บันทึกไม่ได้ กรุณากรอกใหม่");name.setText(Build.MODEL);port.setText("3000");}
    }
    private void join(){
        String host=ip.getText().toString().trim(),code=pin.getText().toString().trim(),label=name.getText().toString().trim();
        if(!host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")){ip.setError("กรอก IPv4 ที่แสดงบน Host เช่น 192.168.1.10");return;}
        for(String part:host.split("\\."))if(Integer.parseInt(part)>255){ip.setError("IP ไม่ถูกต้อง");return;}
        if(!code.matches("[0-9]{6}")){pin.setError("PIN ต้องเป็นตัวเลข 6 หลัก");return;}
        if(label.isEmpty()||label.length()>80){name.setError("ชื่อ 1–80 ตัวอักษร");return;}
        int number;try{number=Integer.parseInt(port.getText().toString());if(number<1||number>65535)throw new Exception();}catch(Exception e){port.setError("Port ต้องอยู่ระหว่าง 1–65535");port.getParent();return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);return;}
        if(!getSystemService(NotificationManager.class).areNotificationsEnabled()){
            new AlertDialog.Builder(this).setMessage("เปิดการแจ้งเตือนเพื่อใช้ปุ่ม SEND / STOP").setPositiveButton("เปิดตั้งค่า",(d,w)->startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()))).setNegativeButton("ยกเลิก",null).show();return;
        }
        try{String id=saved==null?Config.load(this).id:saved.id;Config cfg=new Config(host,number,code,label,id);cfg.save(this);saved=cfg;startForegroundService(ClipboardService.action(this,ClipboardService.JOIN));state.setText("กำลังเชื่อมต่อ…");}
        catch(Exception e){new AlertDialog.Builder(this).setMessage(e.getMessage()).setPositiveButton("ตกลง",null).show();}
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==7&&results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)join();else Toast.makeText(this,"ต้องอนุญาต notification เพื่อใช้ปุ่ม SEND / STOP",Toast.LENGTH_LONG).show();}
    @Override public void onResume(){super.onResume();handler.post(refresh);}
    @Override public void onPause(){handler.removeCallbacks(refresh);super.onPause();}
}
