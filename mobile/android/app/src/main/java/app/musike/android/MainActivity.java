package app.musike.android;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Started by PlaybackService for Android Auto: the page loads (library, player) without covering the phone. */
    static final String EXTRA_BACKGROUND = "app.musike.android.background";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusikePlaybackPlugin.class);
        registerPlugin(MusikeDevicePlugin.class);
        super.onCreate(savedInstanceState);
        // Draw behind the status and navigation bars on every Android version; the page pads itself
        // (env(safe-area-inset-*)) and the SystemBars plugin keeps the icons readable for the theme.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        // Only that first start: the page restored later (or reopened from the recent apps) shows normally.
        if (savedInstanceState == null && getIntent() != null && getIntent().getBooleanExtra(EXTRA_BACKGROUND, false)) {
            getIntent().removeExtra(EXTRA_BACKGROUND);
            moveTaskToBack(true);
        }
    }
}
