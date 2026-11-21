package app.receiptradar;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Minimal HTTP server on 127.0.0.1 serving the bundled web app (needed so the OCR web workers load normally). */
public class LocalServer {
    private final AssetManager assets;
    private final String root;
    private ServerSocket socket;
    private ExecutorService pool;
    private volatile boolean running;
    private java.io.File pendingPhoto;

    public void setPendingPhoto(java.io.File f) {
        pendingPhoto = f;
    }

    public LocalServer(AssetManager assets, String root) {
        this.assets = assets;
        this.root = root;
    }

    public int start(int preferredPort) {
        InetAddress lo;
        try {
            lo = InetAddress.getByName("127.0.0.1");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        try {
            socket = new ServerSocket(preferredPort, 50, lo);
        } catch (Exception e) {
            try {
                socket = new ServerSocket(0, 50, lo);
            } catch (Exception e2) {
                throw new RuntimeException(e2);
            }
        }
        running = true;
        pool = Executors.newFixedThreadPool(6);
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running) {
                    try {
                        final Socket c = socket.accept();
                        pool.execute(new Runnable() {
                            @Override
                            public void run() {
                                handle(c);
                            }
                        });
                    } catch (Exception e) {
                        if (!running) return;
                    }
                }
            }
        }, "asset-server");
        t.setDaemon(true);
        t.start();
        return socket.getLocalPort();
    }

    public void stop() {
        running = false;
        try { socket.close(); } catch (Exception e) { /* ignore */ }
        if (pool != null) pool.shutdownNow();
    }

    private static String mime(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".wasm")) return "application/wasm";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".gz")) return "application/octet-stream";
        return "application/octet-stream";
    }

    private void handle(Socket c) {
        try {
            c.setSoTimeout(15000);
            BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            String line = r.readLine();
            if (line == null) { c.close(); return; }
            String h;
            while ((h = r.readLine()) != null && h.length() > 0) { /* skip headers */ }
            String[] parts = line.split(" ");
            OutputStream out = c.getOutputStream();
            if (parts.length < 2 || !("GET".equals(parts[0]) || "HEAD".equals(parts[0]))) {
                out.write("HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes("UTF-8"));
                out.flush();
                c.close();
                return;
            }
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            path = URLDecoder.decode(path, "UTF-8");
            if (path.equals("/") || path.isEmpty()) path = "/index.html";
            byte[] body = null;
            if (!path.contains("..")) {
                try {
                    InputStream in = ("/__pending/photo.jpg".equals(path) && pendingPhoto != null)
                            ? new java.io.FileInputStream(pendingPhoto) : assets.open(root + path);
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    in.close();
                    body = bo.toByteArray();
                } catch (Exception e) {
                    body = null;
                }
            }
            if (body == null) {
                byte[] msg = "Not found".getBytes("UTF-8");
                out.write(("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: " + msg.length + "\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
                out.write(msg);
            } else {
                String head = "HTTP/1.1 200 OK\r\nContent-Type: " + mime(path) + "\r\nContent-Length: " + body.length
                        + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                out.write(head.getBytes("UTF-8"));
                if ("GET".equals(parts[0])) out.write(body);
            }
            out.flush();
            c.close();
        } catch (Exception e) {
            try { c.close(); } catch (Exception e2) { /* ignore */ }
        }
    }
}
