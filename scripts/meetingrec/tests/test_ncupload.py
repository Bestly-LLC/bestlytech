import http.server, os, socket, sys, tempfile, threading, unittest, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ncupload  # noqa: E402


class FakeDav(http.server.BaseHTTPRequestHandler):
    """Just enough Nextcloud: files, chunked-upload dirs, MOVE .file. Class-level state; fail_chunk_once makes the first chunk-2 PUT die."""
    files, dirs, fail_once, moved = {}, set(), {"on": False}, []
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):
        self._send(200)

    def do_MKCOL(self):
        p = urllib.parse.unquote(self.path)
        if p in self.dirs:
            return self._send(405)
        self.dirs.add(p)
        self._send(201)

    def do_PUT(self):
        p = urllib.parse.unquote(self.path)
        data = self._body()
        if p.endswith("/00002") and self.fail_once["on"]:
            self.fail_once["on"] = False
            self.connection.shutdown(socket.SHUT_RDWR)      # the connection dies mid-upload, no answer
            self.close_connection = True
            return
        self.files[p] = data
        self._send(201)

    def do_PROPFIND(self):
        self._body()
        p = urllib.parse.unquote(self.path).rstrip("/")
        if self.headers.get("Depth") == "1":
            items = "".join(f"<d:response><d:href>{k}</d:href><d:propstat><d:prop><d:getcontentlength>{len(v)}</d:getcontentlength>"
                            f"</d:prop></d:propstat></d:response>" for k, v in self.files.items() if k.startswith(p + "/"))
            return self._send(207, f"<d:multistatus xmlns:d='DAV:'>{items}</d:multistatus>".encode())
        if p in self.files:
            return self._send(207, f"<d:multistatus xmlns:d='DAV:'><d:response><d:propstat><d:prop><d:getcontentlength>{len(self.files[p])}"
                                   f"</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>".encode())
        self._send(404)

    def do_MOVE(self):
        src = urllib.parse.unquote(self.path)
        dest = urllib.parse.unquote(urllib.parse.urlparse(self.headers["Destination"]).path)
        base = src.rsplit("/", 1)[0]
        parts = sorted(k for k in self.files if k.startswith(base + "/") and k.rsplit("/", 1)[1].isdigit())
        self.files[dest] = b"".join(self.files[k] for k in parts)
        self.moved.append(dest)
        self._send(201)


class UploadTests(unittest.TestCase):
    def setUp(self):
        FakeDav.files, FakeDav.dirs, FakeDav.moved = {}, set(), []
        FakeDav.fail_once["on"] = False
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeDav)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.routes = [("lan", "http", "127.0.0.1", self.srv.server_address[1], "cloud.bestly.tech")]
        self.tmp = tempfile.mkdtemp()
        ncupload.FAILS = os.path.join(self.tmp, "fails.json")
        ncupload.HOME = self.tmp
        self._chunk = dict(ncupload.CHUNK)
        ncupload.CHUNK["lan"] = 1000

    def tearDown(self):
        self.srv.shutdown()
        ncupload.CHUNK.update(self._chunk)

    def _file(self, n):
        p = os.path.join(self.tmp, "a.m4a")
        open(p, "wb").write(os.urandom(n))
        return p

    def test_chunked_upload_matches(self):
        ncupload.DIRECT_MAX = 100
        p = self._file(3500)
        ok, detail = ncupload.upload(p, "Meeting Recordings/2026-11-03/a.m4a", pw="x", routes=self.routes)
        self.assertTrue(ok, detail)
        self.assertEqual(FakeDav.files["/remote.php/dav/files/jared/Meeting%20Recordings/2026-11-03/a.m4a".replace("%20", " ")], open(p, "rb").read())

    def test_resume_after_dropped_chunk(self):
        ncupload.DIRECT_MAX = 100
        p = self._file(3500)
        FakeDav.fail_once["on"] = True
        ok, detail = ncupload.upload(p, "x/a.m4a", pw="x", routes=self.routes)
        self.assertTrue(ok, detail)                         # chunk 2 died once, was retried

    def test_small_file_direct(self):
        ncupload.DIRECT_MAX = 8 * 1024 * 1024
        p = self._file(500)
        ok, _ = ncupload.upload(p, "x/small.txt", pw="x", routes=self.routes)
        self.assertTrue(ok)
        self.assertEqual(FakeDav.moved, [])

    def test_failure_is_noted_then_cleared(self):
        ncupload.DIRECT_MAX = 100
        p = self._file(3500)
        dead = [("lan", "http", "127.0.0.1", 1, "cloud.bestly.tech")]
        ok, _ = ncupload.upload(p, "x/a.m4a", pw="x", routes=dead)
        self.assertFalse(ok)
        self.assertIn("x/a.m4a", ncupload._fails())
        ok, _ = ncupload.upload(p, "x/a.m4a", pw="x", routes=self.routes)
        self.assertTrue(ok)
        self.assertNotIn("x/a.m4a", ncupload._fails())


if __name__ == "__main__":
    unittest.main()
