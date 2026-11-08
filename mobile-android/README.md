# Orby para Android

O APK usa Capacitor e `@capacitor/local-notifications` para agendar notificações locais de tarefas pendentes. Os alarmes são registrados no Android, podem tocar com o app fechado e não são notificações permanentes. O ícone de status usa a arte do Orby configurada em `capacitor.config.json`. O site continua sendo carregado de `https://orbyapp.discloud.dev/`.

## Sincronizar e compilar

1. Na raiz do projeto, instale as dependências com `npm.cmd install`.
2. Sincronize as dependências nativas com `npx.cmd cap sync android`.
3. Abra `mobile-android` no Android Studio, usando JDK 17 ou mais recente e Android SDK Platform 35.
4. Gere o APK em **Build > Build APK(s)**. O APK de teste ficará em `mobile-android/app/build/outputs/apk/debug/app-debug.apk`.

No app, abra **Configurações > Ativar notificações** e permita notificações e **Alarmes e lembretes** para o Orby. Ao entrar no app, a conta é registrada para sincronização nativa. As tarefas salvas pela web são consultadas em segundo plano por trabalhos nativos em cadeia, com intervalo de teste de 1 minuto; após encontradas, o próprio Android agenda o alarme exato, que pode tocar com o app fechado. A verificação não é instantânea nem garantida exatamente a cada minuto: o Android pode adiá-la conforme bateria, rede e otimizações do fabricante. Tarefas feitas no app são sincronizadas imediatamente. Forçar a parada do app nas configurações do Android pode impedir o trabalho em segundo plano até ele ser aberto de novo.

Publique também a versão atualizada do servidor/site na Discloud antes de distribuir o APK: a página web e a API de tarefas continuam sendo carregadas do servidor. O APK sozinho não publica essas alterações.
