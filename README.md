# Receipt Radar

Android app that scans German and Italian supermarket receipts, compares prices for the same product across stores, and tracks spending by product, category and store.

## Install
1. Copy `ReceiptRadar-1.0.0.apk` to your phone and open it.
2. Allow "Install unknown apps" for your file manager or browser when Android asks.
3. Play Protect may warn about an unknown developer. Choose "Install anyway". The app has no ads, no tracking and no internet access beyond its own local loopback server.

Requires Android 7.0 or newer.

## Tips for good scans
- Lay the receipt flat in good, even light, filling most of the frame.
- Adjust the four corners on the crop screen. A magnifier helps with placement.
- For long receipts, use **+ Add part** to photograph the receipt in sections, top to bottom.
- Text is read on the phone by **Google ML Kit** (bundled, works offline, no Google account needed).
- If the photo is blurry, the app says so and offers a retake instead of guessing.
- After scanning, the app checks that the items add up to the printed total. If they don't, it runs a second high-contrast pass and tries single-digit OCR corrections. Lines it changed are highlighted for you to check.

## Comparing across stores
Each receipt line is linked to a **product**. The same receipt text (e.g. `H-MILCH 3,5%`) is linked automatically the next time it appears. Different stores print different names, so the Prices tab shows **"Same product, different store?"** suggestions (this also works across German and Italian, e.g. Milch ↔ Latte). Tap **Same** to merge them. You can also merge from a product's page, or change an item's product while reviewing a receipt.

Weighed items (kg) are compared per kg; everything else per piece.

## Your data
Everything stays on the phone (app-private storage). Use Settings to:
- export all items as CSV (semicolon-separated, opens directly in Excel)
- back up everything to a JSON file, including receipt images
- restore from a backup

## Building from source
GitHub Actions builds the APK on every push to `main`: open the **Actions** tab, select the latest run, and download **ReceiptRadar-apk**. To build locally, install the Android SDK and Gradle 8.14, then run `gradle assembleRelease`.

`keystore/receiptradar.jks` (password `receiptradar`) is the signing key. Keep it: updates must be signed with the same key to install over the existing app without losing data. Keep this repository private.

Layout: `web/` holds the UI and receipt parser (`web/js/parser.js`). `app/` holds the Android shell: WebView, local asset server, camera, file storage and the ML Kit bridge. `test/` has synthetic receipts and browser tests. Tesseract files in `web/vendor` and `web/tessdata` are used only for desktop-browser testing and are not included in the APK.
