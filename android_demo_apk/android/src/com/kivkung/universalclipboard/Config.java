package com.kivkung.universalclipboard;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class Config {
    final String host, pin, name, id;
    final int port;
    Config(String host, int port, String pin, String name, String id) {
        this.host=host; this.port=port; this.pin=pin; this.name=name; this.id=id;
    }
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("settings", Context.MODE_PRIVATE); }
    static SecretKey key() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias("uvc-settings")) {
            KeyGenerator g=KeyGenerator.getInstance("AES", "AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder("uvc-settings", KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            g.generateKey();
        }
        return (SecretKey)ks.getKey("uvc-settings", null);
    }
    static Config load(Context c) throws Exception {
        SharedPreferences p=prefs(c);
        String id=p.getString("id", "");
        if(id.isEmpty()) { id=UUID.randomUUID().toString(); p.edit().putString("id", id).commit(); }
        String pin="", encrypted=p.getString("secret", "");
        if(!encrypted.isEmpty()) {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(p.getString("iv",""))));
            pin=new String(cipher.doFinal(Base64.getDecoder().decode(encrypted)), java.nio.charset.StandardCharsets.UTF_8);
        }
        return new Config(p.getString("host",""),p.getInt("port",3000),pin,p.getString("name",Build.MODEL),id);
    }
    void save(Context c) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
        String secret=Base64.getEncoder().encodeToString(cipher.doFinal(pin.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if(!prefs(c).edit().putString("host",host).putInt("port",port).putString("name",name).putString("id",id)
            .putString("secret",secret).putString("iv",Base64.getEncoder().encodeToString(cipher.getIV())).commit()) throw new Exception("บันทึกการตั้งค่าไม่สำเร็จ");
    }
    boolean valid() { return !host.isEmpty() && pin.matches("[0-9]{6}") && !name.isEmpty(); }
}
