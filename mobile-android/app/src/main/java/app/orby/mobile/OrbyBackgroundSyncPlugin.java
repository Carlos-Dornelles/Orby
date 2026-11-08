package app.orby.mobile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "OrbyBackgroundSync")
public final class OrbyBackgroundSyncPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String userId = call.getString("userId", "");
        boolean pushEnabled = call.getBoolean("pushEnabled", false);
        if (!userId.matches("[a-fA-F0-9]{24}")) {
            call.reject("Identificador de usuário inválido.");
            return;
        }

        NotificationWorker.schedule(getContext(), userId, pushEnabled);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        NotificationWorker.clearSession(getContext());
        TaskAlarmScheduler.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void syncTasks(PluginCall call) {
        JSArray tasks = call.getArray("tasks");
        if (tasks == null) {
            call.reject("A lista de tarefas não foi informada.");
            return;
        }

        try {
            int scheduled = TaskAlarmScheduler.sync(getContext(), tasks);
            JSObject result = new JSObject();
            result.put("scheduled", scheduled);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível sincronizar os alarmes das tarefas.", error);
        }
    }
}
