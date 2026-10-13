package app.orby.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-schedules all task alarms after device reboot.
 * Android cancels all AlarmManager alarms on reboot, so we need to
 * re-register them from stored SharedPreferences data.
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            NotificationWorker.scheduleFromStoredUser(context);
            TaskAlarmScheduler.rescheduleAll(context);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            OrbyNotifications.createChannel(context);
            TaskAlarmScheduler.rescheduleAll(context);
            NotificationWorker.scheduleFromStoredUser(context);
        }
    }
}
