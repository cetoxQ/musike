package app.musike.android;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * What kind of device the app runs on (web/src/native/android.ts): the same APK serves phones and Android TV. And the
 * cinema view's full screen, which the web view can't keep on its own. And updates: the APK of a newer release,
 * downloaded and handed to Android's installer (web/src/native/android.ts).
 */
@CapacitorPlugin(name = "MusikeDevice")
public class MusikeDevicePlugin extends Plugin {

    /** Only this fork's own releases are installed (web/src/lib/updates.ts names the same repository). */
    private static final String RELEASES = "https://github.com/cetoxQ/musike/releases/download/";

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

    /**
     * Downloads the APK (progress as "updateProgress" events) and opens Android's installer with it. The first time,
     * Android asks to allow Musike to install apps; then it asks to confirm the update.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith(RELEASES) || !url.endsWith(".apk")) {
            call.reject("not a release of this app");
            return;
        }
        Context context = getContext();
        new Thread(
            () -> {
                File dir = new File(context.getCacheDir(), "updates");
                File apk = new File(dir, "update.apk");
                HttpURLConnection connection = null;
                try {
                    if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("no room for the download");
                    // GitHub answers with a redirect to its file host, which HttpURLConnection follows (both https).
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(20_000);
                    connection.setReadTimeout(60_000);
                    if (connection.getResponseCode() != 200) throw new Exception("HTTP " + connection.getResponseCode());
                    long total = connection.getContentLengthLong();
                    try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                        byte[] buffer = new byte[64 * 1024];
                        long done = 0;
                        long told = 0;
                        for (int n; (n = in.read(buffer)) > 0; ) {
                            out.write(buffer, 0, n);
                            done += n;
                            if (total > 0 && done - told > total / 50) {
                                told = done;
                                JSObject progress = new JSObject();
                                progress.put("fraction", (double) done / total);
                                notifyListeners("updateProgress", progress);
                            }
                        }
                    }
                    Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
                    Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(install);
                    call.resolve();
                } catch (Exception e) {
                    apk.delete();
                    call.reject(e.getMessage() == null ? "download failed" : e.getMessage());
                } finally {
                    if (connection != null) connection.disconnect();
                }
            },
            "musike-update"
        ).start();
    }
}
