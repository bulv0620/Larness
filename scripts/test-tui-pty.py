#!/usr/bin/env python3
"""Built TUI acceptance on disposable Unix PTYs; run after pnpm build."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import urllib.request
import select
import signal
import socket
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("LARNESS_TEST_NODE", "node")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def config(directory, port):
    value = {"version": 1,
             "server": {"host": "127.0.0.1", "port": port, "publicUrl": None, "trustedProxies": []},
             "auth": {"sessionTtlMinutes": 720, "idleTtlMinutes": 30, "requireHttpsForRemote": True},
             "webauthn": {"rpId": "localhost", "rpName": "Larness", "origin": f"http://localhost:{port}"},
             "logging": {"level": "info", "retentionDays": 14},
             "updates": {"channel": "stable", "autoCheck": True, "autoInstall": False},
             "preview": {"enabled": False}}
    (directory / "config.json").write_text(json.dumps(value))


class Session:
    def __init__(self, directory, port, size=(30, 100), term="xterm-256color", dev=False):
        self.directory, self.port = directory, port
        self.master, self.slave = pty.openpty()
        self.original = termios.tcgetattr(self.slave)
        self.resize(*size, notify=False)
        env = {k: v for k, v in os.environ.items() if not k.startswith("LARNESS_")}
        env.update(TERM=term, NO_COLOR="1", LARNESS_DATA_DIR=str(directory))
        self.cache_directory = tempfile.TemporaryDirectory(prefix="larness-pty-cache-", dir="/tmp") if dev else None
        self.cache_root = Path(self.cache_directory.name) if self.cache_directory else directory / "temporary"
        if dev:
            env["TMPDIR"] = str(self.cache_root)
        command = [NODE, "app.js"]
        if dev:
            loader = subprocess.check_output([NODE, "--input-type=module", "-e", "import {createRequire} from 'node:module';console.log(createRequire(process.cwd()+'/apps/server/package.json').resolve('tsx/esm'))"], cwd=ROOT, text=True).strip()
            command = [NODE, "--import", loader, str(ROOT / "apps/server/src/tui/main.ts"), "--managed", "--dev"]
        self.proc = subprocess.Popen(command, cwd=ROOT, env=env,
                                     stdin=self.slave, stdout=self.slave, stderr=self.slave,
                                     start_new_session=True)
        self.data = b""
        self.children = []

    def resize(self, rows, columns, notify=True):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        if notify:
            os.kill(self.proc.pid, signal.SIGWINCH)

    def read(self, timeout=0.1):
        if select.select([self.master], [], [], timeout)[0]:
            try:
                self.data += os.read(self.master, 65536)
            except OSError:
                pass
        return self.data.decode("utf-8", errors="replace")

    def wait(self, text, after=0, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            output = self.read()
            if text in output[after:]:
                return output
            if self.proc.poll() is not None:
                raise AssertionError(f"TUI exited {self.proc.returncode} while waiting for {text!r}")
        raise AssertionError(f"Timed out waiting for {text!r}; terminal diagnostic withheld to protect pairing data")

    def send(self, value):
        start = len(self.data.decode("utf-8", errors="replace"))
        os.write(self.master, value)
        return start

    def initialize(self):
        self.wait("修改高级网络设置")
        start = self.send(b"n\r")
        self.wait("确认写入配置", start)
        start = self.send(b"y\r")
        self.wait("Larness · 控制面板", start)
        self.children = self.managed_children()

    def managed_children(self):
        rows = subprocess.check_output(["ps", "-axo", "pid=,ppid=,command="], text=True).splitlines()
        return [(int(parts[0]), parts[2]) for row in rows if len(parts := row.strip().split(None, 2)) == 3 and int(parts[1]) == self.proc.pid]

    def record(self, name):
        destination = os.environ.get("LARNESS_TUI_RECORD_DIR")
        if destination:
            # Called only on non-secret overview/log/audit/size frames.
            frame = self.read().split("\x1b[2J")[-1]
            frame = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", frame).replace("\r", "")
            target = Path(destination)
            target.mkdir(parents=True, exist_ok=True)
            (target / f"{name}.txt").write_text(frame)

    def finish(self, expected=0, screen=True):
        deadline = time.monotonic() + 20
        while self.proc.poll() is None and time.monotonic() < deadline:
            self.read()
        assert self.proc.poll() == expected, f"Unexpected exit: {self.proc.poll()}; terminal output withheld"
        output = self.read()
        if screen:
            assert "\x1b[?1049h" in output and "\x1b[?1049l" in output
        else:
            assert "\x1b[?1049h" not in output
        mask = termios.ECHO | termios.ICANON | termios.ISIG
        assert termios.tcgetattr(self.slave)[3] & mask == self.original[3] & mask, "TTY mode was not restored"
        assert not (self.directory / "larness.lock").exists()
        assert not (self.directory / "ipc/token").exists()
        with socket.socket() as sock:
            assert sock.connect_ex(("127.0.0.1", self.port)) != 0, "Server still listening"
        assert not list(self.cache_root.glob("larness-vite-cache-*")), "Managed Vite cache remains after shutdown"
        for pid, _command in self.children:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            raise AssertionError("Managed child still alive after TUI exit")

    def close(self):
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait()
        os.close(self.master)
        os.close(self.slave)
        if self.cache_directory:
            self.cache_directory.cleanup()


def main():
    with tempfile.TemporaryDirectory(prefix="larness-tui-pty-") as temp:
        root = Path(temp)
        non_tty = root / "non-tty"
        env = {**os.environ, "LARNESS_DATA_DIR": str(non_tty), "TERM": "xterm"}
        result = subprocess.run([NODE, "app.js"], cwd=ROOT, env=env, capture_output=True, timeout=10)
        assert result.returncode != 0 and b"TTY" in result.stderr
        assert not non_tty.exists(), "Non-TTY invocation started the server"
        print("PASS non-TTY rejected before child startup")

        dumb = root / "dumb"
        session = Session(dumb, free_port(), term="dumb")
        try:
            session.finish(expected=1, screen=False)
            assert not dumb.exists(), "TERM=dumb invocation started the server"
            print("PASS TERM=dumb rejected on a real TTY before child startup")
        finally:
            session.close()

        for mode in ["normal", "dev-normal", "dev-web-failure", "dev-web-killed", "dev-sigterm", "pairing", "reading", "reconnect-failure", "ctrl-c", "sigterm", "sighup", "startup-sigterm", "startup-failure"]:
            directory = root / mode
            directory.mkdir()
            port = free_port()
            config(directory, port)
            blocker = None
            if mode in ["startup-failure", "startup-sigterm"]:
                blocker = socket.socket()
                blocker.bind(("127.0.0.1", port))
                blocker.listen()
            session = Session(directory, port, dev=mode.startswith("dev-"))
            try:
                if mode == "startup-sigterm":
                    session.wait("启动")
                    os.kill(session.proc.pid, signal.SIGTERM)
                    blocker.close()
                    blocker = None
                    session.finish()
                elif mode == "startup-failure":
                    # Close the blocker before checking that our child is gone.
                    end = time.monotonic() + 15
                    while session.proc.poll() is None and time.monotonic() < end:
                        session.read()
                    blocker.close()
                    blocker = None
                    session.finish(expected=1)
                else:
                    session.initialize()
                    if mode == "pairing":
                        def post(route, value):
                            request = urllib.request.Request(f"http://localhost:{port}{route}", data=json.dumps(value).encode(), headers={"Content-Type": "application/json", "Origin": f"http://localhost:{port}"})
                            with urllib.request.urlopen(request, timeout=5) as response:
                                return json.load(response)
                        application = post("/api/pairing/requests", {"clientLabel": "PTY test browser"})
                        start = session.send(b"p")
                        session.wait("PTY test browser", start)
                        start = session.send(b"\r")
                        session.wait("配对操作", start)
                        start = session.send(b"\r")
                        session.wait("批准确认", start)
                        start = session.send(b"\r")
                        session.wait("配对操作", start)
                        start = session.send(b"\r")
                        session.wait("批准确认", start)
                        start = session.send(b"\x1b[B\r\r")
                        output = session.wait("仅显示本次", start)
                        match = re.search(r"    ([A-Z0-9]{5}-[A-Z0-9]{5})", output[start:])
                        assert match is not None, "Pairing code was not in the dedicated page"
                        test_code = match.group(1)
                        # Temporary isolated instance only; never print the test code/token.
                        post("/api/pairing/redeem", {"requestId": application["requestId"], "code": test_code})
                        start = session.send(b"\x1b")
                        output = session.wait("待审批配对", start)
                        assert test_code not in output[start:], "Code leaked onto the list page"
                        start = session.send(b"\x1b")
                        session.wait("Larness · 控制面板", start)
                        start = session.send(b"q")
                        session.wait("退出确认", start)
                        session.send(b"\x1b[B\r")
                    elif mode == "reading":
                        session.record("overview-100x30")
                        log = directory / "logs/larness.log"
                        with log.open("a") as stream:
                            stream.write("\n".join(f"PTY-log-{i:03d} 中文长日志 " + "可阅读😀" * 20 for i in range(220)) + "\n")
                        start = session.send(b"l")
                        session.wait("PTY-log-219", start)
                        session.record("logs-100x30")
                        start = session.send(b"\x1b[H")
                        session.wait("PTY-log-020", start)
                        with log.open("a") as stream:
                            stream.write("PTY-new-after-snapshot\n")
                        start = session.send(b"\x1b[C")
                        session.wait("日志 · 子进程", start)
                        start = session.send(b"\x1b[D")
                        output = session.wait("PTY-log-020", start)
                        assert "PTY-new-after-snapshot" not in output[start:]
                        start = session.send(b"\x1b[F")
                        session.wait("PTY-log-219", start)
                        start = session.send(b"r")
                        session.wait("PTY-new-after-snapshot", start)
                        start = session.send(b"\x1b")
                        output = session.wait("Larness · 控制面板", start)
                        assert "PTY-log-" not in output[start:]
                        start = session.send(b"a")
                        session.wait("auth.init", start)
                        session.record("audit-100x30")
                        start = len(session.read())
                        session.resize(24, 80)
                        session.wait("Larness · 审计", start)
                        session.record("audit-80x24")
                        start = len(session.read())
                        session.resize(16, 60)
                        session.wait("终端空间不足", start)
                        session.record("small-60x16")
                        start = session.send(b"\x1b")
                        session.wait("终端空间不足", start)
                        start = len(session.read())
                        session.resize(24, 80)
                        session.wait("Larness · 控制面板", start)
                        session.record("overview-80x24")
                        start = session.send(b"l")
                        session.wait("PTY-new-after-snapshot", start)
                        session.record("logs-80x24")
                        session.send(b"\x03")
                    elif mode == "reconnect-failure":
                        # Target only the server PID owned by this temporary instance.
                        record = json.loads((directory / "larness.lock").read_text())
                        os.kill(record["pid"], signal.SIGTERM)
                        end = time.monotonic() + 10
                        while (directory / "ipc/token").exists() and time.monotonic() < end:
                            session.read()
                        start = session.send(b"r")
                        session.wait("重新连接", start)
                    elif mode in ["dev-web-failure", "dev-web-killed"]:
                        wrappers = [pid for pid, command in session.children if "managed-vite.ts" in command]
                        assert len(wrappers) == 1
                        os.kill(wrappers[0], signal.SIGKILL if mode == "dev-web-killed" else signal.SIGTERM)
                    elif mode in ["normal", "dev-normal"]:
                        start = session.send(b"q")
                        session.wait("退出确认", start)
                        start = session.send(b"\r")
                        session.wait("Larness · 控制面板", start)
                        start = len(session.read())
                        session.resize(16, 60)
                        session.wait("终端空间不足", start)
                        start = len(session.read())
                        session.resize(24, 80)
                        session.wait("Larness · 控制面板", start)
                        start = session.send(b"q")
                        session.wait("退出确认", start)
                        session.send(b"\x1b[B\r")
                    elif mode == "ctrl-c":
                        session.send(b"\x03")
                    else:
                        os.kill(session.proc.pid, signal.SIGHUP if mode == "sighup" else signal.SIGTERM)
                    session.finish(expected=1 if mode in ["reconnect-failure", "dev-web-failure", "dev-web-killed"] else 0)
                print(f"PASS {mode}: real TTY mode/screen restored; children, lock and IPC released")
            finally:
                if blocker is not None:
                    blocker.close()
                session.close()


if __name__ == "__main__":
    main()
