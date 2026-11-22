package app.musike.android;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What kind of device the app runs on (web/src/native/android.ts): the same APK serves phones and Android TV. And the
 * cinema view's full screen, which the web view can't keep on its own.
 */
@CapacitorPlugin(name = "MusikeDevice")
public class MusikeDevicePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        UiModeManager uiMode = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        boolean tv =
            (uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) ||
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        JSObject result = new JSObject();
        result.put("tv", tv);
        call.resolve(result);
    }

    /**
     * On: the status and navigation bars hide (a swipe from an edge shows them for a moment) and, for a landscape clip,
     * the screen turns sideways even with auto-rotate off. Off: the bars come back and the rotation follows the phone's
     * setting again. The page pads itself for the bars (env(safe-area-inset-*)), so hiding them gives it the room.
     */
    @PluginMethod
    public void fullscreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(WindowInsetsCompat.Type.systemBars());
            }
            activity.setRequestedOrientation(
                on && landscape ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            );
            call.resolve();
        });
    }
}
