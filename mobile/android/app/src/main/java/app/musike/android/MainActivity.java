package app.musike.android;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {

    /** Started by PlaybackService for Android Auto: the page loads (library, player) without covering the phone. */
    static final String EXTRA_BACKGROUND = "app.musike.android.background";

    private static final Pattern LINK = Pattern.compile("https?://\\S+");

    /**
     * Share > Musike sends text ("https://youtu.be/..." or a title and a link): turned into the same intent as a link
     * opened with Musike, which the App plugin hands to the page (appUrlOpen, getLaunchUrl). The page plays it.
     */
    private static void shareAsLink(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        Matcher link = LINK.matcher(text == null ? "" : text);
        if (!link.find()) return;
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(link.group()));
    }

    /** Reopened from the recent apps, or restored after Android closed it: the link it was opened with has played. */
    private static void forgetPlayedLink(Intent intent, boolean restored) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        if (!restored && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) return;
        intent.setAction(Intent.ACTION_MAIN);
        intent.setData(null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        shareAsLink(intent);
        super.onNewIntent(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        shareAsLink(getIntent());
        forgetPlayedLink(getIntent(), savedInstanceState != null);
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
