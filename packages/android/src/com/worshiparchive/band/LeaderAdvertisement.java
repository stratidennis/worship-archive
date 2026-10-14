package com.worshiparchive.band;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import org.json.JSONObject;
import java.io.Closeable;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Publishes Android Leader through the same mDNS and UDP discovery contract as desktop. */
final class LeaderAdvertisement implements Closeable {
    private final NsdManager nsd; private final DatagramSocket socket; private final ExecutorService worker=Executors.newSingleThreadExecutor(); private final NsdManager.RegistrationListener registration; private volatile boolean closed;
    LeaderAdvertisement(Context context,int port,String id,String name){
        nsd=(NsdManager)context.getSystemService(Context.NSD_SERVICE);DatagramSocket fallback=null;try{fallback=new DatagramSocket(null);fallback.setReuseAddress(true);fallback.setBroadcast(true);fallback.bind(new InetSocketAddress("0.0.0.0",Protocol.DISCOVERY_PORT));}catch(Exception error){if(fallback!=null)fallback.close();fallback=null;}socket=fallback;
        NsdServiceInfo info=new NsdServiceInfo();info.setServiceName(name);info.setServiceType("_http._tcp.");info.setPort(port);
        if(android.os.Build.VERSION.SDK_INT>=21){info.setAttribute("app","worship-archive");info.setAttribute("role","leader");info.setAttribute("leaderId",id);info.setAttribute("protocol",Integer.toString(Protocol.VERSION));}
        registration=new NsdManager.RegistrationListener(){public void onServiceRegistered(NsdServiceInfo service){}public void onRegistrationFailed(NsdServiceInfo service,int error){}public void onServiceUnregistered(NsdServiceInfo service){}public void onUnregistrationFailed(NsdServiceInfo service,int error){}};
        if(nsd!=null)try{nsd.registerService(info,NsdManager.PROTOCOL_DNS_SD,registration);}catch(RuntimeException ignored){}
        if(socket!=null)worker.execute(()->listen(port,id,name));
    }
    private void listen(int port,String id,String name){byte[] expected=("worship-archive-discover:"+Protocol.VERSION).getBytes(StandardCharsets.UTF_8);while(!closed)try{DatagramPacket request=new DatagramPacket(new byte[256],256);socket.receive(request);if(request.getLength()!=expected.length)continue;boolean same=true;for(int i=0;i<expected.length;i++)if(request.getData()[i]!=expected[i]){same=false;break;}if(!same)continue;byte[]reply=new JSONObject().put("app","worship-archive").put("role","leader").put("leaderId",id).put("name",name).put("port",port).put("protocol",Protocol.VERSION).toString().getBytes(StandardCharsets.UTF_8);socket.send(new DatagramPacket(reply,reply.length,request.getAddress(),request.getPort()));}catch(Exception error){if(!closed)try{Thread.sleep(250);}catch(InterruptedException ignored){return;}}}
    @Override public void close(){closed=true;if(socket!=null)socket.close();worker.shutdownNow();if(nsd!=null)try{nsd.unregisterService(registration);}catch(RuntimeException ignored){}}
}
