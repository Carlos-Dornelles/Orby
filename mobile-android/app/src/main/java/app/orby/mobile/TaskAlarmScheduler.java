package app.orby.mobile;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * Schedules and cancels exact alarms for task notifications using AlarmManager.
 * Stores scheduled alarms in SharedPreferences so they can be re-scheduled after boot.
 */
public final class TaskAlarmScheduler {
    private static final String TAG = "TaskAlarmScheduler";
    private static final String PREFERENCES_NAME = "orby_task_alarms";
    private static final String ALARMS_KEY = "scheduled_alarms";

    private TaskAlarmScheduler() {}

    /**
     * Schedule an exact alarm for a task notification.
     *
     * @param context   Application context
     * @param taskId    Unique task identifier (MongoDB _id)
     * @param title     Notification title
     * @param body      Notification body text
     * @param triggerMs Exact trigger time in milliseconds since epoch
     */
    public static boolean schedule(Context context, String taskId, String title, String body, long triggerMs) {
        if (taskId == null || taskId.isEmpty()) return false;
        if (triggerMs <= System.currentTimeMillis()) return false;

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return false;

        // Check exact alarm permission on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            Log.w(TAG, "Cannot schedule exact alarms — permission not granted");
            return false;
        }

        int notificationId = taskId.hashCode();
        PendingIntent pendingIntent = createPendingIntent(context, notificationId, taskId, title, body);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerMs, pendingIntent);
            }
            storeAlarm(context, taskId, title, body, triggerMs);
            Log.d(TAG, "Scheduled alarm for task " + taskId + " at " + triggerMs);
            return true;
        } catch (SecurityException e) {
            Log.w(TAG, "SecurityException scheduling alarm", e);
            return false;
        }
    }

    public static synchronized int sync(Context context, JSONArray tasks) throws JSONException {
        long now = System.currentTimeMillis();
        long overdueLimit = now - 20 * 60 * 1000L;
        Map<String, JSONObject> desired = new HashMap<>();
        Map<String, JSONObject> current = new HashMap<>();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            Log.w(TAG, "Exact alarm permission is not granted; clearing native task alarms");
            cancelAll(context);
            return 0;
        }

        for (int index = 0; index < tasks.length(); index++) {
            JSONObject task = tasks.getJSONObject(index);
            String taskId = task.optString("taskId", "");
            long triggerMs = task.optLong("triggerMs", 0);
            if (taskId.isEmpty() || triggerMs <= 0) continue;
            if (triggerMs <= now) {
                if (triggerMs > overdueLimit) {
                    OrbyNotifications.showLocal(
                            context,
                            taskId.hashCode(),
                            task.optString("title", "Orby"),
                            task.optString("body", ""),
                            taskId);
                }
                continue;
            }
            if (desired.put(taskId, task) != null) {
                throw new JSONException("Duplicate task ID in notification sync.");
            }
        }

        JSONArray stored = getStoredAlarms(context);
        for (int index = 0; index < stored.length(); index++) {
            JSONObject alarm = stored.getJSONObject(index);
            String taskId = alarm.optString("taskId", "");
            if (!taskId.isEmpty()) current.put(taskId, alarm);
        }

        for (Map.Entry<String, JSONObject> entry : current.entrySet()) {
            JSONObject next = desired.get(entry.getKey());
            JSONObject previous = entry.getValue();
            if (next == null ||
                    previous.optLong("triggerMs", 0) != next.optLong("triggerMs", 0) ||
                    !previous.optString("title", "").equals(next.optString("title", "")) ||
                    !previous.optString("body", "").equals(next.optString("body", ""))) {
                cancel(context, entry.getKey());
            }
        }

        int scheduled = 0;
        for (Map.Entry<String, JSONObject> entry : desired.entrySet()) {
            JSONObject next = entry.getValue();
            JSONObject previous = current.get(entry.getKey());
            if (previous != null &&
                    previous.optLong("triggerMs", 0) == next.optLong("triggerMs", 0) &&
                    previous.optString("title", "").equals(next.optString("title", "")) &&
                    previous.optString("body", "").equals(next.optString("body", ""))) {
                scheduled++;
                continue;
            }

            if (schedule(
                    context,
                    entry.getKey(),
                    next.optString("title", "Orby"),
                    next.optString("body", ""),
                    next.optLong("triggerMs"))) {
                scheduled++;
            }
        }

        return scheduled;
    }

    /**
     * Cancel a previously scheduled alarm for a task.
     */
    public static void cancel(Context context, String taskId) {
        if (taskId == null || taskId.isEmpty()) return;

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        int notificationId = taskId.hashCode();
        PendingIntent pendingIntent = createPendingIntent(context, notificationId, taskId, "", "");
        alarmManager.cancel(pendingIntent);
        pendingIntent.cancel();

        removeStoredAlarm(context, taskId);
        Log.d(TAG, "Cancelled alarm for task " + taskId);
    }

    /**
     * Cancel all scheduled task alarms.
     */
    public static void cancelAll(Context context) {
        JSONArray alarms = getStoredAlarms(context);
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        for (int i = 0; i < alarms.length(); i++) {
            try {
                JSONObject alarm = alarms.getJSONObject(i);
                String taskId = alarm.getString("taskId");
                int notificationId = taskId.hashCode();
                PendingIntent pendingIntent = createPendingIntent(context, notificationId, taskId, "", "");
                alarmManager.cancel(pendingIntent);
                pendingIntent.cancel();
            } catch (JSONException ignored) {}
        }

        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().remove(ALARMS_KEY).apply();
        Log.d(TAG, "Cancelled all alarms");
    }

    /**
     * Re-schedule all stored alarms (called after boot).
     */
    public static void rescheduleAll(Context context) {
        JSONArray alarms = getStoredAlarms(context);
        long now = System.currentTimeMillis();
        JSONArray remaining = new JSONArray();

        for (int i = 0; i < alarms.length(); i++) {
            try {
                JSONObject alarm = alarms.getJSONObject(i);
                long triggerMs = alarm.getLong("triggerMs");
                if (triggerMs <= now) continue; // Skip past alarms

                String taskId = alarm.getString("taskId");
                String title = alarm.optString("title", "Orby");
                String body = alarm.optString("body", "");

                // Schedule without re-storing (we'll save the cleaned list at the end)
                AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (alarmManager == null) continue;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                    continue;
                }

                int notificationId = taskId.hashCode();
                PendingIntent pendingIntent = createPendingIntent(context, notificationId, taskId, title, body);

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pendingIntent);
                    } else {
                        alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerMs, pendingIntent);
                    }
                    remaining.put(alarm);
                } catch (SecurityException ignored) {}
            } catch (JSONException ignored) {}
        }

        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().putString(ALARMS_KEY, remaining.toString()).apply();
        Log.d(TAG, "Rescheduled " + remaining.length() + " alarms after boot");
    }

    private static PendingIntent createPendingIntent(Context context, int notificationId, String taskId, String title, String body) {
        Intent intent = new Intent(context, TaskAlarmReceiver.class);
        intent.setAction("app.orby.mobile.TASK_ALARM." + taskId);
        intent.putExtra(TaskAlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId);
        intent.putExtra(TaskAlarmReceiver.EXTRA_TITLE, title);
        intent.putExtra(TaskAlarmReceiver.EXTRA_BODY, body);
        intent.putExtra(TaskAlarmReceiver.EXTRA_TASK_ID, taskId);
        return PendingIntent.getBroadcast(
                context,
                notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // --- SharedPreferences storage for surviving reboots ---

    private static JSONArray getStoredAlarms(Context context) {
        String json = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getString(ALARMS_KEY, "[]");
        try {
            return new JSONArray(json);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void storeAlarm(Context context, String taskId, String title, String body, long triggerMs) {
        JSONArray alarms = getStoredAlarms(context);

        // Remove any existing entry for the same task
        JSONArray updated = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            try {
                JSONObject alarm = alarms.getJSONObject(i);
                if (!taskId.equals(alarm.optString("taskId"))) {
                    updated.put(alarm);
                }
            } catch (JSONException ignored) {}
        }

        // Add the new alarm entry
        try {
            JSONObject entry = new JSONObject();
            entry.put("taskId", taskId);
            entry.put("title", title);
            entry.put("body", body);
            entry.put("triggerMs", triggerMs);
            updated.put(entry);
        } catch (JSONException ignored) {}

        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().putString(ALARMS_KEY, updated.toString()).apply();
    }

    static void removeStoredAlarm(Context context, String taskId) {
        if (taskId == null || taskId.isEmpty()) return;
        JSONArray alarms = getStoredAlarms(context);
        JSONArray updated = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            try {
                JSONObject alarm = alarms.getJSONObject(i);
                if (!taskId.equals(alarm.optString("taskId"))) {
                    updated.put(alarm);
                }
            } catch (JSONException ignored) {}
        }
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().putString(ALARMS_KEY, updated.toString()).apply();
    }
}
