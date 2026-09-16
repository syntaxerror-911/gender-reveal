/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next inlines Google Font CSS at build time; disabling keeps the build
  // hermetic (offline CI) and loads the stylesheet at runtime instead.
  optimizeFonts: false
};

module.exports = nextConfig;
