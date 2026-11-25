"""Bout en bout : Chrome sans écran, un extrait de l'enregistrement de mesure sert de micro, l'app doit valider les notes.
L'extrait (tests/s13_48k.wav) n'est pas dans le dépôt : c'est la voix d'Hugo."""
import asyncio, base64, json, os, struct, subprocess, sys, urllib.parse
import numpy as np
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SEQ = open(os.path.join(ICI, 's13_seq.txt')).read().strip().split(',')
WAV = os.environ.get('SOLFEGE_WAV', os.path.join(ICI, 's13_48k.wav'))
BRUIT = os.path.join(ICI, 'clavier_44k.wav')          # frappe au clavier (ESC-50, pour l'essai seulement ; hors dépôt)
def args_for(wav):
    return ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            f'--use-file-for-fake-audio-capture={wav}%noloop', '--autoplay-policy=no-user-gesture-required']
ARGS = args_for(WAV)
DIAG_JS = '''async () => { const f = window.__solfege.diagFile(); if (!f) return null;
  const u = new Uint8Array(await f.arrayBuffer()); let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return { name: f.name, type: f.type, b64: btoa(s) }; }'''

WATCH_JS = '''() => { window.__log = [];
  const snap = () => { const s = window.__solfege.session; if (!s || !s.heard) return;
    const reds = Array.from(document.querySelectorAll('#systems path[data-n]')).filter(p => p.getAttribute('fill') === '#B3261E').map(p => +p.dataset.n);
    const cur = document.querySelector('#systems polygon');
    window.__log.push({ t: performance.now(), heard: s.heard.length, reds, texts: document.querySelectorAll('#systems text').length, ellipses: document.querySelectorAll('#systems ellipse').length }); };
  new MutationObserver(snap).observe(document.getElementById('systems'), { childList: true }); }'''

async def run(base, name, seq, viewport, wait_s, shots=True, debug=False, clef=None, wav=None, extra=''):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=args_for(wav) if wav else ARGS)
        ctx = await b.new_context(viewport=viewport, device_scale_factor=2, permissions=['microphone'])
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        await pg.goto(base + '?seq=' + urllib.parse.quote(','.join(seq)) + ('&debug' if debug else '') + extra)
        await pg.wait_for_timeout(800)
        if clef: await pg.click(f'#clef button[data-v="{clef}"]')
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_accueil.png'))
        await pg.evaluate(WATCH_JS)
        await pg.click('#go')
        await pg.wait_for_timeout(11000)
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_encours.png'))
        await pg.wait_for_timeout(int(wait_s * 1000) - 11000)
        state = await pg.evaluate('''() => { const s = window.__solfege.session; if (!s) return null;
            return { over: s.over, rate: s.rate, n: s.N, heard: s.heard.length, tStart: s.tStart, version: window.__solfege.VERSION,
                     raw: s.raw.length, bypass: s.bypass, gateOff: window.__solfege.gateOff, stored: localStorage.getItem('solfege.gate'),
                     v: window.__solfege.verdicts().map(q => q ? q.v + (q.v === 'faux' ? ':' + q.cls : '') : null) }; }''')
        result = await pg.inner_text('#result')
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_fin.png'))
        stored = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]')")
        diag = await pg.evaluate(DIAG_JS) if debug else None
        share_visible = await pg.is_visible('#share')
        log = await pg.evaluate('() => window.__log')
        heard = await pg.evaluate("() => window.__solfege.session ? window.__solfege.session.heard.map(c => [c.cls, +c.conf.toFixed(2), Math.round(c.time * 1000), Math.round(c.delay * 1000), c.early ? 1 : 0]) : []")
        await b.close()
        return state, result, errs, stored, diag, share_visible, log, heard

def lire_diag(raw):
    assert raw[:4] == b'RIFF' and raw[8:12] == b'WAVE', 'en-tête'
    assert struct.unpack('<I', raw[4:8])[0] == len(raw) - 8, 'taille RIFF'
    pos, blocs = 12, {}
    while pos + 8 <= len(raw):
        n = struct.unpack('<I', raw[pos + 4:pos + 8])[0]
        blocs[raw[pos:pos + 4]] = raw[pos + 8:pos + 8 + n]; pos += 8 + n + (n & 1)
    assert pos == len(raw), 'blocs mal alignés'
    return struct.unpack('<HHIIHH', blocs[b'fmt '][:16]), np.frombuffer(blocs[b'data'], '<i2'), json.loads(blocs[b'sLFG'].decode('utf-8'))

async def service_worker(base, proc):
    """Le service worker prend la page en charge, puis la page s'ouvre encore quand le serveur est éteint."""
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=ARGS)
        pg = await (await b.new_context(viewport={'width': 393, 'height': 852})).new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(base); await pg.wait_for_timeout(2500)
        await pg.reload(); await pg.wait_for_timeout(1500)
        pris = await pg.evaluate("() => !!navigator.serviceWorker.controller")
        portee = await pg.evaluate("async () => (await navigator.serviceWorker.getRegistration()).scope")
        proc.terminate(); proc.wait()
        await pg.reload(); await pg.wait_for_timeout(1500)
        titre = await pg.inner_text('h1')
        modele = await pg.evaluate("() => fetch('model.json').then(r => r.ok && r.json()).then(j => j && j.version).catch(e => 'échec : ' + e.message)")
        msg = await pg.inner_text('#msg')
        await pg.goto(base + '?input=midi'); await pg.wait_for_timeout(800)
        await pg.click('#go'); await pg.wait_for_timeout(300)
        n = await pg.evaluate("() => window.__solfege.session && window.__solfege.session.notes.length")
        await b.close()
        return pris, portee, titre, modele, msg, n, errs

async def main():
    phone = {'width': 393, 'height': 852}
    with serveur() as (base, proc):
        st, res, errs, stored, diag, share, log, heard = await run(base, 'tel', SEQ, phone, 24)
        v = st['v'] if st else []
        print('A. page conforme :', sum(x == 'ok' for x in v), 'justes sur', len(v), '| terminé :', st and st['over'], '| version', st and st['version'], '| entendues', st and st['heard'])
        print('   résultat affiché :', res.replace('\n', ' / '), '| partage visible hors diagnostic :', share, '| erreurs :', errs)
        r = stored[-1]
        print('   séance gardée :', {k: r[k] for k in ('id', 'fmt', 'app', 'mode', 'input', 'n', 'ok', 'faux', 'manque', 'dur', 'rate', 'acc')}, '| notes[:3] =', r['notes'][:3], '| octets :', len(json.dumps(r, separators=(',', ':'))))

        alt = SEQ[:]; alt[5] = 'la' if alt[5] != 'la' else 'mi'; alt[20] = 'do' if alt[20] != 'do' else 'ré'
        st, res, errs, stored, diag, share, log, heard = await run(base, 'tel_faux', alt, phone, 24)
        v = st['v'] if st else []
        print('B. deux notes changées (cases 5 et 20) :', [(i, x) for i, x in enumerate(v) if x != 'ok'], '|', res.replace('\n', ' / '), '| erreurs :', errs)
        # à quel moment chaque fausse note est-elle passée au rouge : dès sa propre syllabe, ou seulement à la suivante ?
        for j in (5, 20):
            first = next((e for e in log if j in e['reds']), None)
            # rang de la syllabe dite pour la note j : la j-ième des syllabes retenues par l'alignement, soit celle qui porte l'instant de la note
            idx = next((i for i, h in enumerate(heard) if h[2] == stored[-1]['notes'][j][4] + round(st['tStart'] * 1000)), None)
            print('   note %d : rouge affiché quand %s syllabes étaient entendues ; sa propre syllabe est la n° %s ; son écoulé avant reconnaissance : %s ms' % (
                j, first and first['heard'], idx is not None and idx + 1, idx is not None and heard[idx][3]))
        print('   textes sous les notes : %d ; cercles : %d ; syllabes reconnues sans attendre le sommet : %d sur %d' % (
            max(e['texts'] for e in log), max(e['ellipses'] for e in log), sum(h[4] for h in heard), len(heard)))

        st, res, errs, stored, diag, share, log, heard = await run(base, 'mac', SEQ, {'width': 1512, 'height': 900}, 24)
        v = st['v'] if st else []
        print('C. grand écran :', sum(x == 'ok' for x in v), 'justes sur', len(v), '|', res.replace('\n', ' / '), '| erreurs :', errs)

        st, res, errs, stored, diag, share, log, heard = await run(base, 'diag', SEQ, phone, 24, shots=False, debug=True)
        raw = base64.b64decode(diag['b64'])
        chemin = os.path.join(ICI, 'diag_test.wav'); open(chemin, 'wb').write(raw)
        fmt, pcm, meta = lire_diag(raw)
        print('D. fichier de diagnostic :', diag['name'], diag['type'], len(raw), 'octets | fmt', fmt, '| durée', round(len(pcm) / 16000, 1), 's | niveau efficace', round(float(np.sqrt(np.mean((pcm / 32768.0) ** 2))), 4), '| bouton de partage visible :', share)
        print('   compte rendu :', {k: meta[k] for k in ('app', 'modele', 'installee', 'rate', 'micro', 'tronque', 'mode')})
        print('   attendu conforme :', meta['attendu'] == SEQ[:32], '| entendues :', len(meta['entendu']), '| verdicts justes :', sum(x == 'ok' for x in meta['verdicts']))
        rejeu = subprocess.run(['node', os.path.join(ICI, 'diag.mjs'), chemin], capture_output=True, text=True)
        print('   rejeu hors navigateur :', (rejeu.stdout.strip().splitlines() or [rejeu.stderr.strip()])[-1])
        ff = subprocess.run(['ffmpeg', '-v', 'error', '-i', chemin, '-f', 'null', '-'], capture_output=True, text=True)
        print('   lisible par ffmpeg :', ff.returncode == 0 and not ff.stderr.strip())

        st, res, errs, stored, diag, share, log, heard = await run(base, 'piano', SEQ, phone, 19, clef='deux')
        v = st['v'] if st else []
        r = stored[-1]
        print('F. système de piano à la voix :', sum(x == 'ok' for x in v), 'justes sur', len(v), '|', res.replace('\n', ' / '), '| mode gardé :', r['mode'], '| clés des 8 premières notes :', [q[0] for q in r['notes'][:8]], '| erreurs :', errs)

        if os.path.exists(BRUIT):
            for nom, extra in (('filtre actif', ''), ('filtre retiré', '&tau=0')):
                st, res, errs, stored, diag, share, log, heard = await run(base, 'bruit', SEQ, phone, 26, shots=False, wav=BRUIT, extra=extra)
                v = st['v'] if st else []
                print('G. 30 s de frappe au clavier, sans un mot, %s : %d notes validées, %d fausses, %d syllabes entendues (%d par le modèle seul) ; notes passées au rouge en cours de page : %d | erreurs : %s' % (
                    nom, sum(x == 'ok' for x in v), sum(bool(x) and x.startswith('faux') for x in v), st['heard'], st['raw'], len({j for e in log for j in e['reds']}), errs))
        st, res, errs, stored, diag, share, log, heard = await run(base, 'secours', SEQ, phone, 24, shots=False, extra='&tau=1.1')
        v = st['v'] if st else []
        print('H. filtre qui écarterait toute la voix (seuil forcé à 1,1) :', sum(x == 'ok' for x in v), 'justes sur', len(v), '|', res.replace('\n', ' / '), '| filtre coupé :', st['bypass'], '| mémorisé :', st['stored'], '| erreurs :', errs)

        pris, portee, titre, modele, msg, n, errs = await service_worker(base, proc)
        print('E. service worker : page prise en charge', pris, '| portée', portee.replace(base, '…/solfege/'), '| serveur éteint → titre', repr(titre), '| modèle version', modele, '| message', repr(msg), '| page de', n, 'notes | erreurs :', errs)
asyncio.run(main())
