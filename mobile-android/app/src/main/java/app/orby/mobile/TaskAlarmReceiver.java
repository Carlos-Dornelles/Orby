package app.orby.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * BroadcastReceiver that fires when an exact alarm triggers for a task.
 * Shows a normal (non-ongoing) notification and auto-cancels on tap.
 */
public final class TaskAlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_NOTIFICATION_ID = "notification_id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_TASK_ID = "task_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String taskId = intent.getStringExtra(EXTRA_TASK_ID);

        if (title == null || title.isEmpty()) title = "Orby";
        if (body == null) body = "";
        if (taskId == null) taskId = "";

        OrbyNotifications.showLocal(context, notificationId, title, body, taskId);

        // Remove from stored alarms since it already fired
        TaskAlarmScheduler.removeStoredAlarm(context, taskId);
    }
}

