package uk.echolearn.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

final class StudyOriginMigration {
    private static final String OLD_ORIGIN = "https://app.echo-learn.uk/";
    private static final String NEW_ORIGIN = "https://echo-learn.uk/";
    private static final long TIMEOUT_MS = 30_000;

    private final Context context;
    private final ValueCallback<String> finished;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> finish("retry");
    private WebView source;
    private WebView target;
    private String page;
    private String requestId;
    private boolean closed;

    StudyOriginMigration(Context context, ValueCallback<String> finished) {
        this.context = context;
        this.finished = finished;
    }

    void start() {
        try (InputStream input = context.getAssets().open("study-origin-migration.js")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096];
            for (int count; (count = input.read(bytes)) != -1;) buffer.write(bytes, 0, count);
            page = "<!doctype html><meta charset=utf-8>"
                + "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; script-src 'unsafe-inline'\">"
                + "<script>" + buffer.toString("UTF-8") + "</script>";
            target = offlineView();
            target.addJavascriptInterface(new TargetChannel(), "MigrationChannel");
            target.setWebViewClient(new OfflineClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    if (!closed && NEW_ORIGIN.equals(url)) view.evaluateJavascript("Migration.run()", null);
                }
            });
            renewTimeout();
            target.loadDataWithBaseURL(NEW_ORIGIN, page, "text/html", "UTF-8", null);
        } catch (IOException | RuntimeException error) {
            finish("retry");
        }
    }

    private WebView offlineView() {
        WebView view = new WebView(context);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setBlockNetworkLoads(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        return view;
    }

    private class OfflineClient extends WebViewClient {
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            finish("retry");
            return true;
        }
    }

    private void renewTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, TIMEOUT_MS);
    }

    private void querySource(String script) {
        if (source != null) {
            source.evaluateJavascript(script, null);
            return;
        }
        source = offlineView();
        source.addJavascriptInterface(new SourceChannel(), "MigrationChannel");
        source.setWebViewClient(new OfflineClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (!closed && OLD_ORIGIN.equals(url)) view.evaluateJavascript(script, null);
            }
        });
        source.loadDataWithBaseURL(OLD_ORIGIN, page, "text/html", "UTF-8", null);
    }

    private final class TargetChannel {
        @JavascriptInterface public void request(String id, String method, String arguments) {
            handler.post(() -> {
                if (closed) return;
                if (requestId != null || !id.matches("[0-9]+")
                    || !(method.equals("snapshot") || method.equals("snapshotChunk")
                    || method.equals("mediaInfo") || method.equals("mediaChunk"))) {
                    finish("retry");
                    return;
                }
                try {
                    JSONArray args = new JSONArray(arguments);
                    requestId = id;
                    renewTimeout();
                    querySource("Migration.respond("
                        + JSONObject.quote(id) + "," + JSONObject.quote(method) + "," + args + ")");
                } catch (JSONException | RuntimeException error) {
                    finish("retry");
                }
            });
        }

        @JavascriptInterface public void complete(String result) {
            handler.post(() -> finish(result));
        }
    }

    private final class SourceChannel {
        @JavascriptInterface public void reply(String id, String response) {
            handler.post(() -> {
                if (closed || !id.equals(requestId)) return;
                requestId = null;
                renewTimeout();
                target.evaluateJavascript("Migration.receive(" + JSONObject.quote(id) + ","
                    + JSONObject.quote(response) + ")", null);
            });
        }
    }

    private void finish(String result) {
        if (closed) return;
        close();
        finished.onReceiveValue(result);
    }

    void close() {
        if (closed) return;
        closed = true;
        handler.removeCallbacksAndMessages(null);
        if (source != null) source.destroy();
        if (target != null) target.destroy();
    }
}
