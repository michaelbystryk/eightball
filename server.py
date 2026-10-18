"""Local dev server. Unknown paths (e.g. /c3) fall back to index.html so secret-code links work."""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # never cache: the modules change together, and a stale one breaks the app
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path):
            self.path = '/index.html'
        return super().send_head()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # the page preloads ~20 files at once; the default backlog (5) drops some


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
print(f'Serving on http://localhost:{port}')
# this machine only: it serves the whole repo folder
Server(('127.0.0.1', port), Handler).serve_forever()
