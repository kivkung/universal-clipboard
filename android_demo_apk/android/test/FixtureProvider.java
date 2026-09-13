package com.kivkung.universalclipboard;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.*;
public final class FixtureProvider extends ContentProvider {
    public boolean onCreate(){
        android.graphics.Bitmap image=android.graphics.Bitmap.createBitmap(512,512,android.graphics.Bitmap.Config.ARGB_8888);
        int[] pixels=new int[512*512];java.util.Random random=new java.util.Random(42);for(int i=0;i<pixels.length;i++)pixels[i]=0xff000000|random.nextInt(0x1000000);image.setPixels(pixels,0,512,0,0,512,512);
        try(FileOutputStream out=new FileOutputStream(new File(getContext().getFilesDir(),"fixture.png"))){image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}catch(Exception e){throw new RuntimeException(e);}finally{image.recycle();}return true;
    }
    public String getType(Uri uri){return "image/png";}
    public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{return ParcelFileDescriptor.open(new File(getContext().getFilesDir(),"fixture.png"),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri u,String[] p,String s,String[] a,String sort){android.database.MatrixCursor c=new android.database.MatrixCursor(new String[]{"result"});c.addRow(new Object[]{getContext().getSharedPreferences("paste",0).getString("result","")});return c;}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
