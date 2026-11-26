package app.musike.android;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser.MediaItem;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.os.SystemClock;
import android.provider.Settings;
import android.service.media.MediaBrowserService;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Keeps Musike alive while music plays and connects it to the system: the media notification, the lock screen,
 * headphone and Bluetooth buttons, and pausing when headphones are unplugged. The music itself plays in the
 * WebView; this service only mirrors what the app reports (see MusikePlaybackPlugin) and relays the buttons back.
 * Everything here runs on the main thread.
 *
 * It is also what Android Auto connects to (a media browser): the car lists the queue, favorites, playlists and
 * recent items, which the app provides (web/src/native/car.ts), and plays what is picked there.
 */
// A media-session notification doesn't need the notification permission (Android 13+ exempts it).
@SuppressLint("NotificationPermission")
public class PlaybackService extends MediaBrowserService {

    private static final String TAG = "MusikePlayback";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION = "app.musike.android.action.";
    /**
     * The service is exported (Android Auto binds to it), so other apps could start it too: the buttons' intents
     * carry this, known only to this process, and others are ignored.
     */
    private static final String SECRET = UUID.randomUUID().toString();
    private static final String EXTRA_SECRET = "app.musike.android.secret";
    /** Apps allowed to browse the library: Android Auto, Google's assistant, and this app. */
    private static final Set<String> BROWSERS = new HashSet<>(
        Arrays.asList(
            "com.google.android.projection.gearhead",
            "com.google.android.googlequicksearchbox",
            "com.google.android.carassistant",
            "com.google.android.apps.automotive.templates.host"
        )
    );
    /** Of those, the car itself: opening Musike there resumes the music (and starts the app if it's closed). */
    private static final Set<String> CARS = new HashSet<>(
        Arrays.asList("com.google.android.projection.gearhead", "com.google.android.apps.automotive.templates.host")
    );
    private static final String ROOT = "root";
    /** The queue changes all the time: always asked afresh, never kept. */
    private static final String QUEUE = "queue";
    /** Lists kept for the car (the most recently shown), saved so they show even before the app opens. */
    private static final int KEPT_LISTS = 60;
    private static final String LISTS_FILE = "car-lists.json";
    private static final String NOT_OPEN = "not-open";
    /** How long the app gets to answer what a folder holds. */
    private static final long BROWSE_TIMEOUT_MS = 8000;

    /** What the app last reported. */
    static final class NowPlaying {
        String title = "";
        String artist = "";
        String album = "";
        String artwork = "";
        boolean playing;
        long positionMs;
        /** When positionMs was measured (elapsedRealtime), so the system can keep the clock moving on its own. */
        long positionAt = SystemClock.elapsedRealtime();
        long durationMs;
        /** The video's picture-only stream, for Musike Video (NowPlayingProvider); empty for a song. */
        String video = "";

        long currentPositionMs() {
            return playing ? positionMs + (SystemClock.elapsedRealtime() - positionAt) : positionMs;
        }
    }

    /** Receives the buttons pressed in the notification, on the lock screen, on headphones or in the car. */
    interface Listener {
        /**
         * position is in seconds, or negative when the action has none; value is what the car picked or searched
         * ("playItem", "search"), or null.
         */
        void onAction(String action, double position, String value);
    }

    /** Asks the app what a folder holds, for the car; it answers through deliver(). */
    interface Browser {
        void onBrowse(String request, String parent);
    }

    /** The car's own requests: "open" (Musike opened in the car), "playItem", "search". */
    interface Car {
        void onCar(String action, String value);
    }

    /** A folder the car asked for: answered once the app replies (result), or already answered from the kept list. */
    private static final class Pending {
        final String parent;
        final Result<List<MediaItem>> result;
        final long at = SystemClock.elapsedRealtime();

        Pending(String parent, Result<List<MediaItem>> result) {
            this.parent = parent;
            this.result = result;
        }
    }

    /** One entry of a folder, as the app describes it. */
    static final class Entry {
        final String id;
        final String title;
        final String subtitle;
        final boolean browsable;

        Entry(String id, String title, String subtitle, boolean browsable) {
            this.id = id;
            this.title = title;
            this.subtitle = subtitle;
            this.browsable = browsable;
        }
    }

    static final NowPlaying state = new NowPlaying();
    static Listener listener;
    static Browser browser;
    static Car car;
    private static PlaybackService instance;
    private static int requests;
    /** Folders asked by the car, waiting for the app's answer. */
    private static final Map<String, Pending> pending = new HashMap<>();
    /** The lists as the app last gave them, most recently used last. */
    private static final LinkedHashMap<String, List<Entry>> lists = new LinkedHashMap<>(16, 0.75f, true);
    private static boolean listsLoaded;
    /** What the car asked while the app was closed: handed over when it opens. */
    private static final List<String[]> waiting = new ArrayList<>();
    /** What happened with the car lately, shown in the app (Settings > Android Auto) to be sent along. */
    private static final ArrayDeque<String> journal = new ArrayDeque<>();

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private NotificationManager notifications;
    private PowerManager.WakeLock wakeLock;
    private boolean foreground;
    /** Started (not only bound by Android Auto): it can then stay in the foreground on its own. */
    private boolean started;
    private boolean noisyRegistered;
    private String artworkUrl = "";
    private Bitmap artwork;
    private long lastLaunch;
    private final Runnable saveLists = this::writeLists;

    /** Shows what the app reported, starting the service when music starts. */
    static void refresh(Context context) {
        if (instance != null) {
            instance.render();
            return;
        }
        if (!state.playing) return;
        Intent intent = new Intent(context, PlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException e) {
            // Android may refuse while the app is in the background; the next report from the app tries again.
            Log.w(TAG, "Could not start the playback service", e);
        }
    }

    static void shutdown(Context context) {
        context.stopService(new Intent(context, PlaybackService.class));
    }

    /** The app's answer to a folder the car asked for. */
    static void deliver(String request, List<Entry> entries) {
        Pending p = pending.remove(request);
        if (p == null) {
            log("answer " + request + " came too late");
            return;
        }
        long ms = SystemClock.elapsedRealtime() - p.at;
        boolean changed = !same(lists.get(p.parent), entries);
        remember(p.parent, entries);
        if (p.result != null) {
            p.result.sendResult(items(entries));
            log(p.parent + ": " + entries.size() + " from the app in " + ms + " ms");
        } else if (changed && instance != null) {
            instance.notifyChildrenChanged(p.parent);
            log(p.parent + ": updated, " + entries.size() + " (" + ms + " ms)");
        }
    }

    /** The app is open: what the car asked meanwhile goes to it, and the car's lists are refreshed. */
    static void appReady() {
        log("app ready" + (waiting.isEmpty() ? "" : ", " + waiting.size() + " waiting"));
        if (car != null) for (String[] w : waiting) car.onCar(w[0], w[1]);
        waiting.clear();
        if (instance != null) instance.notifyChildrenChanged(ROOT);
    }

    private static void toCar(String action, String value) {
        if (car != null) car.onCar(action, value);
        else waiting.add(new String[] { action, value });
    }

    /** Musike Video's play and pause button in the car (NowPlayingProvider): as if pressed in the media app. */
    static void control(boolean play) {
        PlaybackService service = instance;
        if (service == null || service.session == null) return;
        if (play) service.session.getController().getTransportControls().play();
        else service.session.getController().getTransportControls().pause();
    }

    static synchronized void log(String line) {
        Log.i(TAG, "car: " + line);
        journal.addLast(new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(new Date()) + " " + line);
        while (journal.size() > 80) journal.removeFirst();
    }

    static synchronized List<String> journal() {
        return new ArrayList<>(journal);
    }

    /** Android lets an app open itself from the background only with "display over other apps" granted. */
    static boolean canStartInBackground(Context context) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    private static List<MediaItem> items(List<Entry> entries) {
        List<MediaItem> items = new ArrayList<>();
        for (Entry e : entries) items.add(item(e.id, e.title, e.subtitle, e.browsable));
        return items;
    }

    private static boolean same(List<Entry> a, List<Entry> b) {
        if (a == null || a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            Entry x = a.get(i);
            Entry y = b.get(i);
            if (!x.id.equals(y.id) || !x.title.equals(y.title) || !x.subtitle.equals(y.subtitle) || x.browsable != y.browsable) return false;
        }
        return true;
    }

    private static void remember(String parent, List<Entry> entries) {
        if (parent.startsWith("search:")) return;
        lists.put(parent, entries);
        Iterator<String> oldest = lists.keySet().iterator();
        while (lists.size() > KEPT_LISTS && oldest.hasNext()) {
            oldest.next();
            oldest.remove();
        }
        if (instance != null && !QUEUE.equals(parent)) {
            instance.main.removeCallbacks(instance.saveLists);
            instance.main.postDelayed(instance.saveLists, 2000);
        }
    }

    private void readLists() {
        if (listsLoaded) return;
        listsLoaded = true;
        File file = new File(getFilesDir(), LISTS_FILE);
        if (!file.exists()) return;
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = new FileInputStream(file)) {
                byte[] buffer = new byte[16384];
                for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
            }
            JSONObject all = new JSONObject(bytes.toString("UTF-8"));
            for (Iterator<String> it = all.keys(); it.hasNext(); ) {
                String parent = it.next();
                JSONArray array = all.getJSONArray(parent);
                List<Entry> entries = new ArrayList<>();
                for (int i = 0; i < array.length(); i++) {
                    JSONObject o = array.getJSONObject(i);
                    entries.add(new Entry(o.optString("id"), o.optString("title"), o.optString("subtitle"), o.optBoolean("browsable")));
                }
                if (!lists.containsKey(parent)) lists.put(parent, entries);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read the car's lists", e);
        }
    }

    private void writeLists() {
        String json;
        try {
            JSONObject all = new JSONObject();
            for (Map.Entry<String, List<Entry>> list : lists.entrySet()) {
                if (QUEUE.equals(list.getKey())) continue;
                JSONArray array = new JSONArray();
                for (Entry e : list.getValue()) {
                    array.put(new JSONObject().put("id", e.id).put("title", e.title).put("subtitle", e.subtitle).put("browsable", e.browsable));
                }
                all.put(list.getKey(), array);
            }
            json = all.toString();
        } catch (Exception e) {
            return;
        }
        File file = new File(getFilesDir(), LISTS_FILE);
        new Thread(
            () -> {
                File tmp = new File(file.getPath() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                } catch (Exception e) {
                    return;
                }
                if (!tmp.renameTo(file)) tmp.delete();
            },
            "musike-car-lists"
        ).start();
    }

    /**
     * Musike opened in the car while the app is closed: it's started in the background (its page holds the library
     * and plays the music), if Android lets it.
     */
    private void launchApp() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastLaunch < 20_000) return;
        lastLaunch = now;
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_BACKGROUND, true);
        try {
            startActivity(intent);
            log("opening the app in the background (" + (canStartInBackground(this) ? "allowed" : "not allowed in Settings, Android may block it") + ")");
        } catch (RuntimeException e) {
            log("could not open the app: " + e.getMessage());
        }
    }

    private boolean appOpen() {
        return listener != null && browser != null;
    }

    private static MediaItem item(String id, String title, String subtitle, boolean browsable) {
        MediaDescription description = new MediaDescription.Builder().setMediaId(id).setTitle(title).setSubtitle(subtitle).build();
        return new MediaItem(description, browsable ? MediaItem.FLAG_BROWSABLE : MediaItem.FLAG_PLAYABLE);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        readLists();
        notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Musike:playback");
        wakeLock.setReferenceCounted(false);

        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            notifications.createNotificationChannel(channel);
        }

        session = new MediaSession(this, "Musike");
        session.setSessionActivity(openApp());
        if (Build.VERSION.SDK_INT < 26) {
            session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        }
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    // From the car or the headphones with the app closed: it opens and resumes the last track.
                    if (!appOpen()) {
                        toCar("open", null);
                        launchApp();
                        return;
                    }
                    emit("play", -1);
                }

                @Override
                public void onPause() {
                    emit("pause", -1);
                }

                @Override
                public void onStop() {
                    emit("pause", -1);
                }

                @Override
                public void onSkipToNext() {
                    emit("next", -1);
                }

                @Override
                public void onSkipToPrevious() {
                    emit("previous", -1);
                }

                @Override
                public void onSeekTo(long positionMs) {
                    // Show the new position right away; the app confirms it once the audio gets there.
                    state.positionMs = positionMs;
                    state.positionAt = SystemClock.elapsedRealtime();
                    render();
                    emit("seek", positionMs / 1000.0);
                }

                @Override
                public void onPlayFromMediaId(String mediaId, Bundle extras) {
                    if (appOpen()) emit("playItem", -1, mediaId);
                    else {
                        toCar("playItem", mediaId);
                        launchApp();
                    }
                }

                @Override
                public void onPlayFromSearch(String query, Bundle extras) {
                    String q = query == null ? "" : query;
                    if (appOpen()) emit("search", -1, q);
                    else {
                        toCar("search", q);
                        launchApp();
                    }
                }
            },
            main
        );
        session.setActive(true);
        setSessionToken(session.getSessionToken());
    }

    // Android Auto.

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        if (clientUid != Process.myUid() && !BROWSERS.contains(clientPackageName)) return null;
        // "Recent" playback for the system's resume controls: only while the app runs, so not offered.
        if (rootHints != null && rootHints.getBoolean(BrowserRoot.EXTRA_RECENT)) return null;
        if (CARS.contains(clientPackageName)) {
            // Musike opened in the car: the last track plays (the app opens first if it's closed).
            log("opened in the car" + (appOpen() ? "" : ", app closed"));
            toCar("open", null);
            if (!appOpen()) launchApp();
        }
        Bundle extras = new Bundle();
        extras.putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 1); // lists, not grids
        extras.putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1);
        return new BrowserRoot(ROOT, extras);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaItem>> result) {
        ask(parentId, result);
    }

    /**
     * The app holds the library and plays the music. A list it gave before shows at once (and its new answer
     * refreshes it); a new one waits for the app. With the app closed, the kept lists show while it opens.
     */
    private void ask(String parent, Result<List<MediaItem>> result) {
        List<Entry> kept = QUEUE.equals(parent) ? null : lists.get(parent);
        if (!appOpen()) {
            launchApp();
            if (kept != null) {
                result.sendResult(items(kept));
                log(parent + ": " + kept.size() + " kept (app closed)");
                return;
            }
            List<MediaItem> items = new ArrayList<>();
            if (ROOT.equals(parent)) items.add(item(NOT_OPEN, getString(R.string.car_open_app), getString(R.string.car_open_app_hint), true));
            result.sendResult(items);
            log(parent + ": app closed, nothing kept");
            return;
        }
        String request = String.valueOf(++requests);
        if (kept != null) {
            result.sendResult(items(kept));
            pending.put(request, new Pending(parent, null));
        } else {
            result.detach();
            pending.put(request, new Pending(parent, result));
        }
        browser.onBrowse(request, parent);
        main.postDelayed(
            () -> {
                Pending late = pending.remove(request);
                if (late == null) return;
                log(parent + ": no answer from the app in " + BROWSE_TIMEOUT_MS + " ms");
                if (late.result != null) late.result.sendResult(new ArrayList<>());
            },
            BROWSE_TIMEOUT_MS
        );
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        started = true;
        String action = intent == null ? null : intent.getAction();
        if (action != null && action.startsWith(ACTION)) {
            if (!SECRET.equals(intent.getStringExtra(EXTRA_SECRET))) {
                // Not from this app's notification.
                render();
                return START_NOT_STICKY;
            }
            String name = action.substring(ACTION.length());
            if (listener == null) {
                // A leftover notification from an app Android already closed: there is no music to control.
                stopSelf();
                return START_NOT_STICKY;
            }
            if (name.equals("dismiss")) {
                if (!state.playing) stopSelf();
            } else {
                emit(name, -1);
            }
        } else {
            // Started by the app with startForegroundService: Android requires startForeground right away,
            // even if the music was paused again in the meantime.
            goForeground(buildNotification());
        }
        render();
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping Musike away closes the page that plays the music, so the controls have nothing left to control.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        for (Pending p : pending.values()) if (p.result != null) p.result.sendResult(new ArrayList<>());
        pending.clear();
        main.removeCallbacks(saveLists);
        releaseWakeLock();
        setNoisyReceiver(false);
        session.setActive(false);
        session.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        notifications.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }

    private void emit(String action, double position) {
        emit(action, position, null);
    }

    private void emit(String action, double position, String value) {
        if (listener != null) listener.onAction(action, position, value);
    }

    private void render() {
        loadArtwork(state.artwork);
        session.setMetadata(metadata());
        session.setPlaybackState(playbackState());
        Notification notification = buildNotification();
        if (state.playing) {
            if (!started) startSelf();
            // Renewed by every progress report from the app; lapses if the app stops reporting.
            wakeLock.acquire(30 * 60 * 1000L);
            setNoisyReceiver(true);
            goForeground(notification);
        } else {
            releaseWakeLock();
            setNoisyReceiver(false);
            if (foreground) {
                // Paused: the notification stays (and can be swiped away), but Android may reclaim the service.
                stopForeground(STOP_FOREGROUND_DETACH);
                foreground = false;
            }
            notifications.notify(NOTIFICATION_ID, notification);
        }
    }

    /** Bound by Android Auto only, music starting: started too, so it stays when the car disconnects. */
    private void startSelf() {
        started = true;
        Intent intent = new Intent(this, PlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
            else startService(intent);
        } catch (RuntimeException e) {
            Log.w(TAG, "Could not start the playback service", e);
        }
    }

    private void goForeground(Notification notification) {
        if (foreground) {
            notifications.notify(NOTIFICATION_ID, notification);
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, notification);
            foreground = true;
        } catch (RuntimeException e) {
            // Resuming from the background can be refused on recent Android; keep the controls up regardless.
            Log.w(TAG, "Could not enter the foreground", e);
            notifications.notify(NOTIFICATION_ID, notification);
        }
    }

    private MediaMetadata metadata() {
        MediaMetadata.Builder b = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, state.album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs > 0 ? state.durationMs : -1);
        if (artwork != null) b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        return b.build();
    }

    private PlaybackState playbackState() {
        long actions =
            PlaybackState.ACTION_PLAY |
            PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_PLAY_PAUSE |
            PlaybackState.ACTION_STOP |
            PlaybackState.ACTION_SKIP_TO_NEXT |
            PlaybackState.ACTION_SKIP_TO_PREVIOUS |
            PlaybackState.ACTION_SEEK_TO |
            PlaybackState.ACTION_PLAY_FROM_MEDIA_ID |
            PlaybackState.ACTION_PLAY_FROM_SEARCH;
        return new PlaybackState.Builder()
            .setActions(actions)
            .setState(
                state.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                state.positionMs,
                state.playing ? 1f : 0f,
                state.positionAt
            )
            .build();
    }

    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_musike)
            .setContentTitle(state.title)
            .setContentText(state.artist)
            .setLargeIcon(artwork)
            .setContentIntent(openApp())
            .setDeleteIntent(command("dismiss"))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOngoing(state.playing)
            .setColor(0xFFC3EC52)
            .addAction(action(R.drawable.ic_media_previous, R.string.playback_previous, "previous"))
            .addAction(
                state.playing
                    ? action(R.drawable.ic_media_pause, R.string.playback_pause, "pause")
                    : action(R.drawable.ic_media_play, R.string.playback_play, "play")
            )
            .addAction(action(R.drawable.ic_media_next, R.string.playback_next, "next"))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private Notification.Action action(int icon, int label, String name) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), getString(label), command(name)).build();
    }

    private PendingIntent command(String name) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(ACTION + name).putExtra(EXTRA_SECRET, SECRET);
        return PendingIntent.getService(this, name.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void releaseWakeLock() {
        if (wakeLock.isHeld()) wakeLock.release();
    }

    // Audio focus (calls, other players) is left to the WebView: it takes focus when the music starts and pauses
    // or resumes it on its own. Asking for focus here too would take it away from the WebView, which then pauses.

    // Headphones unplugged or Bluetooth disconnected: pause instead of playing out loud.

    private final BroadcastReceiver onNoisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction()) && state.playing) emit("pause", -1);
        }
    };

    private void setNoisyReceiver(boolean on) {
        if (on == noisyRegistered) return;
        if (on) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(onNoisy, filter, RECEIVER_NOT_EXPORTED);
            else registerReceiver(onNoisy, filter);
        } else {
            unregisterReceiver(onNoisy);
        }
        noisyRegistered = on;
    }

    // Cover art for the notification and the lock screen, downloaded once per track.

    private void loadArtwork(String url) {
        if (url.equals(artworkUrl)) return;
        artworkUrl = url;
        artwork = null;
        if (url.isEmpty()) return;
        new Thread(
            () -> {
                Bitmap bitmap = download(url);
                main.post(() -> {
                    if (instance != this || !url.equals(artworkUrl) || bitmap == null) return;
                    artwork = bitmap;
                    render();
                });
            },
            "musike-artwork"
        ).start();
    }

    private static Bitmap download(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            try (InputStream in = connection.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(in);
                if (bitmap == null) return null;
                // Large bitmaps can exceed what the system accepts for a notification.
                int max = 512;
                int side = Math.max(bitmap.getWidth(), bitmap.getHeight());
                if (side <= max) return bitmap;
                float scale = (float) max / side;
                return Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not load the cover art", e);
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
