"""
Django Test Manager - N+1 Query Detection Runner

Works with sequential AND parallel test execution.

Approach (simple, no parallel-runner hacking):
  - Monkeypatches TransactionTestCase._pre_setup / _post_teardown
    at module import time.  Since parallel workers fork() from the
    main process, the monkeypatch is inherited automatically.
  - Uses connection.execute_wrappers to intercept SQL at cursor level.
  - Writes results as JSONL to DTM_OUTPUT_FILE (atomic line-append).
"""

from django.test import TransactionTestCase
import os
import sys
import re
import json
import threading
from collections import Counter

from django.db import connections
from django.test.runner import DiscoverRunner

# ── Config from env vars ────────────────────────────────────────
_OUTPUT_FILE = os.environ.get("DTM_OUTPUT_FILE", "")
_NPLUSONE_THRESHOLD = int(
    os.environ.get("DTM_NPLUSONE_THRESHOLD", "3")
)

# ── Thread-local query bag ──────────────────────────────────────
_tls = threading.local()


class _QueryInterceptor:
    """Database execute_wrapper that records SQL statements."""

    def __call__(self, execute, sql, params, many, context):
        bag = getattr(_tls, "queries", None)
        if bag is not None:
            bag.append(str(sql))
        return execute(sql, params, many, context)


_interceptor = _QueryInterceptor()


def _install_interceptor():
    """Add interceptor to every DB connection (idempotent)."""
    for alias in connections:
        conn = connections[alias]
        if _interceptor not in conn.execute_wrappers:
            conn.execute_wrappers.append(_interceptor)


def _begin_test():
    """Start collecting queries."""
    _install_interceptor()
    _tls.queries = []


def _end_test(test_id):
    """Stop collecting, analyse, write results."""
    raw = getattr(_tls, "queries", None) or []
    _tls.queries = None

    count = len(raw)
    warnings = []

    if raw:
        normalized = []
        for sql in raw:
            norm = re.sub(r"'[^']*'", "'?'", sql)
            norm = re.sub(r"\b\d+\b", "?", norm)
            normalized.append(norm)

        for pattern, n in Counter(normalized).most_common():
            if n >= _NPLUSONE_THRESHOLD:
                clean = (
                    pattern.replace("\n", " ")
                    .replace("\r", "")[:300]
                )
                warnings.append({"count": n, "sql": clean})

    # stderr markers (best-effort)
    try:
        sys.stderr.write(
            f"[DTM:QUERIES] {test_id}: {count}\n"
        )
        for w in warnings:
            sys.stderr.write(
                f"[DTM:NPLUSONE] {test_id}"
                f" | {w['count']} | {w['sql']}\n"
            )
        sys.stderr.flush()
    except Exception:
        pass

    # JSONL file (primary channel, parallel-safe)
    if _OUTPUT_FILE:
        try:
            line = json.dumps(
                {test_id: {
                    "count": count,
                    "nplusone": warnings,
                }}
            ) + "\n"
            with open(_OUTPUT_FILE, "a") as f:
                f.write(line)
        except Exception:
            pass


# ── Monkeypatch TestCase lifecycle ──────────────────────────────
# _pre_setup  runs BEFORE setUp() in every test
# _post_teardown runs AFTER tearDown() in every test
# Both run in the actual worker process (inherited via fork).


_orig_pre_setup = TransactionTestCase._pre_setup
_orig_post_teardown = TransactionTestCase._post_teardown


def _dtm_pre_setup(self):
    _orig_pre_setup(self)
    _begin_test()


def _dtm_post_teardown(self):
    test_id = (
        f"{self.__class__.__module__}."
        f"{self.__class__.__name__}."
        f"{self._testMethodName}"
    )
    _end_test(test_id)
    _orig_post_teardown(self)


TransactionTestCase._pre_setup = _dtm_pre_setup
TransactionTestCase._post_teardown = _dtm_post_teardown


# ── Runner class (minimal — just an entry point) ────────────────

class DTMQueryCountingRunner(DiscoverRunner):
    """
    Drop-in replacement for DiscoverRunner.
    All the real work is done by the monkeypatch above.

    Usage (injected by the VS Code extension):
        manage.py test --testrunner \
            dtm_query_counter.DTMQueryCountingRunner
    """
    pass
