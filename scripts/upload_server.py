import http.server, socketserver, json, sys, os
OUT = "/tmp/lm_upload.json"
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        with open(OUT, "wb") as f: f.write(body)
        self.send_response(200); self._cors(); self.send_header("Content-Type","application/json"); self.end_headers()
        self.wfile.write(b'{"ok":true}')
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8770), H) as s:
    s.serve_forever()
