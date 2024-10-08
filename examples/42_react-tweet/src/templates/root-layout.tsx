import '../styles.css';

import type { ReactNode } from 'react';

import { Header } from '../components/header';
import { Footer } from '../components/footer';

type RootLayoutProps = { children: ReactNode };

export const RootLayout = async ({ children }: RootLayoutProps) => {
  const data = await getData();

  return (
    <html>
      <head></head>
      <body>
        <div className="font-['Nunito']">
          <meta property="description" content={data.description} />
          <link rel="icon" type="image/png" href={data.icon} />
          <Header />
          <main className="flex min-h-svh items-center justify-center *:min-h-64 *:min-w-64">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
};

const getData = async () => {
  const data = {
    description: 'An internet website!',
    icon: '/images/favicon.png',
  };

  return data;
};
