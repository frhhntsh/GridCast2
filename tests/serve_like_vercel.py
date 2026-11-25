"""Serve public/ locally and apply the headers from vercel.json, so CSP problems show up before deploying."""
import http.server, json, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
rules = json.load(open(root / "vercel.json"))["headers"]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root / "public"), **k)
    def end_headers(self):
        for r in rules:
            if re.fullmatch(r["source"].replace("(.*)", ".*"), self.path.split("?")[0]):
                for h in r["headers"]: self.send_header(h["key"], h["value"])
        super().end_headers()
    def log_message(self, *a): pass
if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("", int(sys.argv[1]) if len(sys.argv) > 1 else 8702), H).serve_forever()
