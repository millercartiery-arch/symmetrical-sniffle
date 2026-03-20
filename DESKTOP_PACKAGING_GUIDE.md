# Desktop Packaging Guide (Tauri)

## Local Build

### Windows (PowerShell)
```powershell
.\build-desktop.ps1
```

### Linux/macOS
```bash
chmod +x ./build-desktop.sh
./build-desktop.sh
```

Output directory:
- `src-tauri/target/release/bundle/`

## GitHub Actions Build

Workflow file:
- `.github/workflows/desktop-package.yml`

Trigger options:
1. Manual trigger: `Actions -> Desktop Package -> Run workflow`
2. Tag trigger:
```bash
git tag v1.0.0
git push origin v1.0.0
```

Pipeline steps:
1. Install Node 18 and Rust stable
2. Run regression tests
   - `test:scheduler-components`
   - `test:subaccount-distribution-smoke`
3. Build Tauri installers for Windows/macOS/Linux
4. Upload artifacts as `tauri-bundle-*`
