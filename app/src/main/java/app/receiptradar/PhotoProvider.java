package app.receiptradar;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Gives the camera app a place to write the full-resolution receipt photo. */
public class PhotoProvider extends ContentProvider {
    public static final String AUTHORITY = "app.receiptradar.photos";

    public static File photoFile(Context ctx) {
        File d = new File(ctx.getCacheDir(), "camera");
        if (!d.exists()) d.mkdirs();
        return new File(d, "photo.jpg");
    }

    public static Uri photoUri() {
        return Uri.parse("content://" + AUTHORITY + "/photo.jpg");
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"photo.jpg".equals(uri.getLastPathSegment())) throw new FileNotFoundException();
        File f = photoFile(getContext());
        int m = ParcelFileDescriptor.parseMode(mode);
        if ((m & ParcelFileDescriptor.MODE_WRITE_ONLY) != 0 || (m & ParcelFileDescriptor.MODE_READ_WRITE) != 0) m |= ParcelFileDescriptor.MODE_CREATE;
        return ParcelFileDescriptor.open(f, m);
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f = photoFile(getContext());
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{"receipt.jpg", f.length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
