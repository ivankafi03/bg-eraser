import http.server
import socketserver
import os

PORT = 3000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Serve with Cross-Origin Isolation headers for SharedArrayBuffer support in Web Workers
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # CORS headers
        self.send_header("Access-Control-Allow-Origin", "*")
        # Disable caching for local development assets (prevent stale service worker/app.js)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

def run():
    # Make sure we serve from the directory of this script
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Allow port reuse to avoid 'Address already in use' errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        print(f"============================================================")
        print(f" DECONE ERASER LOCAL SERVER STARTED")
        print(f" Serving at: http://localhost:{PORT}")
        print(f" Cross-Origin Isolation headers (COOP/COEP) are ACTIVE")
        print(f"============================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    run()
