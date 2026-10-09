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
        try(FileOutputStream out=new FileOutputStream(new File(getContext().getFilesDir(),"fixture.png"))){image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}catch(Exception e){throw new RuntimeException(e);}finally{image.recycle();}
        byte[] generic=new byte[150000];new java.util.Random(99).nextBytes(generic);try(FileOutputStream out=new FileOutputStream(new File(getContext().getFilesDir(),"fixture.bin"))){out.write(generic);}catch(Exception e){throw new RuntimeException(e);}return true;
    }
    public String getType(Uri uri){return uri.getPath().equals("/file")?"application/octet-stream":"image/png";}
    public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{return ParcelFileDescriptor.open(new File(getContext().getFilesDir(),uri.getPath().equals("/file")?"fixture.bin":"fixture.png"),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri u,String[] p,String s,String[] a,String sort){if(u.getPath().equals("/file")){android.database.MatrixCursor c=new android.database.MatrixCursor(new String[]{android.provider.OpenableColumns.DISPLAY_NAME});c.addRow(new Object[]{"รายงาน.bin"});return c;}android.database.MatrixCursor c=new android.database.MatrixCursor(new String[]{"result"});c.addRow(new Object[]{getContext().getSharedPreferences("paste",0).getString(u.getPath().equals("/generic")?"generic":"result","")});return c;}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
