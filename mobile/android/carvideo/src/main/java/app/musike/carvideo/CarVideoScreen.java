package app.musike.carvideo;

import android.app.Presentation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;
import androidx.car.app.hardware.CarHardwareManager;
import androidx.car.app.hardware.common.CarValue;
import androidx.car.app.hardware.common.OnCarDataAvailableListener;
import androidx.car.app.hardware.info.CarInfo;
import androidx.car.app.hardware.info.Speed;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.versioning.CarAppApiLevels;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.exoplayer.ExoPlayer;
import java.util.Collections;

/**
 * The car's screen as Musike Video: the picture of the video playing in Musike (YouTube's picture-only stream, which
 * Musike resolves and reports, see Musike.State.video), in step with its sound, which plays as always through Musike's
 * media app. Muted: the sound is Musike's.
 *
 * Android Auto keeps a map on screen while driving, so the parked rule is this screen's own: the picture shows only
 * once the car has reported standing still for a while, and goes away the moment it moves. A car that doesn't report
 * its speed shows no picture at all.
 */
public class CarVideoScreen extends Screen implements SurfaceCallback, DefaultLifecycleObserver {

    private static final String CAR_SPEED = "com.google.android.gms.permission.CAR_SPEED";
    /** Slower than this (m/s, about 1 km/h) is standing still. */
    private static final float STILL_MPS = 0.3f;
    /** How long the car must stand still before the picture shows. */
    private static final long STILL_FOR_MS = 10_000;
    /** No speed heard for this long after opening: the car doesn't report it. */
    private static final long SPEED_WAIT_MS = 6_000;
    /** The picture is moved to where the sound is when it's further off than this, and not more often than that. */
    private static final long DRIFT_MS = 800;
    private static final long SEEK_EVERY_MS = 4_000;
    private static final long TICK_MS = 500;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExoPlayer player;
    private final long openedAt = SystemClock.elapsedRealtime();

    private VirtualDisplay display;
    private Presentation presentation;
    private FrameLayout stage;
    private TextureView picture;
    private TextView note;

    private CarInfo carInfo;
    private boolean speedAllowed = true;
    private boolean speedKnown;
    /** When the car came to a standstill (elapsedRealtime), or -1 while it moves. */
    private long stillSince = -1;

    /** The stream loaded in the player, and the last one that failed (not tried again). */
    private String loaded;
    private String failed;
    private long lastSeek;
    private boolean shownPlaying;
    /** Whether Musike answered the last time it was asked. */
    private boolean reached = true;

    private final OnCarDataAvailableListener<Speed> onSpeed = (speed) -> {
        CarValue<Float> value = speed.getRawSpeedMetersPerSecond();
        if (value.getStatus() != CarValue.STATUS_SUCCESS || value.getValue() == null) value = speed.getDisplaySpeedMetersPerSecond();
        Float mps = value.getStatus() == CarValue.STATUS_SUCCESS ? value.getValue() : null;
        if (mps == null) {
            // Not known now: treated as moving.
            speedKnown = false;
            stillSince = -1;
            return;
        }
        speedKnown = true;
        if (Math.abs(mps) >= STILL_MPS) stillSince = -1;
        else if (stillSince < 0) stillSince = SystemClock.elapsedRealtime();
        tick();
    };

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            tick();
            main.postDelayed(this, TICK_MS);
        }
    };

    public CarVideoScreen(@NonNull CarContext context) {
        super(context);
        player = new ExoPlayer.Builder(context).build();
        player.setVolume(0f);
        player.addListener(
            new Player.Listener() {
                @Override
                public void onVideoSizeChanged(@NonNull VideoSize size) {
                    fit();
                }

                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    Musike.log(context, "player error " + error.getErrorCodeName());
                    failed = loaded;
                    loaded = null;
                    tick();
                }
            }
        );
        context.getCarService(AppManager.class).setSurfaceCallback(this);
        getLifecycle().addObserver(this);
    }

    @Override
    public void onCreate(@NonNull LifecycleOwner owner) {
        Musike.log(getCarContext(), "opened, car API level " + getCarContext().getCarAppApiLevel());
        listenToSpeed();
        main.post(ticker);
    }

    @Override
    public void onDestroy(@NonNull LifecycleOwner owner) {
        main.removeCallbacks(ticker);
        if (carInfo != null) {
            try {
                carInfo.removeSpeedListener(onSpeed);
            } catch (Exception ignored) {
                // the car is gone already
            }
        }
        player.release();
        closeStage();
    }

    private void listenToSpeed() {
        CarContext context = getCarContext();
        if (context.getCarAppApiLevel() < CarAppApiLevels.LEVEL_3) return; // too old an Android Auto to tell
        if (ContextCompat.checkSelfPermission(context, CAR_SPEED) != PackageManager.PERMISSION_GRANTED) {
            speedAllowed = false;
            // Android shows the question on the phone.
            context.requestPermissions(
                Collections.singletonList(CAR_SPEED),
                (granted, rejected) -> {
                    speedAllowed = granted.contains(CAR_SPEED);
                    if (speedAllowed) listenToSpeed();
                }
            );
            return;
        }
        try {
            carInfo = context.getCarService(CarHardwareManager.class).getCarInfo();
            carInfo.addSpeedListener(ContextCompat.getMainExecutor(context), onSpeed);
        } catch (Exception e) {
            Musike.log(context, "no speed, " + e.getClass().getSimpleName());
            carInfo = null;
        }
    }

    private boolean parked() {
        return speedKnown && stillSince >= 0 && SystemClock.elapsedRealtime() - stillSince >= STILL_FOR_MS;
    }

    private void tick() {
        Musike.State state = Musike.state(getCarContext());
        reached = state != null;
        if (state == null) state = new Musike.State();
        String url = state.video;
        boolean hasVideo = url != null && !url.isEmpty() && !url.equals(failed);
        boolean show = hasVideo && parked();
        long now = SystemClock.elapsedRealtime();

        if (!hasVideo && loaded != null) {
            player.stop();
            player.clearMediaItems();
            loaded = null;
        }
        if (show) {
            if (!url.equals(loaded)) {
                loaded = url;
                player.setMediaItem(MediaItem.fromUri(url));
                player.prepare();
                player.seekTo(state.positionMs);
                lastSeek = now;
            }
            player.setPlayWhenReady(state.playing);
            long target = state.positionMs;
            boolean ready = player.getPlaybackState() == Player.STATE_READY;
            if (ready && Math.abs(player.getCurrentPosition() - target) > DRIFT_MS && now - lastSeek > SEEK_EVERY_MS) {
                lastSeek = now;
                player.seekTo(target);
            }
        } else {
            player.setPlayWhenReady(false);
        }

        if (picture != null) {
            picture.setVisibility(show ? View.VISIBLE : View.INVISIBLE);
            String message = show ? null : message(hasVideo, url);
            note.setVisibility(message == null ? View.GONE : View.VISIBLE);
            if (message != null) note.setText(message);
        }
        if (state.playing != shownPlaying) {
            shownPlaying = state.playing;
            invalidate();
        }
    }

    /** Why there's no picture now. */
    private String message(boolean hasVideo, String url) {
        Context context = getCarContext();
        if (!reached) return context.getString(R.string.car_video_no_musike);
        if (!hasVideo) {
            if (url != null && !url.isEmpty()) return context.getString(R.string.car_video_failed);
            return context.getString(R.string.car_video_none);
        }
        if (!speedAllowed) return context.getString(R.string.car_video_permission);
        if (!speedKnown) {
            boolean waiting = carInfo != null && SystemClock.elapsedRealtime() - openedAt < SPEED_WAIT_MS;
            return waiting ? context.getString(R.string.car_video_reading) : context.getString(R.string.car_video_no_speed);
        }
        if (stillSince >= 0) return context.getString(R.string.car_video_soon);
        return context.getString(R.string.car_video_parked_only);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        boolean playing = shownPlaying;
        Action toggle = new Action.Builder()
            .setIcon(
                new CarIcon.Builder(
                    IconCompat.createWithResource(getCarContext(), playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play)
                ).build()
            )
            .setOnClickListener(() -> Musike.control(getCarContext(), !shownPlaying))
            .build();
        return new NavigationTemplate.Builder().setActionStrip(new ActionStrip.Builder().addAction(toggle).build()).build();
    }

    // The car's screen: a display of the app's own, on which the picture and the notes are ordinary views.

    @Override
    public void onSurfaceAvailable(@NonNull SurfaceContainer container) {
        closeStage();
        if (container.getSurface() == null || container.getWidth() <= 0 || container.getHeight() <= 0) return;
        Context context = getCarContext();
        DisplayManager displays = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        display = displays.createVirtualDisplay(
            "MusikeCarVideo",
            container.getWidth(),
            container.getHeight(),
            container.getDpi(),
            container.getSurface(),
            DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
        );
        presentation = new Presentation(context, display.getDisplay());
        Context shown = presentation.getContext();
        stage = new FrameLayout(shown);
        stage.setBackgroundColor(Color.BLACK);
        picture = new TextureView(shown);
        picture.setVisibility(View.INVISIBLE);
        stage.addView(picture, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        note = new TextView(shown);
        note.setTextColor(Color.WHITE);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        note.setGravity(Gravity.CENTER);
        int pad = Math.round(32 * container.getDpi() / 160f);
        note.setPadding(pad, pad, pad, pad);
        stage.addView(note, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        presentation.setContentView(stage);
        presentation.show();
        player.setVideoTextureView(picture);
        fit();
        tick();
    }

    @Override
    public void onSurfaceDestroyed(@NonNull SurfaceContainer container) {
        closeStage();
    }

    private void closeStage() {
        if (picture != null) player.clearVideoTextureView(picture);
        if (presentation != null) presentation.dismiss();
        if (display != null) display.release();
        presentation = null;
        display = null;
        stage = null;
        picture = null;
        note = null;
    }

    /** The picture as large as the screen allows, in its own proportions. */
    private void fit() {
        if (picture == null || stage == null) return;
        VideoSize size = player.getVideoSize();
        int w = stage.getWidth() > 0 ? stage.getWidth() : display.getDisplay().getMode().getPhysicalWidth();
        int h = stage.getHeight() > 0 ? stage.getHeight() : display.getDisplay().getMode().getPhysicalHeight();
        if (size.width <= 0 || size.height <= 0 || w <= 0 || h <= 0) return;
        float ratio = size.width * size.pixelWidthHeightRatio / size.height;
        int fitW = w;
        int fitH = Math.round(w / ratio);
        if (fitH > h) {
            fitH = h;
            fitW = Math.round(h * ratio);
        }
        picture.setLayoutParams(new FrameLayout.LayoutParams(fitW, fitH, Gravity.CENTER));
    }
}
