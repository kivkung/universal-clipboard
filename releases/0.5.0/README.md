# 0.5.0 canonical release

- Desktop: `universal-clipboard-lan-0.5.0.tgz`
- Android: `universal-clipboard-0.5.0.apk`, versionCode 7
- Features: Local/Internet transport, QR pairing, auto-files, five-entry history,
  generic Android receive/share/save, verified resumable batches.

```powershell
# Run from the repository root:
npm install -g ./releases/0.5.0/universal-clipboard-lan-0.5.0.tgz
uc setup
```

`alternate-build/` preserves the earlier independently signed 0.5.0 distribution.
Its APK has a different certificate; use a matching build for in-place updates.
See [release policy](../README.md) and [release notes](../RELEASE-NOTES.md).
