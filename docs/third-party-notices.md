# Third-party notices

MyFinances bundles or calls the following third-party material.

## Common-password list (SecLists)

- **File:** `server/data/common-passwords.txt`, bundled unmodified. The server
  rejects any new password on this list (issue #456).
- **Source:** [danielmiessler/SecLists](https://github.com/danielmiessler/SecLists),
  `Passwords/Common-Credentials/10k-most-common.txt` at commit
  `68bcd12457978649d41ae4f56e3b5d2db2b72560`.
- **SHA-256:** `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`
- **Licence:** MIT

```
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Have I Been Pwned — Pwned Passwords API

- **Used by:** the optional breached-password check
  (`SECURITY_CHECK_BREACHED_PASSWORDS`, off by default; issue #456).
- **What is sent:** the first 5 hex characters of a new password's SHA-1, with
  `Add-Padding: true`. No data or code from the service is bundled.
- **Credit:** Pwned Passwords by [Troy Hunt](https://haveibeenpwned.com/Passwords),
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Re-read the current API terms before any hosted (non-self-hosted) launch.

## Chart.js

Loaded from the jsDelivr CDN at runtime (not bundled). MIT licence,
https://github.com/chartjs/Chart.js.
