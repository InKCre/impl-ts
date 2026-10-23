"""Run the real extension against a disposable DB/PostgREST on the declared SSH runtime.

Run with impl-py's PDM environment; --runtime identifies its existing runtime directory.
Only a new database, a new container, and a private SSH forward are created/removed.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

import psycopg
from psycopg import sql
from sqlalchemy import URL


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--runtime", type=Path, required=True)
  parser.add_argument("--headed", action="store_true")
  parser.add_argument("--grep")
  parser.add_argument("--firefox-ssh", help="Use installed Firefox on this SSH host instead of local Playwright")
  args = parser.parse_args()
  if not (Path.cwd() / "migrations" / "versions").is_dir():
    raise RuntimeError("Run this experiment from the impl-py repository")
  sys.path.insert(0, str(Path.cwd()))
  runtime = json.loads((args.runtime / "runtime.json").read_text())
  credentials = json.loads((args.runtime / "credential.json").read_text())
  provider = runtime["provider"]
  if provider["kind"] != "ssh":
    raise RuntimeError("This experiment requires the declared SSH database runtime")
  ts_root = Path(__file__).resolve().parents[2]
  token = uuid4().hex
  name = "inkcre_test_webext_" + token
  container = "inkcre-test-webext-" + token
  peer_jwt_secret = secrets.token_hex(32)
  admin_info = dict(host="127.0.0.1", port=runtime["local_ports"]["postgres"], user="postgres", password=credentials["POSTGRES_PASSWORD"], dbname="postgres")
  ssh = ["ssh", "-T", "-o", "BatchMode=yes", provider["target"]]
  def docker(*arguments):
    command = shlex.join([provider["docker_bin"], *arguments])
    result = subprocess.run([*ssh, command], capture_output=True, text=True, check=False)
    if result.returncode:
      raise RuntimeError("Test Docker operation failed: " + arguments[0])
    return result.stdout.strip()
  forward = None
  firefox_forward = None
  firefox_directory = None
  created_container = False
  with psycopg.connect(**admin_info, autocommit=True) as admin:
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
  try:
    url = URL.create("postgresql+psycopg", username="postgres", password=credentials["POSTGRES_PASSWORD"], host="127.0.0.1", port=admin_info["port"], database=name).render_as_string(hide_password=False)
    migrated = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env={**os.environ, "MIGRATION_DATABASE_URL": url, "INKCRE_ENV_FILE": ""}, capture_output=True, text=True)
    if migrated.returncode:
      raise RuntimeError("Disposable migration failed: " + migrated.stderr)
    from app.database_contract.catalog import reconcile_builtins
    reconcile_builtins(url)
    with psycopg.connect(**{**admin_info, "dbname": name}) as connection:
      connection.execute("GRANT USAGE ON SCHEMA inkcre TO authenticated")
      connection.execute("GRANT ALL ON ALL TABLES IN SCHEMA inkcre TO authenticated")
      connection.execute("GRANT ALL ON ALL SEQUENCES IN SCHEMA inkcre TO authenticated")
      connection.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inkcre TO authenticated")
    postgres = runtime["project"] + "-postgres-1"
    networks = json.loads(docker("inspect", postgres, "--format", "{{json .NetworkSettings.Networks}}"))
    network = next(iter(networks))
    database_uri = f"postgresql://authenticator:{quote(credentials['POSTGREST_DATABASE_PASSWORD'], safe='')}@{postgres}:5432/{name}"
    payload = {"docker": provider["docker_bin"], "args": ["run", "-d", "--name", container, "--network", network, "-p", "127.0.0.1::3000",
      "--env", "PGRST_DB_URI=" + database_uri, "--env", "PGRST_DB_SCHEMAS=inkcre", "--env", "PGRST_DB_ANON_ROLE=anonymous",
      "--env", "PGRST_JWT_SECRET=" + peer_jwt_secret, "--env", "PGRST_JWT_AUD=inkcre-api", "postgrest/postgrest:v14.15"]}
    remote = "import json,subprocess,sys; p=json.load(sys.stdin); r=subprocess.run([p['docker'],*p['args']],capture_output=True,text=True); print(r.stdout.strip() if r.returncode==0 else 'PostgREST test container failed'); sys.exit(r.returncode)"
    started = subprocess.run([*ssh, "python3 -c " + shlex.quote(remote)], input=json.dumps(payload), capture_output=True, text=True)
    if started.returncode: raise RuntimeError("Disposable PostgREST could not start")
    created_container = True
    remote_port = int(docker("port", container, "3000/tcp").rsplit(":", 1)[1])
    with socket.socket() as probe:
      probe.bind(("127.0.0.1", 0))
      local_port = probe.getsockname()[1]
    forward = subprocess.Popen(["ssh", "-N", "-T", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-L", f"127.0.0.1:{local_port}:127.0.0.1:{remote_port}", provider["target"]], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    endpoint = f"http://127.0.0.1:{local_port}"
    for _ in range(50):
      try:
        urlopen(endpoint, timeout=1).close()
        break
      except Exception as error:
        if getattr(error, "code", None): break
        time.sleep(.2)
    print("Disposable extension acceptance endpoint:", endpoint, flush=True)
    if args.firefox_ssh:
      firefox_ssh = ["ssh", "-T", "-o", "BatchMode=yes", args.firefox_ssh]
      firefox_directory = subprocess.check_output([*firefox_ssh, "mktemp -d /tmp/inkcre-webext-acceptance.XXXXXX"], text=True).strip()
      if not firefox_directory.startswith("/tmp/inkcre-webext-acceptance.") or "/" in firefox_directory.removeprefix("/tmp/inkcre-webext-acceptance."):
        raise RuntimeError("Unexpected Firefox test directory")
      subprocess.run(["scp", "-qr", str(ts_root / "apps/client-webext/.output/firefox-mv3"), str(Path(__file__).with_name("verify_firefox.mjs")), args.firefox_ssh + ":" + firefox_directory + "/"], check=True)
      port = int(subprocess.check_output([*firefox_ssh, "python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'"], text=True))
      firefox_forward = subprocess.Popen([*firefox_ssh[:-1], "-S", "none", "-N", "-o", "ExitOnForwardFailure=yes", "-R", f"127.0.0.1:{port}:127.0.0.1:{local_port}", args.firefox_ssh], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
      time.sleep(.5)
      if firefox_forward.poll() is not None: raise RuntimeError("Firefox test forward failed")
      remote_command = shlex.join(["node", firefox_directory + "/verify_firefox.mjs", firefox_directory + "/firefox-mv3", "--database"])
      result = subprocess.run([*firefox_ssh, remote_command], input=json.dumps({"endpoint": f"http://127.0.0.1:{port}", "secret": peer_jwt_secret}), text=True)
    else:
      test_args = ["pnpm", "exec", "playwright", "test", "--project", "browser-extension"]
      if args.headed: test_args.append("--headed")
      if args.grep: test_args.extend(["--grep", args.grep])
      result = subprocess.run(test_args, cwd=ts_root, env={**os.environ, "INKCRE_E2E_WEBEXT_PGREST": endpoint, "INKCRE_E2E_WEBEXT_JWT_SECRET": peer_jwt_secret})
    return result.returncode
  finally:
    if firefox_forward:
      firefox_forward.terminate()
      firefox_forward.wait(timeout=5)
    if firefox_directory:
      cleaned = subprocess.run(["ssh", "-T", "-o", "BatchMode=yes", args.firefox_ssh, "rm -r -- " + shlex.quote(firefox_directory)], check=False)
      if cleaned.returncode: print("Firefox test directory needs cleanup:", firefox_directory, file=sys.stderr)
    if forward:
      forward.terminate()
      forward.wait(timeout=5)
    if created_container: docker("rm", "-f", container)
    with psycopg.connect(**admin_info, autocommit=True) as admin:
      admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
    print("Removed disposable extension database, container and SSH forward.", flush=True)


if __name__ == "__main__":
  raise SystemExit(main())
