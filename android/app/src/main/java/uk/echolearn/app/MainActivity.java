package uk.echolearn.app;

import android.webkit.WebView;

import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static boolean openWithoutMigrationOnce;
    private static boolean migrationChecked;
    private StudyOriginMigration migration;
    private AlertDialog migrationDialog;

    @Override
    protected void load() {
        if (openWithoutMigrationOnce || migrationChecked) {
            openWithoutMigrationOnce = false;
            loadApp();
            return;
        }
        migrationDialog = new AlertDialog.Builder(this)
            .setMessage(R.string.study_migration_running)
            .setCancelable(false)
            .show();
        migration = new StudyOriginMigration(this, result -> {
            migrationDialog.dismiss();
            if (result.equals("complete")) {
                migrationChecked = true;
                recreate();
            } else {
                migrationDialog = new AlertDialog.Builder(this)
                    .setMessage(result.equals("account") ? R.string.study_migration_account : R.string.study_migration_retry)
                    .setPositiveButton(R.string.study_migration_open, (dialog, which) -> {
                        openWithoutMigrationOnce = true;
                        recreate();
                    })
                    .setCancelable(false)
                    .show();
            }
        });
        migration.start();
    }

    private void loadApp() {
        super.load();
        // Remove WebView 'wv' flag so Google OAuth doesn't reject as disallowed_useragent
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            String ua = webView.getSettings().getUserAgentString();
            // Remove "; wv" which marks this as an embedded WebView
            ua = ua.replace("; wv", "");
            webView.getSettings().setUserAgentString(ua);
        }
    }

    @Override
    public void onDestroy() {
        if (migration != null) migration.close();
        if (migrationDialog != null) migrationDialog.dismiss();
        super.onDestroy();
    }
}
