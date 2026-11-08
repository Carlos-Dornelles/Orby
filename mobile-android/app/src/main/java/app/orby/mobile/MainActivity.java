package app.orby.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public final class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrbyBackgroundSyncPlugin.class);
        OrbyNotifications.createChannel(this);
        super.onCreate(savedInstanceState);
    }
}
