from types import SimpleNamespace

from app.services.access import allowed_company_ids


class FakeQuery:
    def __init__(self, data):
        self._data = data

    def select(self, _columns):
        return self

    def eq(self, _field, _value):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class FakeClient:
    def __init__(self, data):
        self._data = data

    def from_(self, _table):
        return FakeQuery(self._data)


def test_admin_sees_all_companies():
    assert allowed_company_ids({"role": "admin", "id": "u1"}, FakeClient([])) is None


def test_contador_is_scoped_to_memberships():
    client = FakeClient([{"company_id": "c1"}, {"company_id": "c2"}])
    assert allowed_company_ids({"role": "contador", "id": "u1"}, client) == ["c1", "c2"]


def test_contador_without_membership():
    assert allowed_company_ids({"role": "contador", "id": "u1"}, FakeClient([])) == []
