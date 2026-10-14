package com.worshiparchive.band;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.net.URLEncoder;
import java.util.*;

/** Android-only Band shell. The actual musician screen is the shared packaged UI. */
public final class BandActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private LocalBandServer server;
    private LeaderDiscovery discovery;
    private SharedPreferences prefs;
    private TextView connection;
    private AlertDialog settingsDialog;
    private List<LeaderEndpoint> leaders = new ArrayList<>();
    private LeaderEndpoint selected;
    private String lastLeaderId = "";
    private String manual = "";
    private String preferred = "";
    private boolean stopping;
    private boolean hadLeader;
    private volatile String viewport = "{}";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("band", MODE_PRIVATE);
        if (!prefs.contains("deviceId")) prefs.edit().putString("deviceId", UUID.randomUUID().toString()).apply();
        manual = prefs.getString("address", "");
        preferred = prefs.getString("leaderId", "");
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(28, 29, 31));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
                if (!prefs.getBoolean("fullscreen", true)) types |= WindowInsets.Type.systemBars();
                android.graphics.Insets bars = insets.getInsets(types);
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        applyDisplaySettings();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        try {
            server = new LocalBandServer(17375, path -> getAssets().open("ui/" + path));
            web = new WebView(this);
            web.setBackgroundColor(Color.rgb(28, 29, 31));
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setTextZoom(100);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            web.addJavascriptInterface(new ConnectionBridge(), "worshipAndroid");
            web.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> publishViewport(false));
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return rejectNavigation(request.getUrl()); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return rejectNavigation(Uri.parse(url)); }
                @Override public void onPageFinished(WebView view, String url) {
                    publishViewport(true);
                    // Check the actual Android WebView rather than assuming the
                    // separately installed browser and WebView have the same engine.
                    web.evaluateJavascript("!!(window.CSS && CSS.supports('color','oklch(50% 0.1 100)') && Array.prototype.at)", value -> {
                        if ("false".equals(value) && !stopping) new AlertDialog.Builder(BandActivity.this).setMessage(R.string.old_webview).setPositiveButton(android.R.string.ok, null).show();
                    });
                }
            });
            web.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onConsoleMessage(ConsoleMessage message) {
                    if (message.message().startsWith("Song fitting failed"))
                        android.util.Log.w("WorshipLayout", message.message());
                    return super.onConsoleMessage(message);
                }
            });
            root.addView(web, new FrameLayout.LayoutParams(-1, -1));
            connection = new TextView(this);
            connection.setTextColor(Color.WHITE);
            connection.setBackgroundColor(Color.rgb(36, 37, 40));
            connection.setPadding(dp(14), dp(10), dp(14), dp(10));
            connection.setTextSize(14);
            connection.setText(R.string.searching);
            connection.setOnClickListener(view -> showConnectionSettings());
            FrameLayout.LayoutParams banner = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
            root.addView(connection, banner);
            loadBand();
            startDiscovery();
            if (prefs.getString("name", "").trim().isEmpty()) root.post(this::showConnectionSettings);
        } catch (Exception error) {
            new AlertDialog.Builder(this).setMessage(R.string.startup_error).setPositiveButton(android.R.string.ok, (dialog, which) -> finish()).show();
        }
    }

    private int dp(int size) { return Math.round(size * getResources().getDisplayMetrics().density); }

    private void publishViewport(boolean force) {
        if (web == null || stopping || web.getWidth() <= 0 || web.getHeight() <= 0) return;
        float density = getResources().getDisplayMetrics().density;
        String next = "{\"width\":" + (web.getWidth() / density) + ",\"height\":" + (web.getHeight() / density)
                + ",\"shortSide\":" + getResources().getConfiguration().smallestScreenWidthDp + "}";
        if (!force && next.equals(viewport)) return;
        viewport = next;
        // A native layout callback is authoritative even if an older WebView misses
        // its browser resize event. No reload: the song, connection and settings survive.
        web.post(() -> {
            if (!stopping && web != null) web.evaluateJavascript("window.dispatchEvent(new Event('worship-android-viewport'))", null);
        });
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyDisplaySettings();
        if (web != null) {
            web.requestLayout();
            web.invalidate();
            web.post(() -> publishViewport(true));
        }
    }

    private boolean rejectNavigation(Uri url) {
        boolean local = server != null && "http".equals(url.getScheme()) && "127.0.0.1".equals(url.getHost()) && url.getPort() == 17375;
        if (local && ("/band".equals(url.getPath()) || "/".equals(url.getPath()))) return false;
        Toast.makeText(this, R.string.band_only, Toast.LENGTH_SHORT).show();
        return true;
    }

    private void loadBand() {
        if (web == null || server == null) return;
        try {
            String name = prefs.getString("name", "").trim();
            if (name.isEmpty()) name = "Android Band";
            web.loadUrl(server.origin() + "/band?name=" + URLEncoder.encode(name, "UTF-8") + "&device=" + prefs.getString("deviceId", ""));
        } catch (Exception ignored) { }
    }

    private void startDiscovery() {
        discovery = new LeaderDiscovery(this, endpoints -> runOnUiThread(() -> {
            if (stopping) return;
            leaders = endpoints;
            chooseLeader();
        }));
        discovery.start();
        chooseLeader();
    }

    private void chooseLeader() {
        if (server == null) return;
        LeaderEndpoint next = null;
        if (!manual.isEmpty()) {
            try { next = LeaderEndpoint.manual(manual); } catch (RuntimeException ignored) { }
        } else {
            for (LeaderEndpoint endpoint : leaders) if (endpoint.id.equals(preferred)) { next = endpoint; break; }
            if (next == null && preferred.isEmpty() && leaders.size() == 1) next = leaders.get(0);
        }
        boolean differentLeader = next != null && !lastLeaderId.isEmpty() && !lastLeaderId.equals(next.id);
        selected = next;
        if (next != null) { hadLeader = true; lastLeaderId = next.id; }
        server.setLeader(next);
        // Revisions are monotonic within one Leader, not across different Leaders.
        // A deliberate host switch must reset the renderer's in-memory session.
        // An IP change for the same discovered Leader must not reset its song view.
        if (differentLeader) loadBand();
        if (connection != null) {
            // Once a song may be on screen, never cover its last lines with a native
            // reconnect banner. The shared Band header already reports disconnection.
            connection.setVisibility(next == null && !hadLeader ? View.VISIBLE : View.GONE);
            connection.setText(leaders.size() > 1 ? R.string.multiple_leaders : R.string.searching);
        }
    }

    private void showConnectionSettings() {
        if (stopping || isFinishing() || (settingsDialog != null && settingsDialog.isShowing())) return;
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView hint = new TextView(this);
        hint.setText(R.string.connection_hint);
        form.addView(hint);
        EditText name = field(form, R.string.device_name, prefs.getString("name", ""));
        name.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(60) });
        name.setSingleLine(true);
        EditText address = field(form, R.string.leader_address, manual);
        address.setHint(R.string.address_example);
        address.setSingleLine(true);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        final String[] choice = new String[] { preferred };
        Button automatic = new Button(this);
        automatic.setText(R.string.automatic);
        automatic.setOnClickListener(view -> { choice[0] = ""; address.setText(""); });
        form.addView(automatic);
        if (!leaders.isEmpty()) {
            Button choose = new Button(this);
            choose.setText(R.string.choose_leader);
            choose.setOnClickListener(view -> {
                List<LeaderEndpoint> snapshot = new ArrayList<>(leaders);
                String[] names = new String[snapshot.size()];
                for (int i = 0; i < names.length; i++) names[i] = snapshot.get(i).name + " · " + snapshot.get(i).host;
                new AlertDialog.Builder(this).setTitle(R.string.choose_leader).setItems(names, (dialog, index) -> {
                    choice[0] = snapshot.get(index).id;
                    address.setText("");
                }).show();
            });
            form.addView(choose);
        }
        CheckBox awake = new CheckBox(this);
        awake.setText(R.string.keep_awake);
        awake.setChecked(prefs.getBoolean("awake", true));
        form.addView(awake);
        CheckBox fullscreen = new CheckBox(this);
        fullscreen.setText(R.string.fullscreen);
        fullscreen.setChecked(prefs.getBoolean("fullscreen", true));
        form.addView(fullscreen);
        if (web != null) {
            Button reload = new Button(this);
            reload.setText(R.string.reload);
            reload.setOnClickListener(view -> { loadBand(); settingsDialog.dismiss(); });
            form.addView(reload);
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(form);
        settingsDialog = new AlertDialog.Builder(this).setTitle(R.string.connection_title).setView(scroll)
                .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.save, null).create();
        settingsDialog.setOnShowListener(dialog -> settingsDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String nextName = name.getText().toString().trim();
            String nextAddress = address.getText().toString().trim();
            if (nextName.isEmpty()) { name.setError(getString(R.string.name_required)); return; }
            if (!nextAddress.isEmpty()) try { LeaderEndpoint.manual(nextAddress); }
            catch (RuntimeException error) { address.setError(getString(R.string.invalid_address)); return; }
            boolean renamed = !nextName.equals(prefs.getString("name", ""));
            manual = nextAddress;
            preferred = choice[0];
            prefs.edit().putString("name", nextName).putString("address", manual).putString("leaderId", preferred)
                    .putBoolean("awake", awake.isChecked()).putBoolean("fullscreen", fullscreen.isChecked()).apply();
            applyDisplaySettings();
            chooseLeader();
            // The renderer's existing name preference must agree with native setup.
            if (renamed && web != null) web.evaluateJavascript("localStorage.removeItem('worship-archive:device-name')", ignored -> loadBand());
            settingsDialog.dismiss();
        }));
        settingsDialog.show();
    }

    private EditText field(LinearLayout form, int label, String value) {
        TextView title = new TextView(this);
        title.setPadding(0, dp(12), 0, 0);
        title.setText(label);
        form.addView(title);
        EditText input = new EditText(this);
        input.setText(value);
        form.addView(input);
        return input;
    }

    private void applyDisplaySettings() {
        if (prefs.getBoolean("awake", true)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        boolean fullscreen = prefs.getBoolean("fullscreen", true);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (fullscreen) controller.hide(WindowInsets.Type.systemBars()); else controller.show(WindowInsets.Type.systemBars());
            }
        } else getWindow().getDecorView().setSystemUiVisibility(fullscreen
                ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                : View.SYSTEM_UI_FLAG_VISIBLE);
        if (root != null) root.requestApplyInsets();
    }

    private void back() { if (settingsDialog != null && settingsDialog.isShowing()) settingsDialog.dismiss(); else finish(); }
    @Override public void onBackPressed() { back(); }
    @Override public void onResume() {
        super.onResume();
        if (web != null) { web.onResume(); web.post(() -> publishViewport(true)); }
        if (!stopping && web != null && server != null && discovery == null) startDiscovery();
    }
    @Override public void onStop() {
        if (discovery != null) { discovery.close(); discovery = null; }
        if (web != null) web.onPause();
        super.onStop();
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused && prefs != null) applyDisplaySettings(); }
    @Override public void onDestroy() {
        stopping = true;
        if (settingsDialog != null) settingsDialog.dismiss();
        if (discovery != null) discovery.close();
        if (server != null) server.close();
        if (web != null) { root.removeView(web); web.destroy(); }
        super.onDestroy();
    }

    /** Only connection settings and read-only window bounds; never files, URLs or commands. */
    public final class ConnectionBridge {
        @JavascriptInterface public void openConnectionSettings() { runOnUiThread(BandActivity.this::showConnectionSettings); }
        @JavascriptInterface public String getViewport() { return viewport; }
    }
}
