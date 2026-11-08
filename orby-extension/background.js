const SERVER_URLS = ["https://orbyapp.discloud.app", "https://orbyapp.discloud.dev"];
const SERVER_ORIGINS = SERVER_URLS.map(origin => `${origin}/*`);
const NOTIFICATION_ALARM = "orby-notification-sync";

async function loadNotifications() {
  const { orbyCompactConfig: config } = await chrome.storage.local.get("orbyCompactConfig");
  if (!config?.userId) {
    await chrome.alarms.clear(NOTIFICATION_ALARM);
    await chrome.storage.local.remove("orbyCompactNotifications");
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  const permitted = await chrome.permissions.contains({ origins: SERVER_ORIGINS });
  if (!permitted) return;

  let lastError;
  for (const server of SERVER_URLS) {
    try {
      const response = await fetch(`${server}/notificacoes/${encodeURIComponent(config.userId)}`);
      const notifications = await response.json();
      if (!response.ok || !Array.isArray(notifications)) {
        throw new Error(notifications.erro || "Não foi possível carregar as notificações.");
      }

      const unreadCount = notifications.filter(notification => !notification.lida).length;
      await chrome.storage.local.set({ orbyCompactNotifications: notifications });
      await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      await chrome.action.setBadgeText({ text: unreadCount ? String(Math.min(unreadCount, 99)) : "" });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Falha ao sincronizar as notificações do Orby:", lastError);
}

async function startNotificationSync() {
  const { orbyCompactConfig: config } = await chrome.storage.local.get("orbyCompactConfig");
  if (!config?.userId) return;
  await chrome.alarms.create(NOTIFICATION_ALARM, { periodInMinutes: 1 });
  await loadNotifications();
}

chrome.runtime.onInstalled.addListener(() => {
  startNotificationSync().catch(error => console.error("Falha ao iniciar notificações:", error));
});
chrome.runtime.onStartup.addListener(() => {
  startNotificationSync().catch(error => console.error("Falha ao retomar notificações:", error));
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === NOTIFICATION_ALARM) {
    loadNotifications().catch(error => console.error("Falha ao atualizar notificações:", error));
  }
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.orbyCompactConfig) return;
  if (changes.orbyCompactConfig.newValue?.userId) {
    startNotificationSync().catch(error => console.error("Falha ao sincronizar notificações:", error));
  } else {
    chrome.alarms.clear(NOTIFICATION_ALARM);
    chrome.storage.local.remove("orbyCompactNotifications");
    chrome.action.setBadgeText({ text: "" });
  }
});
