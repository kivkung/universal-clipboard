package com.kivkung.universalclipboard;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Read-only provider: Android grants URI access to the app into which the user pastes. */
public final class ImageProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    private File image(Uri uri)throws FileNotFoundException{
        String path=uri.getPath();if(!getContext().getPackageName().concat(".images").equals(uri.getAuthority())||path==null||!path.matches("/[a-f0-9]{64}\\.png"))throw new FileNotFoundException("Invalid clipboard URI");
        File f=new File(IncomingClipboard.directory(getContext()),path.substring(1));if(!f.isFile())throw new FileNotFoundException("Image no longer available");return f;
    }
    public String getType(Uri uri){return "image/png";}
    public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(image(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
        try{File f=image(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor c=new MatrixCursor(columns);Object[] row=new Object[columns.length];for(int i=0;i<columns.length;i++)row[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?"clipboard.png":OpenableColumns.SIZE.equals(columns[i])?f.length():null;c.addRow(row);return c;}catch(FileNotFoundException e){return null;}
    }
    public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException("Read only");}
    public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException("Read only");}
    public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException("Read only");}
}
