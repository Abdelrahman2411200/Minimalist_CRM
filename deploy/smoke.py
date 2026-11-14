#!/usr/bin/env python3
"""Verify HTTPS and, only with explicit test authorization, synthetic CRM writes."""
import argparse
import getpass
import http.cookiejar
import json
import os
import re
import ssl
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPSHandler, HTTPCookieProcessor, HTTPRedirectHandler, Request
import uuid


def validate_origin(origin):
    url = urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or url.username or url.password or
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", url.hostname) or url.port == 0 or
            url.path or url.query or url.fragment or origin != f"https://{url.netloc}"):
        raise RuntimeError("Use an exact HTTPS origin without credentials, path, query, or trailing slash.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def client(origin, ca_file=None):
    validate_origin(origin)
    context = ssl.create_default_context(cafile=ca_file)
    jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPSHandler(context=context), HTTPCookieProcessor(jar), NoRedirect())

    def request(path, method="GET", body=None):
        headers = {"Origin": origin, "Cache-Control": "no-cache"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = Request(origin + path, method=method, headers=headers, data=data)
        try:
            response = opener.open(req, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            return response.status, response.headers, json.loads(payload) if payload else None
    return request


def check_ready(origin, ca_file=None):
    status, _headers, body = client(origin, ca_file)("/ready")
    if status != 200 or body != {"status": "ready"}:
        raise RuntimeError("HTTPS readiness did not return the expected response.")


def verify(origin, ca_file=None, username=None, password=None, allow_write=False):
    check_ready(origin, ca_file)
    request = client(origin, ca_file)
    if request("/api/contacts")[0] != 401:
        raise RuntimeError("Anonymous record access must be rejected.")
    if not allow_write:
        print("Verified trusted HTTPS, readiness, and unauthenticated API protection.")
        return
    if not username or not password:
        raise RuntimeError("Supply an authorized test account through CRM_SMOKE_USERNAME and CRM_SMOKE_PASSWORD or the prompts.")
    status, headers, _body = request("/api/auth/login", "POST", {"username": username, "password": password})
    if status != 200:
        raise RuntimeError("Authorized test-account sign-in failed.")
    cookie = headers.get("Set-Cookie", "").lower()
    try:
        if not all(value in cookie for value in ("; secure", "; httponly", "samesite=lax")):
            raise RuntimeError("Production session cookie flags are incomplete.")
        if request("/api/auth/me")[0] != 200:
            raise RuntimeError("The HTTPS session was not accepted.")
        unique = uuid.uuid4().hex
        contact = {"firstName": "Deployment", "lastName": "Synthetic", "email": f"smoke-{unique}@example.test",
                   "company": "Synthetic deployment test", "leadSource": "Deployment smoke check",
                   "notes": "Fictional record created by an explicitly authorized test-environment verification."}
        status, _headers, created = request("/api/contacts", "POST", contact)
        if status != 201 or not isinstance(created, dict) or not created.get("data", {}).get("id"):
            raise RuntimeError("Synthetic contact creation failed.")
        contact_id = created["data"]["id"]
        uuid.UUID(contact_id)
        status, _headers, fetched = request("/api/contacts/" + contact_id)
        if status != 200 or any(fetched.get("data", {}).get(key) != value for key, value in contact.items()):
            raise RuntimeError("Synthetic contact readback did not match the saved fields.")
        print(json.dumps({"status": "verified", "https": True, "secure_session": True, "synthetic_contact_id": contact_id}))
    finally:
        request("/api/auth/logout", "POST")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--ca-file")
    parser.add_argument("--allow-synthetic-write", action="store_true", help="Use only against an authorized test environment")
    args = parser.parse_args()
    try:
        validate_origin(args.origin)
        username = os.getenv("CRM_SMOKE_USERNAME")
        password = os.getenv("CRM_SMOKE_PASSWORD")
        if args.allow_synthetic_write and sys.stdin.isatty():
            username = username or input("Authorized test username: ")
            password = password or getpass.getpass("Authorized test password: ")
        verify(args.origin, args.ca_file, username, password, args.allow_synthetic_write)
    except Exception:
        print("HTTPS smoke verification failed; check TLS, readiness, and the authorized test account. Credentials and response bodies are withheld.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
