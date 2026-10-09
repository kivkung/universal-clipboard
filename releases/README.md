# Release artifacts

Release output lives in `releases/<version>/` inside the Git repository. The former
workspace-level `releas/` directory has been consolidated here.

```text
releases/
├── README.md
├── RELEASE-NOTES.md
├── 0.4.0/                          Previous canonical build
└── 0.5.0/
    ├── README.md
    ├── universal-clipboard-0.5.0.apk
    ├── universal-clipboard-lan-0.5.0.tgz
    └── alternate-build/            Preserved separately signed earlier build
```

Build from the repository root on Windows:

```powershell
npm run build:release
# Desktop package only:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -SkipAndroid
```

The script verifies desktop, lockfile and Android versions match, runs tests,
builds the APK using the existing workspace demo key, and packages desktop source.
Android requires the SDK/JDK/dependencies described in its README. `-SkipTests`
is available for intentionally reusing an already validated source snapshot.
Run this script before distributing a release; editing docs/source does not update
previously generated packages automatically.

Generated APK/TGZ/IDSIG files are ignored by Git. Upload distribution artifacts
as GitHub Release assets when publishing; pushing source does not publish to npm.
Source installation from a GitHub repository archive uses the root package.json.
Private signing keys remain local and are never included in release packages.

Android compatibility depends on certificate, not just version. The canonical
workspace build's SHA-256 certificate fingerprint is
`7f4e59bd5fdc7e1d5e639af27c9148e1493c0b6dc25acd7b45d7c1dfc9387e2b`.
The preserved alternate build uses
`40fd8ca8a0dc4a8748a9df585b4de81e27d9455aa5025c31d206e23cbf8d978c`.
They cannot update one another in place; preserve the installed app's data.
