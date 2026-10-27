# gonk-auth

`gonk-auth` provides host-neutral authentication records for Gonk seams. It
has no runtime dependencies and uses the camelCase field names and function
names from the TypeScript `@gonk/auth` contract.

The public surface includes authenticated principals and identity validators,
authorization contexts, resource redaction, a versioned trusted-envelope JSON
codec, principal-derived security keys, and a single-owner context for
single-user hosts. An envelope is a transport record. Decoding it does not
authenticate its sender or create an authorization policy.

```python
from gonk.auth import ownerPrincipal, securityContextKey

auth = ownerPrincipal({"USER": "owner", "HOSTNAME": "host"})
key = securityContextKey({"principal": auth.principal})
```

Install the package in a Python 3.12 or newer environment:

```sh
python -m pip install ./python/auth
```
