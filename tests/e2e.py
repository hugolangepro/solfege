"""Bout en bout : Chrome sans écran, l'enregistrement de mesure sert de micro, l'app doit valider les notes."""
import asyncio, json, sys, urllib.parse
from playwright.async_api import async_playwright

SEQ = open('/home/claude/work/solfege/tests/s13_seq.txt').read().strip().split(',')
WAV = '/home/claude/work/solfege/tests/s13_48k.wav'

async def run(name, seq, viewport, wait_s, shots=True, debug=False):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                                                          f'--use-file-for-fake-audio-capture={WAV}%noloop', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport=viewport, device_scale_factor=2, permissions=['microphone'])
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        url = 'http://localhost:8765/index.html?seq=' + urllib.parse.quote(','.join(seq)) + ('&debug' if debug else '')
        await pg.goto(url)
        await pg.wait_for_timeout(800)
        if shots: await pg.screenshot(path=f'/home/claude/work/solfege/tests/{name}_accueil.png')
        await pg.click('#go')
        await pg.wait_for_timeout(11000)
        if shots: await pg.screenshot(path=f'/home/claude/work/solfege/tests/{name}_encours.png')
        await pg.wait_for_timeout(int(wait_s * 1000) - 11000)
        state = await pg.evaluate('''() => { const s = window.__solfege.session; if (!s) return null;
            return { over: s.over, rate: s.rate, n: s.N, heard: s.heard.length, tStart: s.tStart,
                     v: window.__solfege.verdicts().map(q => q ? q.v + (q.v === 'faux' ? ':' + q.cls : '') : null) }; }''')
        result = await pg.inner_text('#result')
        if shots: await pg.screenshot(path=f'/home/claude/work/solfege/tests/{name}_fin.png')
        stored = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]').length")
        await b.close()
        return state, result, errs, stored

async def main():
    phone = {'width': 393, 'height': 852}
    st, res, errs, stored = await run('tel', SEQ, phone, 24)
    v = st['v'] if st else []
    print('A. page conforme :', sum(x == 'ok' for x in v), 'justes sur', len(v), '| terminé :', st and st['over'], '| fréquence', st and st['rate'], '| entendues', st and st['heard'])
    print('   résultat affiché :', res.replace('\n', ' / '), '| séances enregistrées :', stored, '| erreurs :', errs)
    alt = SEQ[:]; alt[5] = 'la' if alt[5] != 'la' else 'mi'; alt[20] = 'do' if alt[20] != 'do' else 'ré'
    st, res, errs, stored = await run('tel_faux', alt, phone, 24)
    v = st['v'] if st else []
    print('B. deux notes changées (cases 5 et 20) :', [(i, x) for i, x in enumerate(v) if x != 'ok'])
    print('   résultat affiché :', res.replace('\n', ' / '), '| erreurs :', errs)
    st, res, errs, stored = await run('mac', SEQ, {'width': 1512, 'height': 900}, 24)
    v = st['v'] if st else []
    print('C. grand écran :', sum(x == 'ok' for x in v), 'justes sur', len(v), '|', res.replace('\n', ' / '), '| erreurs :', errs)
asyncio.run(main())
