const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = (process.env.WEBSITE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '') + '/';

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const errors = [];
    const checked = new Set();
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    for (const locale of ['', 'en/']) {
      const lang = locale ? 'en-US' : 'pt-BR';
      for (const file of ['index.html', 'model.html', 'manifesto.html']) {
        await page.goto(base + locale + file);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('html').getAttribute('lang'), lang);
        assert.equal(await page.locator('.language-switch').count(), 1);
        assert.equal(await page.locator('link[hreflang="en-US"]').count(), 1);
        assert.equal(await page.locator('link[hreflang="pt-BR"]').count(), 1);
        const links = await page.locator('[src], a[href], link[href]').evaluateAll(elements => elements.map(e => e.src || e.href));
        for (const href of links) {
          const url = new URL(href); url.hash = '';
          if (!url.href.startsWith(base) || checked.has(url.href)) continue;
          checked.add(url.href);
          const response = await page.request.get(url.href);
          assert.equal(response.status(), 200, url.href);
        }
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => {
            if (document.documentElement.dataset.theme !== value) document.querySelector('.theme-toggle').click();
          }, theme);
          const label = await page.locator('.theme-toggle').getAttribute('aria-label');
          assert.match(label, locale ? /^Switch to/ : /^Ativar tema/);
          for (const width of [320, 375, 414, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}${file}: ${theme} ${width}px overflow`);
            assert.ok(await page.locator('.site-header .brand').evaluate(e => e.querySelector('.brand-dot').getBoundingClientRect().right <= e.getBoundingClientRect().right + 1), `${locale}${file}: brand overflows its box at ${width}px`);
            const boxes = await page.locator('.site-header .brand, .site-header .language-switch, .site-header .theme-toggle, .site-header .menu-toggle').evaluateAll(elements => elements.filter(e => e.getBoundingClientRect().width).map(e => {const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
            for (let i=0; i<boxes.length; i++) for (let j=i+1; j<boxes.length; j++) {
              const a=boxes[i], b=boxes[j];
              assert.ok(a.right<=b.x+1 || b.right<=a.x+1 || a.bottom<=b.y+1 || b.bottom<=a.y+1, `${locale}${file}: header collision at ${width}px`);
            }
          }
        }
        const hash = file === 'index.html' ? '#nilo' : file === 'model.html' ? '#exemplo' : '#manifesto';
        await page.goto(base + locale + file + hash);
        const theme = await page.locator('html').getAttribute('data-theme');
        await page.locator('.language-switch').click();
        await page.waitForURL(url => url.href.split('#')[0] === base + (locale ? '' : 'en/') + file);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        console.log(`${lang}: ${file}, both themes, five widths, links and language switch OK`);
      }
    }
    await page.setViewportSize({width:1280,height:900});
    await page.goto(base + 'en/index.html#baixar');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.language-switch').click();
    await page.waitForURL(url => url.pathname.endsWith('/index.html') && !url.pathname.includes('/en/'));
    assert.equal(new URL(page.url()).hash, '', 'stale #baixar must not carry over to the other language');
    await page.goto(base + 'en/index.html');
    await page.locator('[data-piece="skill"]').click();
    assert.match(await page.locator('#piece-description').innerText(), /^A skill/);
    for (const name of ['chats','studio','canvas','run','providers']) {
      await page.locator(`[data-tour="${name}"]`).click();
      const img = page.locator(`[data-product-image="${name}"]`);
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(e => e.decode());
      assert.ok((await img.getAttribute('src')).includes('/assets/'));
    }
    await page.goto(base + 'en/model.html');
    const example = await page.request.get(base + 'en/examples/hello.ohm');
    assert.equal((await page.locator('#model-example').innerText()).trim().replaceAll('\r',''), (await example.text()).trim().replaceAll('\r',''));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin:new URL(base).origin});
    await page.locator('[data-copy]').click();
    await page.waitForFunction(() => document.querySelector('[data-copy]').textContent === 'Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied.replaceAll('\r', ''), (await page.locator('#model-example').textContent()).replaceAll('\r', ''));
    const noJs = await browser.newPage({javaScriptEnabled:false});
    for (const file of ['index.html','model.html','manifesto.html']) {
      await noJs.goto(base + 'en/' + file);
      assert.ok((await noJs.locator('h1').innerText()).length > 10);
      assert.equal(await noJs.locator('.language-switch').getAttribute('hreflang'),'pt-BR');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: bilingual pages, ${checked.size} local URLs, runtime text, downloads, no-JS content.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
