package app.orby.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.HashSet;
import java.util.Set;

final class OrbyNotifications {
    static final String CHANNEL_ID = "orby_notifications";
    private static final String PREFERENCES_NAME = "orby_mobile_notifications";
    private static final String DELIVERED_IDS_KEY = "delivered_ids";
    private static final int MAX_DELIVERED_IDS = 500;

    private OrbyNotifications() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Notificações do Orby",
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Avisos de tarefas, hábitos e partidas do Orby");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    static boolean show(Context context, String title, String body, String tag) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }

        String notificationTag = tag == null || tag.isEmpty() ? title + body : tag;
        if (!markDelivered(context, notificationTag)) return false;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                notificationTag.hashCode(),
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder notification = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context).setPriority(Notification.PRIORITY_DEFAULT);
        notification.setSmallIcon(R.drawable.orby_logo)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);

        manager.notify(notificationTag.hashCode(), notification.build());
        return true;
    }

    /**
     * Show a local notification triggered by an exact alarm.
     * These are normal (non-ongoing, non-persistent) notifications.
     */
    static synchronized boolean showLocal(Context context, int notificationId, String title, String body, String taskId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        String deliveredId = taskId == null || taskId.isEmpty() ? "" : "task:" + taskId;
        if (!deliveredId.isEmpty() && wasDelivered(context, deliveredId)) return false;

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent(context, MainActivity.class);
        }
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder notification = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context).setPriority(Notification.PRIORITY_HIGH);
        notification.setSmallIcon(R.drawable.orby_logo)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)  // dismiss on tap
                .setOngoing(false);   // NOT persistent — user can swipe to dismiss

        // Set defaults for sound and vibration
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            notification.setDefaults(Notification.DEFAULT_ALL);
        }

        manager.notify(notificationId, notification.build());
        if (!deliveredId.isEmpty()) markDelivered(context, deliveredId);
        return true;
    }

    static synchronized boolean markDelivered(Context context, String id) {
        if (id == null || id.isEmpty()) return false;
        Set<String> deliveredIds = new HashSet<>(context
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getStringSet(DELIVERED_IDS_KEY, new HashSet<>()));
        if (deliveredIds.contains(id)) return false;
        deliveredIds.add(id);
        while (deliveredIds.size() > MAX_DELIVERED_IDS) {
            deliveredIds.remove(deliveredIds.iterator().next());
        }
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putStringSet(DELIVERED_IDS_KEY, deliveredIds)
                .apply();
        return true;
    }

    static boolean wasDelivered(Context context, String id) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getStringSet(DELIVERED_IDS_KEY, new HashSet<>())
                .contains(id);
    }
}