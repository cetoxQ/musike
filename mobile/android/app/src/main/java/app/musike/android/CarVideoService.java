package app.musike.android;

import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/**
 * "Musike Video" in Android Auto: the video playing in Musike, on the car's screen, while the car stands still (see
 * CarVideoScreen). Android Auto lets an app draw on the car's screen only as a map, so this is declared as a
 * navigation app; the music itself stays with the media app (PlaybackService).
 */
public class CarVideoService extends CarAppService {

    @NonNull
    @Override
    public HostValidator createHostValidator() {
        // Only Android Auto (and Google's other car hosts), by their signing keys as the library lists them.
        return new HostValidator.Builder(getApplicationContext())
            .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
            .build();
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new Session() {
            @NonNull
            @Override
            public Screen onCreateScreen(@NonNull Intent intent) {
                return new CarVideoScreen(getCarContext());
            }
        };
    }
}
