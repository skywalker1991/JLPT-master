"""Who may call what.

The one mistake that matters most here is silent: a route added without a
session check still works, and nobody notices that it answers strangers too.
So every route is walked, and each must require a signed-in user — or an
admin, for the admin pages — unless it is one of the few that exist to let
someone sign in.
"""
from fastapi.routing import APIRoute

from app.api.deps import current_user, require_admin
from app.main import app
from app.services import auth_service as auth

# Reachable without a session: signing in, and saying whether sign-up is open.
PUBLIC = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/signup"),
    ("GET", "/api/auth/config"),
}

# Changing the bank, or reading the queue of reports against it.
ADMIN_ONLY_EXAM = {
    ("PATCH", "/api/exam/items/{item_id}"),
    ("PATCH", "/api/exam/problems/{problem_id}"),
    ("GET", "/api/exam/items/{item_id}/revisions"),
    ("GET", "/api/exam/reports"),
    ("POST", "/api/exam/reports/{report_id}/resolve"),
    ("PATCH", "/api/jlpt/papers/{paper_id}"),     # opening a paper to learners
}


def _calls(dependant) -> set:
    found = {dependant.call}
    for sub in dependant.dependencies:
        found |= _calls(sub)
    return found


def _api_routes():
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api"):
            for method in route.methods:
                yield method, route.path, _calls(route.dependant)


def test_every_route_but_signing_in_needs_a_session():
    open_routes = [
        (m, p) for m, p, calls in _api_routes()
        if (m, p) not in PUBLIC and current_user not in calls
    ]
    assert open_routes == []


def test_admin_pages_need_an_admin():
    lax = [
        (m, p) for m, p, calls in _api_routes()
        if (p.startswith("/api/admin/") or (m, p) in ADMIN_ONLY_EXAM) and require_admin not in calls
    ]
    assert lax == []


def test_the_admin_only_exam_routes_still_exist():
    """If one is renamed, the list above would quietly stop guarding it."""
    present = {(m, p) for m, p, _ in _api_routes()}
    assert ADMIN_ONLY_EXAM <= present


def test_a_password_checks_against_its_own_hash_only():
    stored = auth.hash_password("correct horse")
    assert auth.verify_password("correct horse", stored)
    assert not auth.verify_password("correct horsE", stored)
    assert stored != auth.hash_password("correct horse")  # salted


def test_a_malformed_hash_is_a_failed_check_not_a_crash():
    assert not auth.verify_password("anything", "")
    assert not auth.verify_password("anything", "bcrypt$whatever")
    assert not auth.verify_password("anything", "scrypt$1$2$3$not-base64$x")


def test_short_passwords_are_refused():
    assert auth.password_problem("1234567") is not None
    assert auth.password_problem("12345678") is None


def test_guessing_is_cut_off_per_address_and_per_account():
    ip, email = "203.0.113.9", "someone@example.test"
    auth.clear_login_failures(ip, email)
    for _ in range(10):
        assert not auth.login_blocked(ip, email)
        auth.record_login_failure(ip, email)
    assert auth.login_blocked(ip, email)
    # A different address is still blocked from this account…
    assert auth.login_blocked("198.51.100.1", email)
    # …and this address is blocked from other accounts.
    assert auth.login_blocked(ip, "other@example.test")
    auth.clear_login_failures(ip, email)
    auth.clear_login_failures("198.51.100.1", email)
    auth.clear_login_failures(ip, "other@example.test")


def test_email_is_compared_case_and_space_insensitively():
    assert auth.normalize_email("  Dai@Example.COM ") == "dai@example.com"


def test_invite_codes_are_typeable_and_read_back_however_typed():
    from app.api.auth import new_code, normalize_code
    code = new_code()
    assert len(code) == 9 and code[4] == "-"
    assert not set(code.replace("-", "")) & set("01ILO")  # nothing to misread
    assert normalize_code(code.lower().replace("-", " ")) == code
    assert normalize_code(" k7q3m9xa ") == "K7Q3-M9XA"


def test_learners_see_only_open_papers():
    from types import SimpleNamespace as NS
    from app.api.deps import sees_paper
    learner, admin = NS(role="user"), NS(role="admin")
    open_, closed = NS(is_open=True), NS(is_open=False)
    assert sees_paper(learner, open_) and not sees_paper(learner, closed)
    assert sees_paper(admin, closed)
