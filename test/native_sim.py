import asyncio, subprocess, time
from playwright.async_api import async_playwright
FAKE = """
window.__mem = {};
window.AndroidBridge = {
  readFile: n => (n in __mem ? __mem[n] : null), writeFile: (n, c) => { __mem[n] = c; return true; }, deleteFile: n => true,
  exportFile: () => {}, hasPendingPhoto: () => false, version: () => '1.1.0', hasNativeOcr: () => true,
  ocr: (id, dataUrl) => { (async () => {
    if (!window.Tesseract) await new Promise(r => { const s = document.createElement('script'); s.src = 'vendor/tesseract.min.js'; s.onload = r; document.head.appendChild(s); });
    if (!window.__tw) window.__tw = await Tesseract.createWorker(['deu','ita'], 1, { workerPath: location.origin + '/vendor/worker.min.js', corePath: location.origin + '/vendor/core', langPath: location.origin + '/tessdata', cacheMethod: 'none', gzip: false });
    window.__nativeCalls = (window.__nativeCalls || 0) + 1;
    const r = await __tw.recognize(dataUrl, {}, { blocks: true });
    const lines = [];
    for (const b of r.data.blocks) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ t: l.text.trim(), c: l.confidence / 100, b: [l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1], w: l.words.map(w => ({ t: w.text, c: w.confidence / 100, b: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] })) });
    window.__nativeOcrDone(id, { text: r.data.text, lines }, null);
  })().catch(e => window.__nativeOcrDone(id, null, String(e))); },
};
"""
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8768'], cwd='/home/claude/rr-repo/web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 400, 'height': 860})
            await ctx.add_init_script(FAKE); pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://127.0.0.1:8768/index.html'); await pg.wait_for_timeout(600)
            for n in ['rewe_de', 'conad_it', 'real1']:
                async with pg.expect_file_chooser() as fc: await pg.click('[data-scan=gallery]')
                await (await fc.value).set_files(f'/home/claude/receiptradar/test/img/{n}.jpg')
                await pg.wait_for_selector('[data-go]'); await pg.click('[data-go]')
                await pg.wait_for_selector('[data-save]', timeout=120000); await pg.wait_for_timeout(200)
                warn = await pg.eval_on_selector_all('.check.bad', 'e => e.map(x => x.innerText.slice(0, 90))')
                print(n, '| native calls:', await pg.evaluate('window.__nativeCalls'), '|', await pg.inner_text('#e-check'), '|', warn)
                await pg.evaluate('window.appBack()'); await pg.wait_for_timeout(200)
                if await pg.query_selector('.modal-card [data-a=yes]'): await pg.click('.modal-card [data-a=yes]')
                await pg.wait_for_timeout(200)
            await pg.click('#btn-settings'); await pg.wait_for_timeout(200)
            print('settings:', (await pg.inner_text('.page-body')).split('\n')[1])
            await b.close()
    finally: srv.terminate()
    print('ERRORS', errs)
asyncio.run(main())
