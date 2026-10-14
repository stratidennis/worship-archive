package com.worshiparchive.band;

import android.app.*;
import android.content.Intent;
import android.os.IBinder;

/** Keeps the tablet's Leader process available while Band devices are connected. */
public final class LeaderKeepAliveService extends Service {
    private static final String CHANNEL="worship-leader";
    @Override public void onCreate(){super.onCreate();if(android.os.Build.VERSION.SDK_INT>=26){NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Worship Archive Leader",NotificationManager.IMPORTANCE_LOW));}
        Intent open=new Intent(this,LeaderActivity.class);PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification=new Notification.Builder(this,CHANNEL).setSmallIcon(com.worshiparchive.leader.R.drawable.app_icon).setContentTitle("Worship Archive Leader").setContentText("Sharing the song library with Band and Stage screens").setContentIntent(pending).setOngoing(true).build();startForeground(7374,notification);}
    @Override public int onStartCommand(Intent intent,int flags,int id){return START_NOT_STICKY;}
    @Override public IBinder onBind(Intent intent){return null;}
}
