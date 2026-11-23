package app.receiptradar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Point;
import android.graphics.Rect;
import android.util.Base64;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;

public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_EXPORT = 2;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private WebView web;
    private LocalServer server;
    private String baseUrl;
    private ValueCallback<Uri[]> fileCallback;
    private boolean cameraPending;
    private File exportTemp;
    private volatile boolean pendingPhoto;
    private TextRecognizer recognizer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#F6F3EC"));
        w.setNavigationBarColor(Color.parseColor("#FFFDF9"));
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= 0x00000010; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        w.getDecorView().setSystemUiVisibility(flags);

        if (savedInstanceState != null) cameraPending = savedInstanceState.getBoolean("cameraPending", false);
        server = new LocalServer(getAssets(), "www");
        server.setPendingPhoto(PhotoProvider.photoFile(this));
        int port = server.start(38457);
        baseUrl = "http://127.0.0.1:" + port + "/";

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F6F3EC"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith(baseUrl)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { /* ignore */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return openChooser(callback, params);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("ReceiptRadar", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.loadUrl(baseUrl + "index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("cameraPending", cameraPending);
    }

    private boolean openChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        boolean image = false;
        String[] types = params.getAcceptTypes();
        if (types != null) for (String t : types) if (t != null && t.startsWith("image")) image = true;
        Intent intent = null;
        cameraPending = false;
        if (image && params.isCaptureEnabled()) {
            intent = cameraIntent();
            if (intent != null) cameraPending = true;
        }
        if (intent == null) {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(image ? "image/*" : "*/*");
        }
        try {
            startActivityForResult(intent, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            cameraPending = false;
            fileCallback.onReceiveValue(null);
            fileCallback = null;
            Toast.makeText(this, "No app found to open this", Toast.LENGTH_LONG).show();
        }
        return true;
    }

    private Intent cameraIntent() {
        File f = PhotoProvider.photoFile(this);
        if (f.exists()) f.delete();
        Uri uri = PhotoProvider.photoUri();
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("photo", uri));
        return i;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                if (cameraPending) {
                    File f = PhotoProvider.photoFile(this);
                    if (f.exists() && f.length() > 0) result = new Uri[]{PhotoProvider.photoUri()};
                }
                if (result == null && data != null) {
                    if (data.getData() != null) result = new Uri[]{data.getData()};
                    else if (data.getClipData() != null && data.getClipData().getItemCount() > 0)
                        result = new Uri[]{data.getClipData().getItemAt(0).getUri()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(result);
            else if (cameraPending && result != null) pendingPhoto = true; // app was restarted while the camera was open
            cameraPending = false;
            fileCallback = null;
        } else if (requestCode == REQ_EXPORT) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && exportTemp != null) {
                try {
                    OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt");
                    InputStream is = new FileInputStream(exportTemp);
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
                    is.close();
                    os.close();
                    Toast.makeText(this, "File saved", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Saving failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            if (exportTemp != null) exportTemp.delete();
            exportTemp = null;
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 'y' : 'n'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"\"y\"".equals(v)) MainActivity.super.onBackPressed();
            }
        });
    }

    private TextRecognizer recognizer() {
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return recognizer;
    }

    private static JSONArray box(Rect r) throws Exception {
        JSONArray a = new JSONArray();
        if (r == null) { a.put(0); a.put(0); a.put(0); a.put(0); return a; }
        a.put(r.left); a.put(r.top); a.put(r.right); a.put(r.bottom);
        return a;
    }

    private static JSONArray corners(Point[] pts) throws Exception {
        if (pts == null || pts.length != 4) return null;
        JSONArray a = new JSONArray();
        for (Point p : pts) { a.put(p.x); a.put(p.y); }
        return a;
    }

    private static String textToJson(Text text) throws Exception {
        JSONObject root = new JSONObject();
        root.put("text", text.getText());
        JSONArray lines = new JSONArray();
        for (Text.TextBlock b : text.getTextBlocks()) {
            for (Text.Line l : b.getLines()) {
                JSONObject lo = new JSONObject();
                lo.put("t", l.getText());
                lo.put("c", (double) l.getConfidence());
                lo.put("b", box(l.getBoundingBox()));
                JSONArray lp = corners(l.getCornerPoints());
                if (lp != null) lo.put("p", lp);
                JSONArray words = new JSONArray();
                for (Text.Element e : l.getElements()) {
                    JSONObject w = new JSONObject();
                    w.put("t", e.getText());
                    w.put("c", (double) e.getConfidence());
                    w.put("b", box(e.getBoundingBox()));
                    words.put(w);
                }
                lo.put("w", words);
                lines.put(lo);
            }
        }
        root.put("lines", lines);
        return root.toString();
    }

    private void deliverOcr(String id, String json, String error) {
        final String js = "window.__nativeOcrDone && window.__nativeOcrDone(" + JSONObject.quote(id) + ","
                + (json == null ? "null" : json) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) recognizer.close();
        if (server != null) server.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private File dataDir() {
        File d = new File(getFilesDir(), "data");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static boolean safeName(String n) {
        return n != null && n.matches("[A-Za-z0-9_.-]{1,120}") && !n.startsWith(".");
    }

    private static byte[] readAll(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        byte[] b = new byte[(int) f.length()];
        int off = 0, n;
        while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
        in.close();
        return b;
    }

    /** Methods callable from JavaScript as window.AndroidBridge.* */
    public class Bridge {
        @JavascriptInterface
        public String readFile(String name) {
            if (!safeName(name)) return null;
            try {
                File f = new File(dataDir(), name);
                if (!f.exists()) return null;
                return new String(readAll(f), UTF8);
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public boolean writeFile(String name, String content) {
            if (!safeName(name)) return false;
            try {
                File dir = dataDir();
                File tmp = new File(dir, name + ".tmp");
                FileOutputStream out = new FileOutputStream(tmp);
                out.write(content.getBytes(UTF8));
                out.getFD().sync();
                out.close();
                File dst = new File(dir, name);
                if (!tmp.renameTo(dst)) {
                    dst.delete();
                    return tmp.renameTo(dst);
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean deleteFile(String name) {
            if (!safeName(name)) return false;
            return new File(dataDir(), name).delete();
        }

        @JavascriptInterface
        public void exportFile(final String filename, final String mime, String content) {
            try {
                File f = new File(getCacheDir(), "export.tmp");
                FileOutputStream out = new FileOutputStream(f);
                out.write(content.getBytes(UTF8));
                out.close();
                exportTemp = f;
            } catch (Exception e) {
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime);
                    i.putExtra(Intent.EXTRA_TITLE, filename);
                    try {
                        startActivityForResult(i, REQ_EXPORT);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No file manager available", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean hasPendingPhoto() {
            boolean p = pendingPhoto;
            pendingPhoto = false;
            return p;
        }

        @JavascriptInterface
        public String version() {
            return "1.2.0";
        }

        /** Runs Google ML Kit text recognition on a JPEG data URL; result comes back via window.__nativeOcrDone(id, json, error). */
        @JavascriptInterface
        public void ocr(final String id, final String dataUrl) {
            try {
                int comma = dataUrl.indexOf(',');
                byte[] bytes = Base64.decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) { deliverOcr(id, null, "Could not decode image"); return; }
                recognizer().process(InputImage.fromBitmap(bmp, 0))
                        .addOnSuccessListener(text -> {
                            try { deliverOcr(id, textToJson(text), null); }
                            catch (Exception e) { deliverOcr(id, null, e.toString()); }
                        })
                        .addOnFailureListener(e -> deliverOcr(id, null, String.valueOf(e.getMessage())));
            } catch (Throwable t) {
                deliverOcr(id, null, t.toString());
            }
        }

        @JavascriptInterface
        public boolean hasNativeOcr() {
            return true;
        }
    }
}
