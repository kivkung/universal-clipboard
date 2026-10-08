package com.kivkung.universalclipboard;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.hardware.Camera;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.util.concurrent.*;

/** Scanner is local-only: camera frames and QR secrets never leave this Activity. */
@SuppressWarnings("deprecation")
public final class ScanActivity extends Activity implements SurfaceHolder.Callback {
    private Camera camera;private SurfaceView surface;private TextView status;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile boolean decoding=false,done=false;private boolean visible=false;
    @Override public void onCreate(Bundle b){super.onCreate(b);
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(24,40,24,24);
        status=new TextView(this);status.setText("สแกน QR จาก terminal ของ Host\nรัน uc qr บนคอมก่อน");status.setTextSize(18);box.addView(status);
        surface=new SurfaceView(this);surface.getHolder().addCallback(this);box.addView(surface,new LinearLayout.LayoutParams(-1,0,1));
        Button image=new Button(this);image.setText("เลือกภาพ QR");image.setOnClickListener(v->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,2);});box.addView(image);
        Button paste=new Button(this);paste.setText("วางคำเชิญแทนการสแกน");paste.setOnClickListener(v->{EditText field=new EditText(this);field.setSingleLine(false);new AlertDialog.Builder(this).setTitle("คำเชิญ uvc://join").setView(field).setNegativeButton("ยกเลิก",null).setPositiveButton("ใช้คำเชิญ",(d,w)->accept(field.getText().toString().trim())).show();});box.addView(paste);
        setContentView(box);
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.CAMERA},1);
    }
    private void accept(String text){if(done)return;try{Invitation.parse(text);done=true;setResult(RESULT_OK,new Intent().putExtra("invite",text));finish();}catch(Exception e){status.setText(e.getMessage());}}
    private static String decode(LuminanceSource source)throws Exception{MultiFormatReader reader=new MultiFormatReader();java.util.Map<DecodeHintType,Object> hints=new java.util.EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,java.util.Collections.singletonList(BarcodeFormat.QR_CODE));return reader.decode(new BinaryBitmap(new HybridBinarizer(source)),hints).getText();}
    static String decodeBitmap(Bitmap bitmap)throws Exception{int width=bitmap.getWidth(),height=bitmap.getHeight();if((long)width*height>8000000)throw new Exception("ภาพ QR ใหญ่เกินไป");int[] pixels=new int[width*height];bitmap.getPixels(pixels,0,width,0,0,width,height);return decode(new RGBLuminanceSource(width,height,pixels));}
    private void openCamera(){if(camera!=null||!visible||!surface.getHolder().getSurface().isValid()||checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)return;
        try{camera=Camera.open();Camera.Parameters p=camera.getParameters();Camera.Size chosen=null;for(Camera.Size s:p.getSupportedPreviewSizes())if(s.width<=1280&&(chosen==null||s.width>chosen.width))chosen=s;if(chosen!=null)p.setPreviewSize(chosen.width,chosen.height);if(p.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);camera.setParameters(p);camera.setDisplayOrientation(90);camera.setPreviewDisplay(surface.getHolder());camera.setPreviewCallback((data,cam)->{if(decoding||done)return;decoding=true;Camera.Size size=cam.getParameters().getPreviewSize();byte[] copy=data.clone();worker.execute(()->{try{String value=decode(new PlanarYUVLuminanceSource(copy,size.width,size.height,0,0,size.width,size.height,false));runOnUiThread(()->accept(value));}catch(Exception ignored){}finally{decoding=false;}});});camera.startPreview();}catch(Exception e){closeCamera();status.setText("เปิดกล้องไม่ได้ ใช้เลือกภาพ QR หรือวางคำเชิญได้");}}
    private void closeCamera(){Camera c=camera;camera=null;if(c!=null){c.setPreviewCallback(null);c.stopPreview();c.release();}}
    @Override public void onResume(){super.onResume();visible=true;openCamera();}
    @Override public void onPause(){visible=false;closeCamera();super.onPause();}
    @Override public void onDestroy(){worker.shutdownNow();super.onDestroy();}
    @Override public void surfaceCreated(SurfaceHolder h){openCamera();}
    @Override public void surfaceChanged(SurfaceHolder h,int f,int w,int t){}
    @Override public void surfaceDestroyed(SurfaceHolder h){closeCamera();}
    @Override public void onRequestPermissionsResult(int r,String[] p,int[] results){super.onRequestPermissionsResult(r,p,results);if(r==1&&results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)openCamera();else status.setText("ยังสแกนจากภาพหรือวางคำเชิญได้ โดยไม่เปิดกล้อง");}
    @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==2&&result==RESULT_OK&&data!=null){worker.execute(()->{try{BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;try(java.io.InputStream in=getContentResolver().openInputStream(data.getData())){BitmapFactory.decodeStream(in,null,o);}if(o.outWidth<=0||o.outHeight<=0)throw new Exception("อ่านภาพไม่ได้");o.inJustDecodeBounds=false;o.inSampleSize=1;while((long)(o.outWidth/o.inSampleSize)*(o.outHeight/o.inSampleSize)>4000000)o.inSampleSize*=2;Bitmap image;try(java.io.InputStream in=getContentResolver().openInputStream(data.getData())){image=BitmapFactory.decodeStream(in,null,o);}if(image==null)throw new Exception("อ่านภาพไม่ได้");String text;try{text=decodeBitmap(image);}finally{image.recycle();}runOnUiThread(()->accept(text));}catch(Exception e){runOnUiThread(()->status.setText("ไม่พบ QR ที่อ่านได้ในภาพ"));}});}}
}
