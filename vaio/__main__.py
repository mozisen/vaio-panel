import argparse
import getpass
import os
from pathlib import Path
from werkzeug.security import generate_password_hash
from .store import Store


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Vaio Panel 管理工具")
    parser.add_argument("command", choices=["init", "serve"])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    if args.command == "init":
        password = getpass.getpass("管理员密码（至少 12 位）: ")
        if len(password) < 12 or password != getpass.getpass("再次输入: "):
            raise SystemExit("密码过短或两次不一致")
        path = os.environ.get("VAIO_DATABASE", str(Path(__file__).resolve().parent.parent / "data/panel.sqlite"))
        store = Store(path)
        with store.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES('password',?)", (generate_password_hash(password, method="pbkdf2:sha256:600000"),))
            db.execute("DELETE FROM sessions")
        print("管理员密码已设置，所有旧登录会话已失效。")
    else:
        from .server import create_app
        create_app().run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
