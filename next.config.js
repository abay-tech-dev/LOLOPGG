/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Le lint (npm run lint) reste disponible séparément ; on ne bloque pas
    // le build dessus pour ne pas dépendre d'une config eslint-config-next.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
