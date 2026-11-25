"""Chant d'intervalles de bout en bout : Chrome sans écran, une voix de synthèse sert de micro et chante les notes demandées."""
import asyncio, json, os
import numpy as np
from scipy.io import wavfile
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SR, P = 48000, 3.2
SEMIS = [0, 2, 4, 5, 7, 9, 11]
def midi_of(p): d = p + 2; return 60 + 12 * (d // 7) + SEMIS[d % 7]
hz = lambda m: 440 * 2 ** ((m - 69) / 12)

def voice(dur, f, scoop=-150, vib=15):
    t = np.arange(int(dur * SR)) / SR
    fi = f * 2 ** ((scoop * np.exp(-t / 0.06) + vib * np.sin(2 * np.pi * 5.5 * t)) / 1200)
    ph = 2 * np.pi * np.cumsum(fi) / SR
    env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.03)
    return env * 0.2 * (np.sin(ph) + 0.6 * np.sin(2 * ph) + 0.4 * np.sin(3 * ph) + 0.2 * np.sin(5 * ph)) / 2.2

# cinq intervalles ; la voix chante une octave sous la note écrite ; au deuxième, elle chante d'abord une note fausse
ITEMS = [(-2, 0), (0, 4), (5, -2), (3, 2), (1, 4)]
x = np.random.default_rng(0).standard_normal(int((len(ITEMS) * P + 3) * SR)) * 0.0005
def put(t, seg): i = int(t * SR); x[i:i + len(seg)] += seg
for k, (a, b) in enumerate(ITEMS):
    f = hz(midi_of(b) - 12)
    if k == 1:
        put(k * P + 1.7, voice(0.8, hz(midi_of(b) - 12 - 2)))          # un ton trop bas, tenu : ne doit pas compter
        put(k * P + 2.6, voice(1.0, f))
    else:
        put(k * P + 1.7, voice(1.0, f))
WAV = os.path.join(ICI, 'chant_48k.wav')
wavfile.write(WAV, SR, np.clip(x * 32767, -32768, 32767).astype(np.int16))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                f'--use-file-for-fake-audio-capture={WAV}%noloop', '--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
            # accueil : le choix « Chant » montre les niveaux et cache les clés
            await pg.goto(base); await pg.wait_for_timeout(600)
            await pg.click('#exo button[data-v="chant"]'); await pg.wait_for_timeout(100)
            vis = await pg.evaluate("() => ['clef', 'niveau', 'input'].map(id => !document.getElementById(id).hidden)")
            print('accueil, Chant choisi : clés visibles', vis[0], '| niveaux visibles', vis[1], '| message :', await pg.inner_text('#msg'))
            await pg.screenshot(path=os.path.join(ICI, 'chant_accueil.png'))
            await pg.goto(base + '?debug&exo=chant&items=' + ','.join(f'{a}:{b}' for a, b in ITEMS)); await pg.wait_for_timeout(600)
            await pg.click('#go')
            await pg.wait_for_timeout(700)
            ph0 = await pg.evaluate("() => [window.__solfege.session.phase, document.getElementById('ref').getAttribute('fill')]")
            await pg.wait_for_timeout(1250)
            await pg.screenshot(path=os.path.join(ICI, 'chant_vise.png'))
            await pg.wait_for_timeout(250)
            ph1 = await pg.evaluate("() => [window.__solfege.session.phase, document.getElementById('trace').getAttribute('d').length, document.getElementById('debug').textContent]")
            await pg.wait_for_timeout(3300)
            await pg.screenshot(path=os.path.join(ICI, 'chant_faux.png'))        # deuxième intervalle : la voix tient un ton trop bas
            await pg.wait_for_timeout(int((len(ITEMS) * P + 1.5) * 1000) - 5500)
            st = await pg.evaluate("() => { const s = window.__solfege.session; return s && { over: s.over, i: s.i, results: s.results, n: s.N }; }")
            res = await pg.inner_text('#result')
            saved = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]').slice(-1)[0]")
            await pg.screenshot(path=os.path.join(ICI, 'chant_fin.png'))
            diag = await pg.evaluate("async () => { const f = window.__solfege.diagFile(); return f ? [f.name, f.size] : null; }")
            print('pendant la référence :', ph0, '| pendant la recherche :', ph1[0], ', courbe tracée (%d caractères)' % ph1[1])
            print('   diagnostic à l\'écran :', ph1[2])
            print('séance terminée :', st and st['over'], '|', len(st['results']), 'intervalles trouvés sur', st['n'])
            for r, (a, bb) in zip(st['results'], ITEMS):
                print('   %2d → %2d : trouvé en %4d ms, écart médian %+d cents, référence captée par le micro %.3f' % (r['ref'], r['cible'], r['ms'], r['cents'], r['refRms']))
            print('résultat affiché :', res.replace('\n', ' / '), '| séance gardée :', {k: saved[k] for k in ('mode', 'input', 'niveau', 'n', 'ok', 'tol', 'tenue')}, saved['items'][:2], '| fichier de diagnostic :', diag, '| erreurs :', errs)
            # réécoute : toucher la portée pendant la recherche rejoue la référence
            pg2 = await ctx.new_page()
            await pg2.goto(base + '?exo=chant&items=-2:0'); await pg2.wait_for_timeout(500); await pg2.click('#go'); await pg2.wait_for_timeout(1500)
            a0 = await pg2.evaluate("() => window.__solfege.session.phase"); await pg2.click('#systems'); await pg2.wait_for_timeout(100)
            a1 = await pg2.evaluate("() => [window.__solfege.session.phase, window.__solfege.session.replays]")
            await pg2.click('#quit'); await pg2.wait_for_timeout(200)
            home = await pg2.evaluate("() => !document.getElementById('home').hidden")
            print('réécoute : phase', a0, '→ toucher la portée →', a1, '| quitter sans rien chanter ramène à l\'accueil :', home)
            await b.close()
asyncio.run(main())
