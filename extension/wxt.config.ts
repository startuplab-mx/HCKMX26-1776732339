import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    content_security_policy: {
      // Allow images from UploadThing's CDN domains.
      // Replace/add your own CDN host(s) here if different.
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' data: https://utfs.io https://*.ufs.sh;",
    },
  },
});
