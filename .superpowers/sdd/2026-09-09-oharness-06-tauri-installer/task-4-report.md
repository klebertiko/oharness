# Task 4 report — Keychain wire-up

## Done

- `backend/secrets/keychain.py` — `KeychainSecrets` with injectable `KeyringBackend`.
- `backend/secrets/factory.py` — `build_secrets_store()` for
  `OH_SECRETS=keychain|file|memory` (aliases: keyring/os, mem).
- `backend/main.py` lifespan uses factory (default `memory`).
- `keyring` optional — commented in `requirements.txt`; ImportError if selected
  without install.
- Unit tests with `FakeKeyring`; integration test skipped when keyring absent.

## Verify

```text
cd backend && python -m pytest tests/test_keychain_secrets.py tests/test_secrets_store.py -q
→ 14 passed, 1 skipped
```

## HITL

`pip install keyring` + `OH_SECRETS=keychain` for live OS credential store.
