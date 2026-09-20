import { Cinzel, Inter } from 'next/font/google';
import './globals.css';

// Police display serif pour les titres (esprit "client League of Legends").
const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-cinzel',
  display: 'swap',
});

// Police de corps pour le texte courant.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'LoL Stats Live',
  description: 'Stats League of Legends en temps réel pour streamers — dashboard et overlay OBS.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body
        className={cinzel.variable + ' ' + inter.variable}
        style={{ '--font-display': 'var(--font-cinzel)', '--font-body': 'var(--font-inter)' }}
      >
        {children}
      </body>
    </html>
  );
}
