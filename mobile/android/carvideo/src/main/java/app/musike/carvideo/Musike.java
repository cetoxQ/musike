package app.musike.carvideo;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

/** Musike itself, asked through its NowPlayingProvider (mobile/android/app): what's playing, and play and pause. */
final class Musike {

    private static final String TAG = "MusikeVideo";
    private static final Uri PROVIDER = Uri.parse("content://" + BuildConfig.MUSIKE_ID + ".nowplaying");

    /** What Musike last reported, or null when it can't be asked (not installed, or too old for this). */
    static final class State {
        String video = "";
        long positionMs;
        boolean playing;
    }

    private Musike() {}

    static State state(Context context) {
        Bundle result = call(context, "state", null);
        if (result == null) return null;
        State state = new State();
        state.video = result.getString("video", "");
        state.positionMs = result.getLong("positionMs");
        state.playing = result.getBoolean("playing");
        return state;
    }

    static void control(Context context, boolean play) {
        call(context, play ? "play" : "pause", null);
    }

    /** Into Musike's car log (Settings > Android Auto, which sends it), and Android's. */
    static void log(Context context, String line) {
        Log.i(TAG, line);
        call(context, "log", line);
    }

    private static Bundle call(Context context, String method, String arg) {
        try {
            return context.getContentResolver().call(PROVIDER, method, arg, null);
        } catch (Exception e) {
            // Musike isn't installed, isn't signed like this app, or predates the provider.
            return null;
        }
    }
}
