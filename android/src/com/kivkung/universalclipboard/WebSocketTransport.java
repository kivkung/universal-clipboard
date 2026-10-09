package com.kivkung.universalclipboard;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.net.ssl.*;

/** RFC 6455 binary transport; UCP framing/auth/encryption remain in Wire. */
final class WebSocketTransport {
    final Socket socket; final InputStream input; final OutputStream output;
    private final InputStream rawIn; private final OutputStream rawOut;
    private final SecureRandom random=new SecureRandom();
    private long remaining=0; private boolean fragmented=false;
    static String origin(String text)throws Exception {
        URI u=new URI(text);
        if(!("https".equals(u.getScheme())||"wss".equals(u.getScheme()))||u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!(u.getPath().isEmpty()||u.getPath().equals("/")||u.getPath().equals("/uc"))||u.getPort()==0||u.getPort()>65535)throw new IOException("ใช้ HTTPS URL ของ Host ที่ไม่มี query หรือข้อมูล login");
        return new URI("https",null,u.getHost(),u.getPort(),null,null,null).toString();
    }
    WebSocketTransport(String endpoint)throws Exception {
        URI uri=new URI(origin(endpoint)); int port=uri.getPort()<0?443:uri.getPort();
        Socket tcp=new Socket();tcp.connect(new InetSocketAddress(uri.getHost(),port),7000);
        SSLSocket ssl;try{ssl=(SSLSocket)((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(tcp,uri.getHost(),port,true);}catch(Exception e){tcp.close();throw e;}socket=ssl;
        try {
            SSLParameters parameters=ssl.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");ssl.setSSLParameters(parameters);
            ssl.setSoTimeout(10000);ssl.startHandshake();
            rawIn=ssl.getInputStream();rawOut=ssl.getOutputStream();
            byte[] nonce=new byte[16];random.nextBytes(nonce);String key=Base64.getEncoder().encodeToString(nonce);
            String host=uri.getHost().contains(":")?"["+uri.getHost()+"]":uri.getHost();if(port!=443)host+=":"+port;
            rawOut.write(("GET /uc HTTP/1.1\r\nHost: "+host+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key+"\r\nSec-WebSocket-Version: 13\r\n\r\n").getBytes(StandardCharsets.US_ASCII));rawOut.flush();
            ByteArrayOutputStream headers=new ByteArrayOutputStream();int state=0;
            while(state!=4){int b=rawIn.read();if(b<0)throw new EOFException();headers.write(b);if(headers.size()>16384)throw new IOException("WebSocket headers too large");state=(state==0&&b==13)?1:(state==1&&b==10)?2:(state==2&&b==13)?3:(state==3&&b==10)?4:(b==13?1:0);}
            String[] lines=headers.toString("US-ASCII").split("\r\n");
            if(!lines[0].matches("HTTP/1\\.[01] 101(?: .*)?"))throw new IOException("Host URL ไม่พร้อมรับ WebSocket: "+lines[0]);
            Map<String,String> values=new HashMap<>();for(int i=1;i<lines.length;i++){int colon=lines[i].indexOf(':');if(colon>0){String k=lines[i].substring(0,colon).trim().toLowerCase(Locale.ROOT);if(values.containsKey(k)&&k.equals("sec-websocket-accept"))throw new IOException("Duplicate handshake accept");String v=lines[i].substring(colon+1).trim();values.put(k,values.containsKey(k)?values.get(k)+", "+v:v);}}
            String expected=Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
            if(!expected.equals(values.get("sec-websocket-accept"))||!"websocket".equalsIgnoreCase(values.get("upgrade"))||!Arrays.asList(values.getOrDefault("connection","").toLowerCase(Locale.ROOT).split("\\s*,\\s*")).contains("upgrade")||values.containsKey("sec-websocket-extensions"))throw new IOException("Invalid WebSocket handshake");
            input=new InputStream(){public int read()throws IOException{byte[] b=new byte[1];return read(b,0,1)<0?-1:b[0]&255;}public int read(byte[] b,int off,int len)throws IOException{if(len==0)return 0;while(remaining==0)nextFrame();int n=rawIn.read(b,off,(int)Math.min(remaining,len));if(n<0)throw new EOFException();remaining-=n;return n;}};
            output=new OutputStream(){public void write(int b)throws IOException{write(new byte[]{(byte)b});}public void write(byte[] b,int off,int len)throws IOException{frame(2,b,off,len);}public void flush()throws IOException{rawOut.flush();}};
        }catch(Exception e){ssl.close();throw e;}
    }
    private int octet()throws IOException{int b=rawIn.read();if(b<0)throw new EOFException();return b;}
    private void nextFrame()throws IOException {
        while(true){int first=octet(),second=octet(),opcode=first&15;boolean fin=(first&128)!=0;
            if((first&112)!=0||(second&128)!=0)throw new IOException("Invalid server WebSocket frame");
            long length=second&127;if(length==126)length=(octet()<<8)|octet();else if(length==127){length=0;for(int i=0;i<8;i++){int b=octet();if(i==0&&b>=128)throw new IOException("Invalid frame size");length=(length<<8)|b;}}
            if(length<0||length>2097157)throw new IOException("WebSocket frame too large");
            if(opcode>=8){if(!fin||length>125||!(opcode==8||opcode==9||opcode==10))throw new IOException("Invalid control frame");byte[] payload=new byte[(int)length];new DataInputStream(rawIn).readFully(payload);if(opcode==8)throw new EOFException("WebSocket closed");if(opcode==9)frame(10,payload,0,payload.length);continue;}
            if(opcode==2){if(fragmented)throw new IOException("Unexpected binary frame");fragmented=!fin;}else if(opcode==0){if(!fragmented)throw new IOException("Unexpected continuation");if(fin)fragmented=false;}else throw new IOException("Expected binary WebSocket data");
            remaining=length;if(length>0)return;
        }
    }
    private synchronized void frame(int opcode,byte[] b,int off,int length)throws IOException {
        if(length>2097157)throw new IOException("WebSocket frame too large");rawOut.write(128|opcode);
        if(length<126)rawOut.write(128|length);else if(length<=65535){rawOut.write(128|126);rawOut.write(length>>8);rawOut.write(length);}else{rawOut.write(128|127);for(int i=7;i>=0;i--)rawOut.write((int)(((long)length)>>(8*i))&255);}
        byte[] mask=new byte[4];random.nextBytes(mask);rawOut.write(mask);byte[] encoded=new byte[length];for(int i=0;i<length;i++)encoded[i]=(byte)(b[off+i]^mask[i%4]);rawOut.write(encoded);rawOut.flush();
    }
}
