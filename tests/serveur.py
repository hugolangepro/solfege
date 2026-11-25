"""Sert le dépôt sous /solfege/, comme GitHub Pages, le temps d'un test."""
import contextlib, os, socket, subprocess, sys, tempfile, time

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

@contextlib.contextmanager
def serveur():
    with tempfile.TemporaryDirectory() as tmp:
        os.symlink(RACINE, os.path.join(tmp, 'solfege'))
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        p = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', tmp],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                with socket.socket() as s:
                    if s.connect_ex(('127.0.0.1', port)) == 0: break
                time.sleep(0.1)
            yield f'http://localhost:{port}/solfege/', p
        finally:
            p.terminate()
