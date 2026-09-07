/**
 * Static export config for the desktop (Tauri) build.
 *
 * `output: 'export'` makes `next build` emit a fully static `out/` directory
 * (no Node server required) that Tauri serves directly from its own window.
 * The app has no `app/api` routes or server actions, so this is a pure
 * packaging change -- `npm run dev` / cloud (Render) deploys are unaffected,
 * since Render runs `next start` against the normal server build, not `out/`.
 *
 * `images.unoptimized` is required by `output: 'export'` whenever next/image
 * is used; the app currently doesn't use it, but this keeps the export from
 * breaking if it's introduced later.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NETRA_DESKTOP_BUILD === "1" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
