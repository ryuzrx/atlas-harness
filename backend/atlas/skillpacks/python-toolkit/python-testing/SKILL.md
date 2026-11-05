---
name: python-testing
description: Write good pytest tests.
---

Use this to write good pytest tests.

## Steps
1. One behaviour per test, named `test_<what>_<expected>`.
2. Use fixtures for setup and `tmp_path` for files. Keep the scope as narrow as you can.
3. Use `@pytest.mark.parametrize` for many input and output cases.
4. Use `pytest.raises(Exc, match=...)` for errors.
5. Mock only at the boundaries (network, time, randomness) with `monkeypatch` or `unittest.mock`. Patch where the name is looked up.
6. Keep tests fast and isolated. Mark slow tests and run them separately.

## Output
The test file, plus the command to run it (for example `pytest -q path`).
