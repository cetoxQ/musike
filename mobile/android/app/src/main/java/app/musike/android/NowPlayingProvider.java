package app.musike.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * What's playing, for Musike Video (mobile/android/carvideo), the separate app that shows the video's picture on the
 * car's screen: Android Auto lists only one of an app's car experiences, so the video one is an app of its own, and
 * asks this one through call(). Only apps signed with this app's key may (the NOW_PLAYING permission).
 *
 * "state": video (the picture-only stream, empty for a song), positionMs (now), playing.
 * "play" / "pause": as if pressed in the media app. "log" (arg: the line): into the car's log, which Settings sends.
 */
public class NowPlayingProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    @Nullable
    @Override
    public Bundle call(@NonNull String method, @Nullable String arg, @Nullable Bundle extras) {
        Context context = getContext();
        // A provider's permission covers query() and the like, not call(): checked here.
        if (context == null || context.checkCallingPermission(context.getPackageName() + ".permission.NOW_PLAYING") != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("not Musike Video");
        }
        Bundle result = new Bundle();
        switch (method) {
            case "state": {
                PlaybackService.NowPlaying state = PlaybackService.state;
                result.putString("video", state.video);
                result.putLong("positionMs", state.currentPositionMs());
                result.putBoolean("playing", state.playing);
                break;
            }
            case "play":
            case "pause":
                PlaybackService.control(method.equals("play"));
                break;
            case "log":
                if (arg != null) PlaybackService.log("car video: " + arg);
                break;
            default:
                return null;
        }
        return result;
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection, @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        return null;
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        return null;
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        return null;
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection, @Nullable String[] selectionArgs) {
        return 0;
    }
}
