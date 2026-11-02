#!/usr/bin/env python3
"""Built TUI acceptance on disposable Unix PTYs; run after pnpm build."""
import fcntl
import json
import os
from pathlib import Path
import pty
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
    def __init__(self, directory, port, size=(30, 100)):
        self.directory, self.port = directory, port
        self.master, self.slave = pty.openpty()
        self.original = termios.tcgetattr(self.slave)
        self.resize(*size, notify=False)
        env = {k: v for k, v in os.environ.items() if not k.startswith("LARNESS_")}
        env.update(TERM="xterm-256color", NO_COLOR="1", LARNESS_DATA_DIR=str(directory))
        self.proc = subprocess.Popen([NODE, "app.js"], cwd=ROOT, env=env,
                                     stdin=self.slave, stdout=self.slave, stderr=self.slave,
                                     start_new_session=True)
        self.data = b""

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
        raise AssertionError(f"Timed out waiting for {text!r}; last frame: {self.read()[-1800:]!r}")

    def send(self, value):
        start = len(self.data.decode("utf-8", errors="replace"))
        os.write(self.master, value)
        return start

    def initialize(self):
        self.wait("修改高级网络设置")
        start = self.send(b"n\r")
        self.wait("确认写入配置", start)
        start = self.send(b"y\r")
        self.wait("控制面板", start)

    def finish(self, expected=0):
        deadline = time.monotonic() + 20
        while self.proc.poll() is None and time.monotonic() < deadline:
            self.read()
        assert self.proc.poll() == expected, f"Unexpected exit: {self.proc.poll()}, output={self.read()[-800:]!r}"
        output = self.read()
        assert "\x1b[?1049h" in output and "\x1b[?1049l" in output
        mask = termios.ECHO | termios.ICANON | termios.ISIG
        assert termios.tcgetattr(self.slave)[3] & mask == self.original[3] & mask, "TTY mode was not restored"
        assert not (self.directory / "larness.lock").exists()
        assert not (self.directory / "ipc/token").exists()
        with socket.socket() as sock:
            assert sock.connect_ex(("127.0.0.1", self.port)) != 0, "Server still listening"

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


def main():
    with tempfile.TemporaryDirectory(prefix="larness-tui-pty-") as temp:
        root = Path(temp)
        non_tty = root / "non-tty"
        env = {**os.environ, "LARNESS_DATA_DIR": str(non_tty), "TERM": "xterm"}
        result = subprocess.run([NODE, "app.js"], cwd=ROOT, env=env, capture_output=True, timeout=10)
        assert result.returncode != 0 and b"TTY" in result.stderr
        assert not non_tty.exists(), "Non-TTY invocation started the server"
        print("PASS non-TTY rejected before child startup")

        for mode in ["normal", "ctrl-c", "sigterm", "startup-sigterm", "startup-failure"]:
            directory = root / mode
            directory.mkdir()
            port = free_port()
            config(directory, port)
            blocker = None
            if mode in ["startup-failure", "startup-sigterm"]:
                blocker = socket.socket()
                blocker.bind(("127.0.0.1", port))
                blocker.listen()
            session = Session(directory, port)
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
                    if mode == "normal":
                        start = session.send(b"q")
                        session.wait("退出确认", start)
                        start = session.send(b"\r")
                        session.wait("控制面板", start)
                        start = len(session.read())
                        session.resize(16, 60)
                        session.wait("终端空间不足", start)
                        start = len(session.read())
                        session.resize(24, 80)
                        session.wait("控制面板", start)
                        start = session.send(b"q")
                        session.wait("退出确认", start)
                        session.send(b"\x1b[B\r")
                    elif mode == "ctrl-c":
                        session.send(b"\x03")
                    else:
                        os.kill(session.proc.pid, signal.SIGTERM)
                    session.finish()
                print(f"PASS {mode}: real TTY mode/screen restored; children, lock and IPC released")
            finally:
                if blocker is not None:
                    blocker.close()
                session.close()


if __name__ == "__main__":
    main()
