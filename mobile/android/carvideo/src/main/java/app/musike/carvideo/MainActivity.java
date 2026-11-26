package app.musike.carvideo;

import android.app.Activity;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.TextView;

/** On the phone, Musike Video only says whether it reaches Musike and where to find it: it shows in the car. */
public class MainActivity extends Activity {

    private TextView text;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        text = new TextView(this);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        text.setGravity(Gravity.CENTER);
        int pad = Math.round(32 * getResources().getDisplayMetrics().density);
        text.setPadding(pad, pad, pad, pad);
        setContentView(text);
    }

    @Override
    protected void onResume() {
        super.onResume();
        text.setText(Musike.state(this) != null ? R.string.video_app_ready : R.string.car_video_no_musike);
    }
}
