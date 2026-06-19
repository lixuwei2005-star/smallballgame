"""Local dev static server that sends no-store headers so edited ES modules are
always refetched (Python's stock http.server sends no cache headers, which lets
browsers keep stale modules between edits). Dev-only — production is served by
nginx (see deploy/nginx-shuimu.conf); not part of the game or deploy package.

Usage: python tools/devserver.py [port] [directory]
"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8011
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "."


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


# Threaded so the browser's parallel ES-module requests don't block each other
# (the stock single-threaded server wedges when several modules load at once).
http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
    httpd.serve_forever()
