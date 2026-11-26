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
            # la voix livrée avec l'app suffit : l'exercice démarre sans rien enregistrer
            await pg.goto(base + '?debug&nm=' + ','.join(map(str, SEQ['st']))); await pg.wait_for_timeout(700)
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(46000)
            st = await pg.evaluate("() => { const s = window.__solfege.session; return { kind: s.kind, ex: s.voix.ex.length, v: s.v.map(q => [q.st, q.v, q.cls + 1]), entendu: s.entendu, seuil: s.seuil }; }")
            v = st['v']
            print('lecture d\'intervalles sans rien enregistrer :', st['kind'], '|', st['ex'], 'exemples livrés | en 46 s :', len(v), 'intervalles, première réponse juste :', sum(q[1] == 'ok' for q in v), '| fausses :', [(q[0], q[2]) for q in v if q[1] != 'ok'], '| énoncés écartés :', [e[1:3] for e in st['entendu'] if not e[3]], '| seuil', round(st['seuil'], 2), '| erreurs :', errs)
            # une série de plus, par import : elle s'ajoute à la voix livrée
            await pg.click('#regler'); await pg.wait_for_timeout(200)
            await pg.click('#reglages button[data-a="serie"]'); await pg.wait_for_timeout(700)
            await pg.set_input_files('#import', os.path.join(ICI, 'noms_3sur4.wav')); await pg.wait_for_timeout(6000)
            print('série importée en plus :', (await pg.inner_text('#systems')).replace('\n', ' / '), '| erreurs :', errs)
            await b.close()
asyncio.run(main())
