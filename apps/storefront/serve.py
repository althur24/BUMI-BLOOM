"""Local dev server with clean-URL support: /admin -> /admin.html

Usage:  python serve.py            (serves http://127.0.0.1:8000)
Static hosts (GitHub Pages, Netlify) resolve extensionless URLs
natively; this script only mimics that behavior for local preview.
"""
import http.server
import os
import urllib.parse


class CleanURLHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        parsed = urllib.parse.urlsplit(self.path)
        fs_path = self.translate_path(parsed.path)
        if not os.path.isdir(fs_path) and not os.path.exists(fs_path):
            if os.path.exists(fs_path + ".html"):
                query = ("?" + parsed.query) if parsed.query else ""
                self.path = parsed.path + ".html" + query
        return super().send_head()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8000), CleanURLHandler)
    print("Serving on http://127.0.0.1:8000 (clean URLs enabled)")
    server.serve_forever()
