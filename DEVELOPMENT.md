# Development

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module structure, build system, and development notes.

## Quick start

```powershell
npm install              # Install build dependencies
npm run build            # Build dist/tradesea-spacebar.user.js
.\build.ps1 -Dev         # Dev build with timestamp version suffix
```

## Making a release

1. Commit your changes
2. Tag: `git tag v2.8` (or whatever major.minor you want)
3. Push: `git push origin master --tags`
4. GitHub Actions will build and create a release automatically
