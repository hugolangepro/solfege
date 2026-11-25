"""Lecture d'intervalles de bout en bout, avec la série enregistrée par Hugo (hors dépôt) : la voix est apprise par import
d'un fichier dont la quatrième diction de chaque nom a été retirée du journal, puis l'enregistrement entier sert de micro."""
import asyncio, json, os
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SEQ = json.load(open(os.path.join(ICI, 'noms_seq.json')))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                '--use-file-for-fake-audio-capture=' + os.path.join(ICI, 'noms_48k.wav') + '%noloop', '--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
            await pg.goto(base + '?debug'); await pg.wait_for_timeout(700)
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(600)
            intro = (await pg.inner_text('#systems')).replace('\n', ' / ')
            await pg.screenshot(path=os.path.join(ICI, 'noms_intro.png'))
            await pg.set_input_files('#import', os.path.join(ICI, 'noms_3sur4.wav')); await pg.wait_for_timeout(2500)
            bilan = (await pg.inner_text('#systems')).replace('\n', ' / ')
            garde = await pg.evaluate("() => { const v = JSON.parse(localStorage.getItem('solfege.noms')); return [v.series.length, v.series[0].g.length, Math.round(v.loin * 100) / 100, localStorage.getItem('solfege.noms').length]; }")
            print('écran sans voix apprise :', intro[:60], '… | après import :', bilan, '| gardé [séries, exemples, plus grande distance, octets] :', garde)
            await pg.goto(base + '?debug&nm=' + ','.join(map(str, SEQ['st']))); await pg.wait_for_timeout(700)
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(8000)
            await pg.screenshot(path=os.path.join(ICI, 'noms_exo.png'))
            await pg.wait_for_timeout(106000)
            st = await pg.evaluate("() => { const s = window.__solfege.session; return { kind: s.kind, v: s.v.map(q => [q.st, q.v, q.cls + 1]), n: s.n, entendu: s.entendu, seuil: s.seuil, etat: s.etat }; }")
            v = st['v']; ess = [v[k] for k in SEQ['essais'] if k < len(v)]
            print('exercice :', st['kind'], '| intervalles présentés', len(v), 'sur', len(SEQ['st']), '| première réponse juste :', sum(q[1] == 'ok' for q in v), '| fausses :', [(q[0], q[2]) for q in v if q[1] != 'ok'])
            print('noms jamais appris (quatrième diction) :', sum(q[1] == 'ok' for q in ess), 'justes sur', len(ess), '| énoncés entendus', len(st['entendu']), 'dont écartés', sum(1 for e in st['entendu'] if not e[3]), [e[1:3] for e in st['entendu'] if not e[3]], '| seuil', round(st['seuil'], 2))
            d = sorted(e[2] for k, e in enumerate(st['entendu']) if e[3])
            print('distances des énoncés retenus : médiane', d[len(d) // 2], 'max', d[-1], '| ligne du bas :', repr(await pg.inner_text('#result')), '| erreurs :', errs)
            await pg.click('#regler'); await pg.wait_for_timeout(200)
            print('réglages :', await pg.evaluate("() => Array.from(document.querySelectorAll('#reglages .rang > span, #reglages > button')).map(s => s.textContent)"))
            await pg.screenshot(path=os.path.join(ICI, 'noms_reglages.png'))
            await b.close()
asyncio.run(main())
