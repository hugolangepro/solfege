"""Lecture de notes au toucher (clavier à l'écran, sans micro), et son des séances à la voix gardé sur l'appareil."""
import asyncio, json, os
from playwright.async_api import async_playwright
from serveur import serveur
import e2e

ICI = os.path.dirname(os.path.abspath(__file__))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2)
            await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps({'notes': {'clef': 'deux', 'input': 'touches', 'sol': [-2, 10], 'fa': [-2, 10]}})))
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(base); await pg.wait_for_timeout(500)
            await pg.click('#liste button[data-exo="notes"]'); await pg.wait_for_timeout(400)
            etat = await pg.evaluate("() => ({ input: window.__solfege.session.input, son: window.__solfege.son, clavier: !document.getElementById('clavier').hidden, micro: !document.getElementById('mic').hidden, bas: Math.round(document.getElementById('clavier').getBoundingClientRect().bottom), haut: Math.round(document.getElementById('clavier').getBoundingClientRect().top), portees: Math.round(document.getElementById('systems').getBoundingClientRect().bottom), ecran: innerHeight })")
            for i in range(30):
                cls = await pg.evaluate('(i) => window.__solfege.session.notes[i].cls', i)
                await pg.click(f'#clavier [data-t="{(cls + 1) % 7 if i == 4 else cls}"]', position={'x': 20, 'y': 100})
                await pg.wait_for_timeout(60)
            await pg.screenshot(path=os.path.join(ICI, 'touches.png'))
            for i in range(30, 36):
                cls = await pg.evaluate('(i) => window.__solfege.session.notes[i].cls', i)
                await pg.keyboard.press('asdfghj'[cls])
            v = await pg.evaluate("() => window.__solfege.verdicts().map(q => q.v)")
            bas = await pg.inner_text('#result')
            await pg.click('#regler'); await pg.wait_for_timeout(150)
            rep = await pg.evaluate("() => Array.from(document.querySelectorAll('#reglages [data-k=\"notes.input\"]')).map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '+' : ''))")
            son = await pg.evaluate("() => !!document.getElementById('sons')")
            await pg.click('#fermer'); await pg.click('#quit'); await pg.wait_for_timeout(200)
            st = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions')).pop()")
            print('au toucher :', etat, '| 30 touchers + 6 touches du clavier :', sum(x == 'ok' for x in v), 'justes, fausses', [i for i, x in enumerate(v) if x != 'ok'], '| ligne', repr(bas), '| réponses proposées', rep, '| réglage du son absent au toucher :', not son, '| séance', {k: st[k] for k in ('input', 'n', 'ok', 'faux')}, st['notes'][4], '| erreurs', errs)
            await b.close()
        # son des séances : lecture à la voix (enregistrement de mesure comme micro), morceaux de 20 s pour le test
        st, res, errs, stored, diag, accueil, log, heard = await e2e.run(base, 'garde', e2e.SEQ, {'width': 393, 'height': 852}, 26, shots=False, extra='&morceau=10')
        print('lecture à la voix, morceaux de 10 s :', sum(x == 'ok' for x in st['v'][:32]), 'justes sur 32 | morceaux gardés [fin du nom, durée s, début s, notes attendues, syllabes entendues] :', e2e.SONS, '| erreurs', errs)
asyncio.run(main())
