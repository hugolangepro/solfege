"""Chant de bout en bout : Chrome sans écran, une voix de synthèse sert de micro et chante les notes demandées.
Puis les réglages ouverts depuis l'exercice, et l'écran d'enregistrement des noms d'intervalles."""
import asyncio, base64, json, os, struct
import numpy as np
from scipy.io import wavfile
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SR = 48000
hz = lambda m: 440 * 2 ** ((m - 69) / 12)

def voice(dur, f, scoop=-150, vib=15):
    t = np.arange(int(dur * SR)) / SR
    fi = f * 2 ** ((scoop * np.exp(-t / 0.06) + vib * np.sin(2 * np.pi * 5.5 * t)) / 1200)
    ph = 2 * np.pi * np.cumsum(fi) / SR
    env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.03)
    return env * 0.2 * (np.sin(ph) + 0.6 * np.sin(2 * ph) + 0.4 * np.sin(3 * ph) + 0.2 * np.sin(5 * ph)) / 2.2

def wav(nom, notes, dur):
    """notes : (instant, durée, numéro MIDI chanté)"""
    x = np.random.default_rng(0).standard_normal(int(dur * SR)) * 0.0005
    for t, d, m in notes:
        seg = voice(d, hz(m)); i = int(t * SR); x[i:i + len(seg)] += seg
    chemin = os.path.join(ICI, nom); wavfile.write(chemin, SR, np.clip(x * 32767, -32768, 32767).astype(np.int16))
    return chemin

async def page(p, base, chemin, extra='', prefs=None):
    b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        f'--use-file-for-fake-audio-capture={chemin}%noloop', '--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
    if prefs: await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps(prefs)))
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(base + '?debug' + extra); await pg.wait_for_timeout(700)
    return b, pg, errs

ETAT = "() => { const s = window.__solfege.session; return s && { exo: s.exo, phase: s.phase, j: s.j, n: s.n, pause: s.pause, titre: s.it && s.it.titre, sous: s.it && s.it.sous, cibles: s.it && s.it.cibles, res: s.results, tenue: s.hold && s.hold.holdMs, etat: window.__solfege.son && window.__solfege.son.ctx.state }; }"
shot = lambda pg, nom: pg.screenshot(path=os.path.join(ICI, nom))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            # 1. Intervalles, note de départ chantée. Au deuxième, la voix tient d'abord un ton trop bas.
            w = wav('chant_iv.wav', [(2.0, 1.4, 48), (3.6, 1.4, 55), (6.9, 1.0, 58), (8.1, 1.4, 60), (9.7, 1.4, 56)], 14)
            b, pg, errs = await page(p, base, w, '&iv=48:55,60:56')
            await shot(pg, 'accueil.png')
            await pg.click('#liste button[data-exo="intervalles"]'); await pg.wait_for_timeout(900)
            e0 = await pg.evaluate(ETAT); await shot(pg, 'iv_ecoute.png')
            await pg.wait_for_timeout(2300)            # ≈ 3,3 s : la note de départ est tenue, la quinte reste à chanter
            e1 = await pg.evaluate(ETAT); await shot(pg, 'iv_vise.png')
            await pg.wait_for_timeout(4500)            # ≈ 7,8 s : deuxième intervalle, la voix tient un ton trop bas
            e2 = await pg.evaluate(ETAT); await shot(pg, 'iv_faux.png')
            await pg.wait_for_timeout(3300)            # ≈ 11,1 s
            e3 = await pg.evaluate(ETAT); bas = await pg.inner_text('#result')
            await pg.wait_for_timeout(1500); e4 = await pg.evaluate(ETAT)
            print('1. Intervalles :', e0['titre'], e0['sous'], e0['cibles'], '| au début', e0['phase'], '| à 3,3 s : note', e1['j'], e1['phase'], '| à 7,8 s (ton trop bas tenu) :', e2['titre'], e2['sous'], 'note', e2['j'], 'trouvés', e2['n'])
            print('   à 11 s : trouvés', e3['n'], '| écarts (cents)', [r['cents'] for r in e3['res']], '| temps (ms)', [r['ms'] for r in e3['res']], '| ligne du bas', repr(bas), '| ensuite, sans rien toucher :', e4['titre'], e4['sous'], e4['phase'], '| erreurs :', errs)
            await pg.click('#quit'); await pg.wait_for_timeout(200)
            st = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]').pop()")
            print('   séance gardée :', {k: st[k] for k in ('mode', 'input', 'n', 'tol', 'tenue')}, st['items'][:2], '| son fermé :', await pg.evaluate("() => window.__solfege.son === null"))
            await b.close()

            # 2. Accords : D mineur 7, quatre notes de bas en haut.
            w = wav('chant_ac.wav', [(2.0, 1.4, 50), (3.6, 1.4, 53), (5.2, 1.4, 57), (6.8, 1.4, 60)], 11)
            b, pg, errs = await page(p, base, w, '&ac=m7@2')
            await pg.click('#liste button[data-exo="accords"]'); await pg.wait_for_timeout(4300)
            e1 = await pg.evaluate(ETAT); await shot(pg, 'ac_vise.png')
            pastilles = await pg.evaluate("() => Array.from(document.querySelectorAll('#systems circle[data-c]')).map(c => c.getAttribute('fill'))")
            await pg.wait_for_timeout(4300); e2 = await pg.evaluate(ETAT)
            print('2. Accords :', e1['titre'], e1['cibles'], '| à 4,3 s : note', e1['j'], '| pastilles', pastilles, '| à 8,6 s : trouvés', e2['n'], '| écarts', [r['cents'] for r in e2['res']], '| ensuite', e2['titre'], '| erreurs :', errs)
            await b.close()

            # 3. Portée : fa puis la bémol, chantés une octave plus bas.
            w = wav('chant_pt.wav', [(2.0, 1.4, 53), (3.6, 1.4, 56)], 8)
            b, pg, errs = await page(p, base, w, '&pt=1:3:-1')
            await pg.click('#liste button[data-exo="portee"]'); await pg.wait_for_timeout(900); await shot(pg, 'pt_ecoute.png')
            await pg.wait_for_timeout(2400); e1 = await pg.evaluate(ETAT); await shot(pg, 'pt_vise.png')
            dessin = await pg.evaluate("() => [document.querySelectorAll('#systems path[data-c]').length, document.querySelectorAll('#systems polygon').length, document.querySelectorAll('#systems text').length]")
            await pg.wait_for_timeout(2500); e2 = await pg.evaluate(ETAT)
            print('3. Portée : cibles', e1['cibles'], '| à 3,3 s : note', e1['j'], '| têtes de note, repères, textes :', dessin, '| à 5,8 s : trouvés', e2['n'], '| écarts', [r['cents'] for r in e2['res']], '| erreurs :', errs)
            await b.close()

            # 4. Réglages, ouverts depuis l'exercice : pause, changement d'exercice, paramètres, étendue.
            w = wav('silence.wav', [], 30)
            b, pg, errs = await page(p, base, w)
            await pg.click('#liste button[data-exo="intervalles"]'); await pg.wait_for_timeout(1800)
            await pg.click('#regler'); await pg.wait_for_timeout(200)
            e1 = await pg.evaluate(ETAT); await shot(pg, 'reglages_intervalles.png')
            for v in ('1', '6', '10', '11'): await pg.click(f'#reglages button[data-k="intervalles.iv"][data-v="{v}"]')
            await pg.click('#reglages button[data-k="intervalles"][data-v="descendant"]')
            await pg.click('#reglages button[data-k="intervalles"][data-v="montant"]')      # refusé : il reste toujours un sens
            await pg.click('#reglages button[data-k="exo"][data-v="accords"]'); await pg.wait_for_timeout(100)
            await shot(pg, 'reglages_accords.png')
            for v in ('aug', 'dim', 'mMaj7'): await pg.click(f'#reglages button[data-k="accords.types"][data-v="{v}"]')
            await pg.click('#reglages button[data-k="accords.notation"][data-v="signes"]')
            await pg.click('#reglages button[data-k="tenue"][data-v="1"]')
            await pg.click('#fermer'); await pg.wait_for_timeout(1200)
            e2 = await pg.evaluate(ETAT); pr = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.prefs'))")
            print('4. Réglages : exercice en pause', e1['pause'], '| après fermeture :', e2['exo'], e2['titre'], 'tenue', e2['tenue'], 'ms, contexte audio', e2['etat'])
            print('   gardé : intervalles', pr['intervalles'], '| accords', pr['accords'], '| tenue', pr['tenue'])
            await pg.click('#regler'); await pg.click('#fermer'); await pg.wait_for_timeout(300)
            e3 = await pg.evaluate(ETAT)
            print('   ouverts puis fermés sans rien changer : même exercice', e3['titre'] == e2['titre'], '| phase', e3['phase'], '| pause', e3['pause'])
            await pg.click('#regler')
            await pg.click('#reglages button[data-k="exo"][data-v="notes"]')
            await pg.click('#reglages button[data-k="notes.clef"][data-v="deux"]')
            for k, v, n in (('sol.0', '-1', 3), ('sol.1', '1', 4), ('fa.0', '-1', 4), ('fa.1', '-1', 2)):
                for _ in range(n): await pg.click(f'#reglages button[data-k="{k}"][data-v="{v}"]')
            await shot(pg, 'reglages_notes.png')
            await pg.click('#fermer'); await pg.wait_for_timeout(900)
            e4 = await pg.evaluate("() => { const s = window.__solfege.session; return { kind: s.kind, clefs: s.clefs, et: s.et, min: Math.min(...s.notes.filter(n => n.clef === 'fa').map(n => n.p)), max: Math.max(...s.notes.filter(n => n.clef === 'sol').map(n => n.p)), svg: document.querySelectorAll('#systems svg').length }; }")
            await shot(pg, 'notes_etendue.png')
            print('   vers Lecture · Notes :', e4, '| erreurs :', errs)
            await b.close()

            # 5. Lecture d'intervalles : une série enregistrée (cadence accélérée pour le test).
            b, pg, errs = await page(p, base, w, '&periode=60')
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(500); await shot(pg, 'noms_intro.png')
            await pg.click('#systems button[data-e="go"]'); await pg.wait_for_timeout(1500); await shot(pg, 'noms_dire.png')
            await pg.wait_for_timeout(2600)
            fin = await pg.inner_text('#systems')
            f = await pg.evaluate('''async () => { const f = window.__solfege.session.fichier; const u = new Uint8Array(await f.arrayBuffer()); let s = '';
                for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return { name: f.name, b64: btoa(s) }; }''')
            raw = base64.b64decode(f['b64']); pos, blocs = 12, {}
            while pos + 8 <= len(raw):
                n = struct.unpack('<I', raw[pos + 4:pos + 8])[0]; blocs[raw[pos:pos + 4]] = raw[pos + 8:pos + 8 + n]; pos += 8 + n + (n & 1)
            meta = json.loads(blocs[b'sLFG'].decode('utf-8')); noms = [q[1] for q in meta['phrases']]
            print('5. Enregistrement :', repr(fin.replace('\n', ' / ')), '|', f['name'], len(raw), 'octets, son', round(len(blocs[b'data']) / 32000, 1), 's |', len(noms), 'noms,', len(set(noms)), 'différents, chacun', sorted({noms.count(q) for q in noms}), 'fois | instants croissants :', all(a[0] <= c[0] for a, c in zip(meta['phrases'], meta['phrases'][1:])), '| exemples', meta['phrases'][:2], '| erreurs :', errs)
            await b.close()
asyncio.run(main())
