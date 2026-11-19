package app.musike.android;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * The app's side of PlaybackService (web/src/native/media.ts): the player reports the track and its progress
 * through update(), and the buttons pressed outside the app come back as "action" events.
 */
@CapacitorPlugin(name = "MusikePlayback")
public class MusikePlaybackPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        PlaybackService.listener = (action, position, value) -> {
            JSObject event = new JSObject();
            event.put("action", action);
            if (position >= 0) event.put("position", position);
            if (value != null) event.put("value", value);
            notifyListeners("action", event);
        };
        PlaybackService.browser = (request, parent) -> {
            JSObject event = new JSObject();
            event.put("request", request);
            event.put("parent", parent);
            notifyListeners("browse", event);
        };
    }

    /** What a folder holds, for Android Auto (the answer to a "browse" event). */
    @PluginMethod
    public void browseResult(PluginCall call) {
        String request = call.getString("request");
        JSArray items = call.getArray("items");
        List<PlaybackService.Entry> entries = new ArrayList<>();
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null || o.optString("id").isEmpty()) continue;
                entries.add(
                    new PlaybackService.Entry(o.optString("id"), o.optString("title"), o.optString("subtitle"), o.optBoolean("browsable"))
                );
            }
        }
        if (request != null) main.post(() -> PlaybackService.deliver(request, entries));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title");
        String artist = call.getString("artist");
        String album = call.getString("album");
        String artwork = call.getString("artwork");
        Boolean playing = call.getBoolean("playing");
        Double position = call.getDouble("position");
        Double duration = call.getDouble("duration");
        main.post(() -> {
            PlaybackService.NowPlaying state = PlaybackService.state;
            long now = SystemClock.elapsedRealtime();
            if (position != null) {
                state.positionMs = Math.max(0, Math.round(position * 1000));
            } else {
                state.positionMs = state.currentPositionMs();
            }
            state.positionAt = now;
            if (title != null) state.title = title;
            if (artist != null) state.artist = artist;
            if (album != null) state.album = album;
            if (artwork != null) state.artwork = artwork;
            if (playing != null) state.playing = playing;
            if (duration != null) state.durationMs = Math.max(0, Math.round(duration * 1000));
            else if (title != null) state.durationMs = 0; // a new track, not loaded yet
            PlaybackService.refresh(getContext());
        });
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.listener = null;
        PlaybackService.browser = null;
        PlaybackService.shutdown(getContext());
    }
}
