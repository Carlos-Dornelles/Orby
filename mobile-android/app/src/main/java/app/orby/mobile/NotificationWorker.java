package app.orby.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

public final class NotificationWorker extends Worker {
    private static final String TAG = "NotificationWorker";
    private static final String WORK_NAME = "orby-background-notifications";
    private static final String PREFERENCES_NAME = "orby_mobile_notifications";
    private static final String USER_ID_KEY = "user_id";
    private static final String PUSH_ENABLED_KEY = "push_enabled";
    private static final String LAST_POLL_KEY = "last_poll";
    private static final long POLL_INTERVAL_MINUTES = 1;
    private static final long INITIAL_LOOKBACK_MS = TimeUnit.MINUTES.toMillis(30);
    private static final long POLL_OVERLAP_MS = TimeUnit.MINUTES.toMillis(2);

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    public static void schedule(Context context, String userId) {
        schedule(context, userId, false);
    }

    public static void schedule(Context context, String userId, boolean pushEnabled) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        preferences.edit()
                .putString(USER_ID_KEY, userId)
                .putBoolean(PUSH_ENABLED_KEY, pushEnabled)
                .apply();

        WorkManager workManager = WorkManager.getInstance(context);
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NotificationWorker.class)
                .setConstraints(constraints)
                .build();
        workManager.enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request);
    }

    public static void scheduleFromStoredUser(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        String userId = preferences.getString(USER_ID_KEY, "");
        boolean pushEnabled = preferences.getBoolean(PUSH_ENABLED_KEY, false);
        if (userId != null && userId.matches("[a-fA-F0-9]{24}")) {
            schedule(context, userId, pushEnabled);
        }
    }

    public static void clearSession(Context context) {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(USER_ID_KEY)
                .remove(PUSH_ENABLED_KEY)
                .remove(LAST_POLL_KEY)
                .apply();
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences preferences = getApplicationContext()
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        String userId = preferences.getString(USER_ID_KEY, "");
        boolean pushEnabled = preferences.getBoolean(PUSH_ENABLED_KEY, false);
        if (userId == null || !userId.matches("[a-fA-F0-9]{24}")) return Result.success();

        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://orbyapp.discloud.dev/notificacoes/" + userId);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setUseCaches(false);
            int responseCode = connection.getResponseCode();
            if (responseCode >= 500) return Result.retry();
            if (responseCode != HttpURLConnection.HTTP_OK) return Result.success();

            String responseBody;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) != -1) output.write(buffer, 0, bytesRead);
                responseBody = output.toString(StandardCharsets.UTF_8.name());
            }

            long now = System.currentTimeMillis();
            long previousPoll = preferences.getLong(LAST_POLL_KEY, 0);
            long cutoff = previousPoll == 0
                    ? now - INITIAL_LOOKBACK_MS
                    : previousPoll - POLL_OVERLAP_MS;
            JSONArray notifications = new JSONArray(responseBody);
            Set<String> deliveredIds = new HashSet<>(preferences.getStringSet("delivered_ids", new HashSet<>()));

            if (!pushEnabled) {
                for (int index = 0; index < notifications.length(); index++) {
                    JSONObject notification = notifications.getJSONObject(index);
                    String id = notification.optString("_id", "");
                    if (id.isEmpty() || notification.optBoolean("lida", false) || deliveredIds.contains(id)) continue;

                    long createdAt = parseCreatedAt(notification.optString("criadaEm", ""), now);
                    if (createdAt < cutoff) {
                        OrbyNotifications.markDelivered(getApplicationContext(), id);
                        deliveredIds.add(id);
                        continue;
                    }

                    OrbyNotifications.show(
                            getApplicationContext(),
                            notification.optString("titulo", "Orby"),
                            notification.optString("texto", "Você tem uma nova notificação."),
                            id);
                    deliveredIds.add(id);
                }
            }

            preferences.edit().putLong(LAST_POLL_KEY, now).apply();
            if (!pushEnabled) syncTaskAlarms(userId);
            return Result.success();
        } catch (Exception error) {
            Log.e(TAG, "Background notification synchronization failed", error);
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
            enqueueNextPoll();
        }
    }

    private void enqueueNextPoll() {
        if (isStopped()) return;
        SharedPreferences preferences = getApplicationContext()
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        String userId = preferences.getString(USER_ID_KEY, "");
        if (userId == null || !userId.matches("[a-fA-F0-9]{24}")) return;

        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NotificationWorker.class)
                .setConstraints(constraints)
                .setInitialDelay(POLL_INTERVAL_MINUTES, TimeUnit.MINUTES)
                .build();
        WorkManager.getInstance(getApplicationContext()).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request);
    }

    private void syncTaskAlarms(String userId) throws Exception {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://orbyapp.discloud.dev/tarefas/" + userId + "/notificacoes?includeRecent=true");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setUseCaches(false);

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new java.io.IOException("Task sync returned HTTP " + responseCode);
            }

            JSONArray tasks;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) != -1) output.write(buffer, 0, bytesRead);
                tasks = new JSONArray(output.toString(StandardCharsets.UTF_8.name()));
            }

            JSONArray alarms = new JSONArray();
            for (int index = 0; index < tasks.length(); index++) {
                JSONObject task = tasks.getJSONObject(index);
                String taskId = task.optString("_id", "");
                long triggerMs = parseTaskDate(task.optString("dataCriacao", ""));
                if (taskId.isEmpty() || triggerMs <= 0) {
                    throw new java.io.IOException("Invalid task data received during background sync");
                }

                JSONObject alarm = new JSONObject();
                alarm.put("taskId", taskId);
                alarm.put("title", "importante".equals(task.optString("tipo", ""))
                        ? "Tarefa importante"
                        : "Tarefa no horário");
                alarm.put("body", task.optString("texto", ""));
                alarm.put("triggerMs", triggerMs);
                alarms.put(alarm);
            }
            TaskAlarmScheduler.sync(getApplicationContext(), alarms);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private long parseTaskDate(String value) {
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String pattern : patterns) {
            SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.US);
            formatter.setLenient(false);
            formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
            ParsePosition position = new ParsePosition(0);
            Date date = formatter.parse(value, position);
            if (date != null && position.getIndex() == value.length()) return date.getTime();
        }
        return 0;
    }

    private long parseCreatedAt(String value, long fallback) {
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String pattern : patterns) {
            SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.US);
            formatter.setLenient(false);
            formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
            ParsePosition position = new ParsePosition(0);
            Date date = formatter.parse(value, position);
            if (date != null && position.getIndex() == value.length()) return date.getTime();
        }
        return fallback;
    }
}
