# STASH Brand Kit

## Source of truth

All supplied brand files live under `brand/`. Preserve the original files;
consume SVG for interface and print use, and use the PNG/WebP exports only
where a raster format is required. The user-supplied brand-exploration board
is a reference artifact and must not be cropped, re-created, or exported as a
product asset.

## Brand promise and voice

**Primary in-app tagline:** *Stash it. Find it. Use it anywhere.*

STASH is a calm, capable creator tool. Write plainly, describe what happened,
and use familiar filesystem language. Use product vocabulary consistently:
**Stash it**, **Stashing**, **Stashed**, **Recent Stashes**, and **Free up
space**. Do not use generic "Upload" language for the primary ingest action.

## Logo system

| Situation | Asset | Rule |
|---|---|---|
| Light surface | `logos/primary/STASH_primary_light.svg` | Default header / sign-in logo. |
| Dark surface | `logos/primary/STASH_primary_dark.svg` | Default dark header / splash logo. |
| Compact square placement | `logos/symbol/STASH_symbol_gradient.svg` | Sidebar collapsed state, loading indicator, and small branded moments. |
| Single-colour reproduction | `logos/monochrome/STASH_logo_black.svg` or `STASH_logo_white.svg` | Use only when colour cannot be reproduced. |
| Product icon | `icons/windows/STASH.ico` | Windows executable, installer, taskbar, and Start-menu identity. |

Never re-typeset the STASH wordmark, alter the supplied gradient, crop a logo,
place it on a busy image, stretch it, add shadows/outlines, or use the app icon
as the normal header logo. Keep clear space equal to at least the symbol's
small triangle height on every side. Keep the horizontal logo at least 120 px
wide in the desktop UI; use the symbol below that size.

## Color tokens

The supplied source artwork establishes these non-negotiable brand colours:

```css
:root {
  --stash-ink: #0B1424;
  --stash-white: #FFFFFF;
  --stash-cyan: #38BDF8;
  --stash-violet: #7C3AED;
  --stash-gradient: linear-gradient(90deg, #38BDF8 0%, #7C3AED 100%);
}
```

For working surfaces, use `--stash-ink` with white/light neutral surfaces in
light mode and `--stash-ink` with dark neutral layers in dark mode. The bright
gradient is a brand signature for the symbol, Home artwork, progress accents,
and non-text decoration. It must not be the sole treatment for body text,
small labels, or error/success meaning. Primary destructive/error, success,
warning, disabled, and focus states need semantic UI tokens validated for WCAG
2.2 AA contrast during implementation; never infer their meaning from the
gradient.

## Typography

| Role | Family | Weight | Use |
|---|---|---:|---|
| Interface / body | Inter | 400 | File names, metadata, content. |
| Navigation / labels | Inter | 500 | Sidebar, table headers, field labels. |
| Primary action | Inter | 600 | Buttons and key calls to action. |
| Strong heading | Inter | 700 | Page headings and dialog titles. |
| Display | Space Grotesk | 500–700 | Home welcome and rare campaign moments only. |

Use system fallbacks until the OFL font binaries and licenses are included in
the application vendor workflow. Do not use the brand wordmark as ordinary
text. Avoid all-caps for routine UI labels.

## Asset map

| Folder | Intended use |
|---|---|
| `logos/` | Logo, symbol, wordmark, monochrome variants. |
| `icons/` | Windows, installer, browser, PWA, Apple-touch icons. |
| `splash/` | Windows launch surface; use the matching light/dark file without cropping. |
| `hero/` | STASH Home only; preserve its full 16:9 composition. |
| `empty_states/` | Empty Library, no results, Offline, Recent Stashes, Trash. |
| `demo_thumbnails/` | Seed/demo content only, never represent user files as product data. |
| `social/` | Browser/social sharing preview; deferred with the web app. |
| `fonts/` | Font specification and license guidance. |

## Interface character

Working surfaces are a clean creator utility: dense, legible, and quiet. Use
creative expression only on Home, the **Stash it** moment, previews, and
asset-type accents. Both light and dark mode are first-class modes. Avoid
glass-heavy panels, decorative gradients behind text, noisy card grids in file
workflows, cartoon clouds, and a web-uploader appearance.
