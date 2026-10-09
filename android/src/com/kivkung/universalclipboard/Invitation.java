package com.kivkung.universalclipboard;

import android.net.Uri;
import java.util.*;

final class Invitation {
    final String host,id,secret,hubId; final int port; final long expires;
    private Invitation(String host,int port,String id,String secret,String hub,long expires){this.host=host;this.port=port;this.id=id;this.secret=secret;this.hubId=hub;this.expires=expires;}
    static Invitation parse(String text)throws Exception{
        if(text==null||text.length()>2048)throw new Exception("QR ไม่ถูกต้อง");
        Uri u=Uri.parse(text);boolean remote="2".equals(u.getQueryParameter("v"));String[] keys=remote?new String[]{"v","url","id","secret","hubId","expires"}:new String[]{"v","host","port","id","secret","hubId","expires"};Set<String> allowed=new HashSet<>(Arrays.asList(keys));
        if(!"uvc".equals(u.getScheme())||!"join".equals(u.getHost())||(u.getPath()!=null&&!u.getPath().isEmpty())||u.getFragment()!=null||u.getUserInfo()!=null||!allowed.equals(u.getQueryParameterNames()))throw new Exception("QR นี้ไม่ใช่คำเชิญ Universal Clipboard");
        for(String k:keys)if(u.getQueryParameters(k).size()!=1)throw new Exception("QR มีข้อมูลซ้ำหรือขาด");
        String host=remote?WebSocketTransport.origin(u.getQueryParameter("url")):u.getQueryParameter("host"),id=u.getQueryParameter("id"),secret=u.getQueryParameter("secret"),hub=u.getQueryParameter("hubId");
        if(!(remote||"1".equals(u.getQueryParameter("v")))||(!remote&&(!host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")||host.startsWith("127.")||host.equals("0.0.0.0")))||!id.matches("[a-f0-9]{32}")||!secret.matches("[a-f0-9]{64}")||!hub.matches("[a-zA-Z0-9-]{8,64}"))throw new Exception("ข้อมูลคำเชิญไม่ถูกต้อง");
        if(!remote)for(String part:host.split("\\."))if(Integer.parseInt(part)>255)throw new Exception("IP ไม่ถูกต้อง");
        int port=remote?443:Integer.parseInt(u.getQueryParameter("port"));long expires=Long.parseLong(u.getQueryParameter("expires")),now=System.currentTimeMillis();
        if(port<1||port>65535||expires<=now||expires>now+180000)throw new Exception("QR หมดอายุ กรุณารัน uc qr ใหม่ และตรวจเวลามือถือ");
        return new Invitation(host,port,id,secret,hub,expires);
    }
}
