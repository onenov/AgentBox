# AgentManager

## Login URL Parameters

The client login page supports passing temporary access credentials through the URL. These parameters are consumed once and immediately removed from the address bar with `history.replaceState`.

Supported credential parameters:

```text
/login?credential=anex:...
/login?anex=...
/login?token=xxx
/login?authToken=xxx
/login?accessToken=xxx
```

Supported backend address parameters for plain tokens:

```text
/login?token=xxx&apiUrl=https://example.com
/login?token=xxx&backendAddress=https://example.com
/login?token=xxx&backend=https://example.com
```

Supported persistence parameters:

```text
/login?token=xxx&persistence=session
/login?token=xxx&persist=false
/login?token=xxx&remember=false
/login?token=xxx&autoLogin=0
```

Rules:

- `credential` can contain a full `anex:...` credential or a plain token.
- `anex` can contain either `anex:...` or the credential payload without the `anex:` prefix.
- `token`, `authToken`, and `accessToken` are treated as plain backend tokens.
- `apiUrl`, `backendAddress`, or `backend` are used only when the credential itself does not include a backend address.
- URL credentials default to persistent login. Use `persistence=session`, `persist=false`, `remember=false`, or `autoLogin=0` for session-only login.
- `redirect` is preserved and still controls the post-login destination when it is a safe internal path.
- Sensitive login parameters must be removed from the URL before validation or navigation continues.
