package uk.echolearn.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Remove WebView 'wv' flag so Google OAuth doesn't reject as disallowed_useragent
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            String ua = webView.getSettings().getUserAgentString();
            // Remove "; wv" which marks this as an embedded WebView
            ua = ua.replace("; wv", "");
            webView.getSettings().setUserAgentString(ua);
        }
    }
}
