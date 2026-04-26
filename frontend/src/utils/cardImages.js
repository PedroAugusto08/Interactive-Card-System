const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
const CARDS_BASE_URL = (import.meta.env.VITE_SOCKET_URL || API_ORIGIN).replace(/\/$/, '');

export const DEFAULT_IMO_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#22183f"/>
          <stop offset="100%" stop-color="#0e1420"/>
        </linearGradient>
      </defs>
      <rect width="300" height="420" rx="28" fill="url(#bg)"/>
      <circle cx="150" cy="138" r="74" fill="rgba(124,92,255,0.22)" stroke="rgba(245,197,66,0.42)" stroke-width="3"/>
      <path d="M150 92 L165 140 L215 140 L174 170 L189 220 L150 190 L111 220 L126 170 L85 140 L135 140 Z" fill="#f5c542"/>
      <text x="150" y="302" text-anchor="middle" fill="#E6EAF2" font-size="24" font-family="Inter, sans-serif">Carta Imo</text>
    </svg>
  `);

export function resolveCardImageUrl(imagePath) {
  if (!imagePath) {
    return DEFAULT_IMO_IMAGE;
  }

  if (/^(https?:\/\/|data:)/i.test(imagePath)) {
    return imagePath;
  }

  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${CARDS_BASE_URL}${normalizedPath}`;
}
